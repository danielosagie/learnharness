import assert from "node:assert/strict";
import { it } from "node:test";
import fs from "node:fs";
import { PhoneClient, hostUrl, parsePairingLink, pairingLink } from "../src/net/client.ts";
import { createSampleFetch, memoryCredentials, sampleCredentials } from "../src/sample/transport.ts";
import { PhoneSession } from "../src/net/session.ts";
import { projectView } from "../../src/core/view.ts";

it("accepts public links and manual HTTPS, MagicDNS, host, IP, and explicit ports", () => {
	for (const [input, output] of [
		["https://computer.tailnet.ts.net:8443/", "https://computer.tailnet.ts.net:8443"],
		["computer.tailnet.ts.net", "https://computer.tailnet.ts.net:8443"],
		["computer.tailnet.ts.net:10000", "https://computer.tailnet.ts.net:10000"],
		["computer", "http://computer:4791"], ["127.0.0.1", "http://127.0.0.1:4791"],
		["http://127.0.0.1:4791", "http://127.0.0.1:4791"], ["[::1]", "http://[::1]:4791"],
	]) assert.equal(hostUrl(input), output);
	const url = "https://computer.tailnet.ts.net:8443";
	assert.deepEqual(parsePairingLink(pairingLink(url, "ABCD1234")), { url, code: "ABCD1234" });
	for (const input of ["", "ftp://computer", "https://user:secret@computer", "https://computer/path", "https://computer?key=secret", "computer with spaces"]) assert.throws(() => hostUrl(input));
});
it("runs the lesson, answered check, streamed replay, practice, result, and next offline", async () => {
	const network = globalThis.fetch;
	const nativeResponse = globalThis.Response;
	globalThis.Response = class { constructor() { throw new Error("Native Response cannot stream"); } } as any;
	globalThis.fetch = async () => { throw new Error("Sample used the network"); };
	try {
		const client = new PhoneClient(memoryCredentials(sampleCredentials), createSampleFetch({ frameMs: 0 }));
		await client.restore();
		assert.deepEqual(await client.hello(), { app: "learnharness", version: "sample" });
		const review = await client.json<any>("/api/review"); assert.equal(review.due.length, 12);
		assert.equal(review.due.filter((p: any) => p.lane === "new").length, 3);
		const list = await client.json<any>("/api/chats"); assert.equal(list.chats[0].pendingQuestion, true);
		const session = new PhoneSession(client, list.chats[0].id); await session.open();
		const before = session.messages.length;
		const quiz = session.messages.flatMap((m) => m.role === "assistant" ? m.content : []).find((p) => p.type === "toolCall" && p.name === "quiz");
		assert.ok(quiz?.type === "toolCall");
		let partials = 0; const unsubscribe = session.subscribe(() => { if (session.state.streamingIds.size) partials++; });
		await session.send({ type: "answer", toolCallId: quiz.id, answer: { kind: "choice", correct: true, confidence: 70, readingThinking: "Multiply the slopes." } as any });
		assert.ok(partials > 3); assert.ok(session.messages.length > before);
		assert.equal(session.state.error, null); assert.equal(session.state.tail.length, 0);
		assert.ok(projectView(session.messages).length > 0);
		const answered = session.messages.find((m) => m.role === "toolResult" && m.toolCallId === quiz.id);
		assert.ok(answered && JSON.stringify(answered).includes("Multiply the slopes.")); unsubscribe(); session.close();
		const practice = await client.json<any>("/api/chats", { method: "POST", body: JSON.stringify({ title: "Practice", kind: "practice", graphContext: { propositions: review.due.slice(0, 2) } }) });
		const cycle = new PhoneSession(client, practice.id); await cycle.open(); await cycle.send({ type: "text", text: "Practice" });
		const problem = cycle.messages.flatMap((m) => m.role === "assistant" ? m.content : []).find((p) => p.type === "toolCall" && p.name === "problem");
		assert.ok(problem?.type === "toolCall");
		await cycle.send({ type: "thinking", problemCallId: problem.id, text: "Outside in: cube, cos, 5x." });
		assert.ok(cycle.messages.some((m) => m.role === "assistant" && m.content.some((p) => p.type === "toolCall" && p.name === "conclude")));
		assert.equal((await client.json<any>("/api/review")).due.length, 11);
		assert.equal((await client.json<any>("/api/review?ids=idea-1")).items.length, 1);
		await cycle.send({ type: "next" });
		assert.equal(cycle.messages.flatMap((m) => m.role === "assistant" ? m.content : []).filter((p) => p.type === "toolCall" && p.name === "problem").length, 2); cycle.close();
	} finally { globalThis.fetch = network; globalThis.Response = nativeResponse; }
});
it("keeps credentials in memory and isolates each demo run under the fixture budget", async () => {
	const one = new PhoneClient(memoryCredentials(sampleCredentials), createSampleFetch());
	await one.restore(); await one.unpair(); assert.equal(one.paired, null);
	const two = new PhoneClient(memoryCredentials(sampleCredentials), createSampleFetch());
	assert.deepEqual(await two.restore(), sampleCredentials);
	assert.equal((await two.json<any>("/api/chats")).chats.length, 1);
	const size = fs.statSync(new URL("../src/sample/lesson.json", import.meta.url)).size;
	assert.ok(size < 600_000, `${size} fixture bytes`);
});
it("cancels event and replay readers without leaking timers", async () => {
	const client = new PhoneClient(memoryCredentials(sampleCredentials), createSampleFetch({ frameMs: 1000 })); await client.restore();
	const events = new AbortController(); const response = await client.api("/api/events", { signal: events.signal }); const reader = response.body!.getReader();
	assert.match(new TextDecoder().decode((await reader.read()).value), /: ping/);
	events.abort(); assert.equal((await reader.read()).done, true);
	const cancelled = await client.api("/api/events"); await cancelled.body!.getReader().cancel();
	await client.json("/api/chat", { method: "POST", body: JSON.stringify({ chatId: "sample-chain-rule", input: { type: "continue" } }) });
	const abort = new AbortController(); const stream = await client.api("/api/chats/sample-chain-rule/stream", { signal: abort.signal });
	const replay = stream.body!.getReader(); await replay.read(); abort.abort(); assert.equal((await replay.read()).done, true);
});
