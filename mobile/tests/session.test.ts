import assert from "node:assert/strict";
import { it } from "node:test";
import { PhoneSession, type ChatRecord } from "../src/net/session.ts";
import { PhoneClient, normalizePhoneCode, type Credentials } from "../src/net/client.ts";
import { sseFrames } from "../src/net/sse.ts";
import { questionData } from "../src/ui/check-model.ts";
import { buildAnswer, emptyDockSelection, toggleOption, toggleOther } from "../../src/core/question-core.ts";
import { newAnswerResult, type LhMessage } from "../../src/core/native-messages.ts";
const record = (messages: LhMessage[] = [], busy = false): ChatRecord => ({ id: "chat", title: "Lesson", messages, turnInFlight: busy });
const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
async function fakeClient(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
	let saved: Credentials | null = { url: "http://mock:4791", token: "test-only", name: "Mac" };
	const client = new PhoneClient({ get: async () => saved, set: async (v) => { saved = v; } }, ((url, init) => handler(new URL(String(url)).pathname, init)) as typeof fetch);
	await client.restore(); return client;
}
it("replaces snapshots through end and preserves the assistant slot across steer markers", () => {
	const session = new PhoneSession({} as PhoneClient, "chat");
	session.apply({ type: "message_start", message: assistant("") });
	const id = session.state.tail[0]!.id;
	for (const text of ["H", "Hello", "Hello again"]) session.apply({ type: "message_update", message: assistant(text) });
	const steer = { id: "steer-a", role: "user", content: "A hint" };
	session.apply({ type: "message_start", message: steer });
	session.apply({ type: "message_end", message: steer });
	session.apply({ type: "message_end", message: assistant("Hello again") });
	assert.equal(session.state.tail.length, 2); assert.equal(session.state.tail[0]!.id, id);
	assert.deepEqual((session.state.tail[0] as any).content, assistant("Hello again").content);
	assert.equal(session.state.streamingIds.size, 0);
	session.apply({ type: "message_start", message: assistant("Next") });
	session.apply({ type: "message_end", message: assistant("Next") });
	assert.equal(session.state.tail.length, 3); assert.notEqual(session.state.tail[2]!.id, id);
});
it("cancels and releases a reader when its SSE consumer exits early", async () => {
	let cancelled = 0;
	const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); }, cancel() { cancelled++; } });
	for await (const frame of sseFrames(stream)) { assert.equal(frame.data, "[DONE]"); break; }
	assert.equal(cancelled, 1); assert.equal(stream.locked, false);
});
it("detaches in background and rebuilds a single replay on foreground return", async () => {
	let readers = 0;
	const client = await fakeClient((path, init) => {
		if (!path.endsWith("stream")) return Response.json(record([], true));
		readers++;
		return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "message_start", message: assistant("Replay") })}\n\n`)); init?.signal?.addEventListener("abort", () => c.close(), { once: true }); } }));
	});
	const session = new PhoneSession(client, "chat");
	await session.open(); await new Promise((r) => setTimeout(r, 10));
	assert.equal(session.isAttached, true); assert.equal(session.state.tail.length, 1);
	session.close(); await new Promise((r) => setTimeout(r, 10));
	assert.equal(session.isAttached, false); assert.equal(session.state.busy, false);
	await session.open(); await new Promise((r) => setTimeout(r, 10));
	assert.equal(readers, 2); assert.equal(session.state.tail.length, 1); session.close();
});
it("a late POST acknowledgement cannot attach after the view closes", async () => {
	let ack!: () => void, streams = 0;
	const client = await fakeClient(async (path) => { if (path === "/api/chat") { await new Promise<void>((r) => { ack = r; }); return Response.json({ ok: true }); } if (path.endsWith("stream")) streams++; return Response.json(record()); });
	const session = new PhoneSession(client, "chat");
	const sending = session.send({ type: "text", text: "Teach" });
	session.close(); ack(); await sending;
	assert.equal(streams, 0); assert.equal(session.state.busy, false);
});
it("sends all input variants unchanged with readingThinking and atomically adopts the record", async () => {
	const sent: any[] = [];
	const client = await fakeClient((path, init) => { if (path === "/api/chat") { sent.push(JSON.parse(String(init?.body)).input); return Response.json({ ok: true }); } if (path.endsWith("stream")) return new Response('data: {"type":"turn-settled"}\n\n'); return Response.json(record()); });
	const session = new PhoneSession(client, "chat");
	const answer = buildAnswer(questionData({ tool: "quiz", toolCallId: "q", input: { question: "Which?", options: [{ label: "Yes", value: "yes" }], correctAnswer: "yes" } }), { values: ["yes"], thinking: "Because", readingThinking: "While reading", confidence: 70 }, "quiz");
	const inputs = [{ type: "answer", toolCallId: "q", answer }, { type: "thinking", problemCallId: "p", text: "My work" }, { type: "next" }, { type: "continue" }, { type: "text", text: "Why?" }] as const;
	for (const input of inputs) { await session.send(input); assert.equal(session.state.tail.length, 0); }
	assert.deepEqual(sent, JSON.parse(JSON.stringify(inputs))); assert.equal(sent[0].answer.readingThinking, "While reading");
});
it("falls back from a settled steer and surfaces 503 without leaving busy state", async () => {
	const paths: string[] = [];
	const client = await fakeClient((path) => { paths.push(path); return Response.json({}, { status: path.endsWith("steer") ? 409 : 503 }); });
	const session = new PhoneSession(client, "chat"); await session.steer("Why?");
	assert.deepEqual(paths, ["/api/chats/chat/steer", "/api/chat"]);
	assert.equal(session.state.busy, false); assert.equal(session.state.error, "No models set up on your computer.");
});
it("dismisses optimistically without starting a turn and stops through the desktop endpoint", async () => {
	let resolve!: () => void;
	const calls: { path: string; body: any }[] = [];
	const client = await fakeClient(async (path, init) => { calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null }); if (path.endsWith("dismiss")) await new Promise<void>((r) => { resolve = r; }); return Response.json(record()); });
	const session = new PhoneSession(client, "chat"); const input = { type: "dismiss-problem", problemCallId: "p" } as const;
	const pending = session.dismiss(input); assert.equal(session.state.tail[0]?.role, "custom"); resolve(); await pending; await session.stop();
	assert.deepEqual(calls[0], { path: "/api/chats/chat/dismiss", body: { input } });
	assert.deepEqual(calls.find((c) => c.path === "/api/activity/abort")?.body, { kind: "turn", id: "chat" });
	assert.equal(calls.some((c) => c.path === "/api/chat"), false);
});
it("resumes interrupted answers while leaving dismissed questions paused", async () => {
	const q = { id: "question", role: "assistant", content: [{ type: "toolCall", id: "q", name: "quiz", arguments: { question: "Which?" } }] } as unknown as LhMessage;
	let submitted = 0;
	const client = await fakeClient((path) => { if (path === "/api/chat") { submitted++; return Response.json({}, { status: 503 }); } return Response.json(record([q, newAnswerResult("q", "quiz", { correct: true } as any)])); });
	await new PhoneSession(client, "chat").open(); assert.equal(submitted, 1);
	const paused = await fakeClient((path) => { if (path === "/api/chat") submitted++; return Response.json(record([q, newAnswerResult("q", "quiz", { dismissed: true } as any)])); });
	await new PhoneSession(paused, "chat").open(); assert.equal(submitted, 1);
});
it("normalizes code aliases and shares all question modes and multi-select Other semantics", () => {
	assert.equal(normalizePhoneCode("oOilabcd"), "0011ABCD");
	for (const tool of ["quiz", "probe", "ask_user_question", "explain", "recall"]) assert.equal(questionData({ toolCallId: "q", tool, input: { question: "Which?", options: [{ label: "A", value: "a" }], correctAnswer: "a", multiSelect: true } }).mode, ["explain", "recall"].includes(tool) ? "text" : "multi-select");
	const selection = toggleOther("multi-select", toggleOption("multi-select", emptyDockSelection(), 1));
	assert.equal(selection.selected.has(1), true); assert.equal(selection.otherSelected, true);
});
it("polls the normal-send 409 race and keeps optimistic content until record adoption", async () => {
	let posts = 0, polls = 0, finishLoad!: () => void;
	const client = await fakeClient(async (path) => {
		if (path === "/api/chat") return Response.json({}, { status: ++posts === 1 ? 409 : 200 });
		if (path === "/api/jobs") { polls++; return Response.json({ turnInFlight: false }); }
		if (path.endsWith("stream")) return new Response('data: {"type":"turn-settled"}\n\n');
		if (!finishLoad) await new Promise<void>((resolve) => { finishLoad = resolve; });
		return Response.json(record([{ id: "server-user", role: "user", content: "Hello", timestamp: 0 } as LhMessage]));
	});
	const session = new PhoneSession(client, "chat");
	const pending = session.send({ type: "text", text: "Hello" });
	await new Promise((r) => setTimeout(r, 550));
	assert.equal(posts, 2); assert.equal(polls, 1); assert.equal(session.state.tail.length, 1);
	finishLoad(); await pending;
	assert.equal(session.messages.length, 1); assert.equal(session.messages[0]!.id, "server-user");
});

it("retains a new-session prompt when an event resync already owns the load", async () => {
	let finish!: () => void;
	let posts = 0;
	let releaseLoad = new Promise<void>((resolve) => { finish = resolve; });
	const client = {
		json: async () => { await releaseLoad; return { id: "new", title: "New", messages: [], turnInFlight: false }; },
		api: async (_path: string, init: RequestInit) => { assert.equal(JSON.parse(String(init.body)).input.text, "Practice what's due"); posts++; return new Response('{}'); },
		stream: async function* () { yield { event: "message", data: "[DONE]" }; },
	};
	const session = new PhoneSession(client as any, "new");
	const first = session.resync();
	await session.open("Practice what's due");
	finish(); await first;
	for (let i = 0; i < 10 && session.state.busy; i++) await new Promise((resolve) => setTimeout(resolve, 1));
	assert.equal(posts, 1); session.close();
});
