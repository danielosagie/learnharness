import { previewFixtures } from './preview-fixtures.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const turns = fs.readdirSync(root).filter((n) => /^teach-turn\d+\.sse$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const original = fixture('teach-after-turn1.json');
const finalRecord = fixture('teach-final.json');
const turnEndIndex = new Map(turns.map((name) => {
  const frames = fs.readFileSync(path.join(root, name), 'utf8').split(/\n\n/).filter(Boolean);
  const messages = frames.map((frame) => { try { return JSON.parse(frame.slice(frame.indexOf('data: ') + 6)); } catch { return null; } }).filter((event) => event?.type === 'message_end' && event.message?.role === 'assistant');
  const last = messages.at(-1)?.message;
  return [name, last ? finalRecord.messages.findIndex((message) => message.role === 'assistant' && JSON.stringify(message.content) === JSON.stringify(last.content)) : -1];
}));
const chats = new Map([[original.id, { ...original, kind: 'teach', turnInFlight: false }]]);
const turnNumbers = new Map([[original.id, 1]]);
const preview = process.env.PHONE_PREVIEW === '1' ? previewFixtures(finalRecord) : null;
if (preview) for (const chat of preview.records) chats.set(chat.id, chat);
const token = crypto.randomBytes(16).toString('hex');
const code = process.env.MOCK_PAIR_CODE ?? crypto.randomBytes(4).toString('hex').toUpperCase();
const events = new Set();
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const notify = (event, payload = {}) => { for (const res of events) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); };
const readBody = async (req) => { let text = ''; for await (const chunk of req) text += chunk; try { return JSON.parse(text); } catch { return {}; } };
const due = Array.from({ length: 12 }, (_, i) => ({ id: `idea-${i + 1}`, name: ['Chain rule', 'Derivative of cos', 'Power rule'][i % 3], statement: 'Review this idea', lane: i < 3 ? 'new' : 'review', dueAt: new Date().toISOString() }));
const solved = new Set();
const chatSummary = (chat) => {
  const lastCall = [...chat.messages].reverse().find((m) => m.role === 'assistant')?.content?.find((part) => part.type === 'toolCall');
  const results = new Set(chat.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId));
  const practiceCalls = chat.messages.flatMap((m) => m.role === 'assistant' ? m.content.filter((part) => part.type === 'toolCall' && ['problem', 'conclude'].includes(part.name)) : []);
  const lastPractice = practiceCalls.at(-1);
  return { id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, kind: chat.kind, phase: 'teach', pendingQuestion: !!lastCall && ['quiz', 'probe', 'ask_user_question', 'explain', 'recall'].includes(lastCall.name) && !results.has(lastCall.id), pendingProblem: lastPractice?.name === 'problem', busy: chat.turnInFlight };
};
const streamReplay = async (res, file, onDone) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(': ping\n\n');
  const frames = fs.readFileSync(path.join(root, file), 'utf8').split(/\n\n/).filter(Boolean);
  for (const frame of frames) { if (res.destroyed) break; res.write(frame + '\n\n'); await new Promise((r) => setTimeout(r, 35)); }
  if (!res.destroyed) res.end();
  onDone?.();
};
const practiceTurn = (chat) => {
  const input = chat.pendingInput ?? { type: 'text' };
  const number = (chat.problemNumber ?? 0) + (input.type === 'thinking' ? 0 : 1);
  const id = `mock_problem_${number}`;
  const target = `idea-${number}`;
  const now = Date.now();
  let assistant;
  let result = null;
  if (input.type === 'thinking') {
    const doneId = `mock_conclude_${chat.problemNumber ?? 1}`;
    assistant = { id: `mock_message_${now}`, role: 'assistant', content: [{ type: 'toolCall', id: doneId, name: 'conclude', arguments: { outcome: 'solved', verdict: 'Three layers, one product. You peeled from the outside and kept each inside untouched until its turn.', rung: null, missClass: null, retest: false } }], timestamp: now };
    result = { id: `mock_result_${now}`, role: 'toolResult', toolCallId: doneId, toolName: 'conclude', content: [{ type: 'text', text: 'Concluded' }], details: null, isError: false, timestamp: now };
  } else if (input.type === 'text' && chat.problemNumber > 0) {
    assistant = { id: `mock_message_${now}`, role: 'assistant', content: [{ type: 'text', text: 'Work from the outside in. Which layer changes first?' }], timestamp: now };
  } else {
    chat.problemNumber = number;
    assistant = { id: `mock_message_${now}`, role: 'assistant', content: [{ type: 'toolCall', id, name: 'problem', arguments: { statement: 'Differentiate, and say which layer you handled first.\n\n$$h(x)=\\cos^3(5x)$$', mode: 'composition', target: [target], modelSolution: 'Outside in: cube, then cos, then 5x.\n\n$$h\u0027(x)=-15\\cos^2(5x)\\sin(5x)$$' } }], timestamp: now };
    result = { id: `mock_result_${now}`, role: 'toolResult', toolCallId: id, toolName: 'problem', content: [{ type: 'text', text: 'Problem posed' }], details: null, isError: false, timestamp: now };
  }
  const frames = [{ type: 'agent_start' }, { type: 'turn_start' }, { type: 'message_start', message: { ...assistant, id: undefined, content: [] } }, { type: 'message_update', message: { ...assistant, id: undefined } }, { type: 'message_end', message: { ...assistant, id: undefined } }, ...(result ? [{ type: 'tool_execution_end', toolCallId: result.toolCallId, isError: false, result: { details: null } }] : []), { type: 'turn_end', toolResults: result ? [{ ...result, id: undefined }] : [] }, { type: 'agent_end' }];
  return { assistant, result, frames };
};
const streamPractice = async (res, chat) => {
  const turn = practiceTurn(chat);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.write(': ping\n\n');
  for (const frame of turn.frames) { if (res.destroyed) break; res.write(`data: ${JSON.stringify(frame)}\n\n`); await new Promise((resolve) => setTimeout(resolve, 80)); }
  if (!res.destroyed) res.end('data: [DONE]\n\n');
  chat.messages.push(turn.assistant); if (turn.result) chat.messages.push(turn.result);
  if (chat.pendingInput?.type === 'thinking') solved.add(`idea-${chat.problemNumber}`);
  chat.turnInFlight = false; chat.updatedAt = new Date().toISOString(); chat.pendingInput = null;
  notify('turn-settled', { chatId: chat.id });
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'); const pathname = url.pathname;
  if (preview) { res.setHeader('access-control-allow-origin', 'http://localhost:8084'); res.setHeader('access-control-allow-headers', 'authorization,content-type'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS'); if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); } }
  if (pathname === '/api/phone/hello') return json(res, 200, { app: 'learnharness', version: 'mock', name: preview ? 'MacBook' : 'Mock MacBook' });
  if (pathname === '/api/phone/pair' && req.method === 'POST') { const body = await readBody(req); return body.code === code ? json(res, 200, { token, name: preview ? 'MacBook' : 'Mock MacBook' }) : json(res, 401, { message: 'Bad or expired code' }); }
  if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { message: 'Not paired' });
  if (pathname === '/api/events') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); events.add(res); res.write(': ping\n\n'); const timer = setInterval(() => res.write(': ping\n\n'), 1000); req.on('close', () => { clearInterval(timer); events.delete(res); }); return; }
  if (pathname === '/api/review') { const ids = url.searchParams.get('ids'); return ids !== null ? json(res, 200, { items: due.filter((p) => ids.split(',').includes(p.id)).map((p, i) => ({ id: p.id, name: p.name, dueAt: new Date(Date.now() + ([9, 14, 21][i] ?? 9) * 86_400_000).toISOString(), lane: 'review' })) }) : json(res, 200, { due: due.filter((p) => !solved.has(p.id)), nextDueAt: null }); }
  if (pathname === '/api/chats' && req.method === 'GET') return json(res, 200, { chats: preview ? preview.summaries() : [...chats.values()].map(chatSummary) });
  if (pathname === '/api/chats' && req.method === 'POST') { const body = await readBody(req); const id = crypto.randomUUID(); const messages = body.kind === 'practice' && body.graphContext?.propositions?.length ? [{ id: crypto.randomUUID(), role: 'custom', customType: 'graph-context', details: { propositions: body.graphContext.propositions, chains: [] }, content: '[Session context]', display: true, timestamp: Date.now() }] : []; const chat = { ...original, id, title: body.title, kind: body.kind ?? 'teach', messages, turnInFlight: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; chats.set(id, chat); turnNumbers.set(id, 0); notify('chats-changed'); return json(res, 200, { id, title: chat.title }); }
  const chatMatch = /^\/api\/chats\/([^/]+)(?:\/(stream|steer|dismiss))?$/.exec(pathname);
  if (chatMatch) {
    const chat = chats.get(chatMatch[1]); if (!chat) return json(res, 404, { message: 'Chat not found' });
    if (!chatMatch[2]) return json(res, 200, chat);
    if (chatMatch[2] === 'stream') { if (!chat.turnInFlight) { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end('data: {"type":"turn-settled"}\n\n'); }
      if (chat.kind === 'practice') return void streamPractice(res, chat);
      const next = turnNumbers.get(chat.id) ?? 1; const file = turns[Math.max(0, Math.min(next - 1, turns.length - 1))];
      return void streamReplay(res, file, () => { chat.turnInFlight = false; const index = turnEndIndex.get(file) ?? -1; if (index >= 0) chat.messages = finalRecord.messages.slice(0, index + 1); chat.updatedAt = new Date().toISOString(); notify('turn-settled', { chatId: chat.id }); });
    }
    if (chatMatch[2] === 'steer') return json(res, chat.turnInFlight ? 200 : 409, { ok: chat.turnInFlight });
    if (chatMatch[2] === 'dismiss') { await readBody(req); return json(res, 200, { ok: true }); }
  }
  if (pathname === '/api/chat' && req.method === 'POST') { const body = await readBody(req); const chat = chats.get(body.chatId); if (!chat) return json(res, 404, { message: 'Chat not found' }); if (chat.turnInFlight) return json(res, 409, { message: 'Running' }); chat.turnInFlight = true; chat.pendingInput = body.input; if (chat.kind === 'practice') { const input = body.input; if (input?.type === 'text') chat.messages.push({ id: crypto.randomUUID(), role: 'user', content: input.text, timestamp: Date.now() }); if (input?.type === 'thinking' || input?.type === 'next') chat.messages.push({ id: crypto.randomUUID(), role: 'custom', customType: input.type === 'thinking' ? 'practice-thinking' : 'practice-next', details: input, content: input.text ?? '', display: true, timestamp: Date.now() }); } else turnNumbers.set(chat.id, (turnNumbers.get(chat.id) ?? 0) + 1); notify('turn-started', { chatId: chat.id }); return json(res, 200, { ok: true }); }
  if (pathname === '/api/jobs') return json(res, 200, { turnInFlight: !!chats.get(url.searchParams.get('chatId'))?.turnInFlight });
  if (pathname === '/api/activity/abort') { const body = await readBody(req); const chat = chats.get(body.id); if (chat) chat.turnInFlight = false; return json(res, 200, { ok: true }); }
  if (pathname === '/api/models') return json(res, 200, { slots: { strong: 'mock', cheap: 'mock', vision: 'mock' } });
  return json(res, 404, { message: 'Not found' });
});
server.listen(4791, '0.0.0.0', () => { console.log(`Mock LearnHarness on port 4791\nPair code: ${code}\nPair link: learnharness://pair?url=${encodeURIComponent('http://127.0.0.1:4791')}&code=${code}`); });
