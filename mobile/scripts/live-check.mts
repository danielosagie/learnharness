import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { PhoneClient } from '../src/net/client.ts';
const server = spawn(process.execPath, ['scripts/mock-server.mjs'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'inherit'] });
let stdout = '';
try {
  const code = await new Promise<string>((resolve, reject) => { server.stdout!.on('data', (b) => { stdout += b.toString(); const m = /Pair code: ([A-Z0-9]{8})/.exec(stdout); if (m) resolve(m[1]); }); server.on('exit', (n) => reject(new Error(`mock exited ${n}`))); });
  const base = 'http://127.0.0.1:4791';
  let stored: any = null;
  const client = new PhoneClient({ get: async () => stored, set: async (v) => { stored = v; } }, fetch);
  const start = performance.now(); await client.pair(base, code, 'Live check'); const pairMs = performance.now() - start;
  const listStart = performance.now(); const chats = await client.json<{ chats: { id: string }[] }>('/api/chats'); const listMs = performance.now() - listStart;
  const chatId = chats.chats[0].id;
  await client.json('/api/chat', { method: 'POST', body: JSON.stringify({ chatId, input: { type: 'answer', toolCallId: 'mock', answer: {} } }) });
  const streamStart = performance.now(); let frames = 0; for await (const frame of client.stream(`/api/chats/${chatId}/stream`)) { frames++; if (frame.data === '[DONE]') break; } const streamMs = performance.now() - streamStart;
  const practice = await client.json<{ id: string }>('/api/chats', { method: 'POST', body: JSON.stringify({ title: "Practice what's due", kind: 'practice', graphContext: { propositions: [{ id: 'idea-1', name: 'Chain rule', statement: 'Differentiate composites' }] } }) });
  const practiceStart = performance.now();
  await client.json('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: practice.id, input: { type: 'text', text: "Practice what's due" } }) });
  let practiceFrames = 0; for await (const frame of client.stream(`/api/chats/${practice.id}/stream`)) { practiceFrames++; if (frame.data === '[DONE]') break; }
  const posed = await client.json<{ messages: any[] }>(`/api/chats/${practice.id}`);
  const problem = posed.messages.flatMap((m) => m.role === 'assistant' ? m.content : []).find((part) => part.name === 'problem');
  if (!problem) throw new Error('Mock practice pose missing');
  await client.json('/api/chat', { method: 'POST', body: JSON.stringify({ chatId: practice.id, input: { type: 'thinking', problemCallId: problem.id, text: 'Differentiate outside in.' } }) });
  for await (const frame of client.stream(`/api/chats/${practice.id}/stream`)) if (frame.data === '[DONE]') break;
  const concluded = await client.json<{ messages: any[] }>(`/api/chats/${practice.id}`);
  if (!concluded.messages.some((m) => m.role === 'assistant' && m.content.some((part: any) => part.name === 'conclude'))) throw new Error('Mock practice conclusion missing');
  const practiceMs = performance.now() - practiceStart;
  const pingStart = performance.now(); const controller = new AbortController(); const response = await client.api('/api/events', { signal: controller.signal }); const reader = response.body!.getReader(); const ping = new TextDecoder().decode((await reader.read()).value); controller.abort();
  if (!ping.includes(': ping') || frames < 2) throw new Error('Missing stream replay or event ping');
  console.log(JSON.stringify({ pairMs, listMs, chats: chats.chats.length, replayFrames: frames, replayMs: streamMs, practiceFrames, practiceMs, pingMs: performance.now() - pingStart }, null, 2));
} finally { server.kill(); }
