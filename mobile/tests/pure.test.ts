import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { SseParser } from "../src/net/sse.ts";
import { PhoneClient, hostUrl, parsePairingLink, pairingLink } from "../src/net/client.ts";
import { segmentMath, markdownBlocks } from "../src/render/pipeline.ts";
import { mathSvg, mathCacheSize } from "../src/render/math.ts";
import { buildAnswer, normalizeOptions, resolveCorrect, seededRandom, shuffleOptions } from "../../src/core/question-core.ts";
import { projectView } from "../../src/core/view.ts";
import { practiceProgress, outcomeLabel, splitVerdict } from "../src/ui/practice.ts";
import { PhoneSession } from "../src/net/session.ts";
const fixture = (name: string) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("SSE framing and replay", () => {
	it("parses every byte split in a real turn and ignores comment pings", () => {
		const raw = fixture("teach-turn1.sse");
		const whole = new SseParser().push(raw);
		const split = new SseParser();
		const frames = [...split.push(": pi"), ...split.push("ng\n\n")];
		for (const char of raw) frames.push(...split.push(char));
		assert.deepEqual(frames, whole);
		assert.ok(frames.length > 10);
		assert.equal(frames.at(-1)?.data, "[DONE]");
	});
	it("uses the same parser for typed events", () => {
		const parser = new SseParser();
		assert.deepEqual(parser.push("event: turn-started\r\ndata: {\"chatId\":\"a\"}\r"), []);
		assert.deepEqual(parser.push("\n\r\n"), [{ event: "turn-started", data: '{"chatId":"a"}' }]);
	});
	it("reads every recorded teaching stream in small chunks", () => {
		const files = fs.readdirSync(new URL("../fixtures/", import.meta.url)).filter((name) => /^teach-turn\d+\.sse$/.test(name));
		assert.ok(files.length >= 20);
		for (const file of files) {
			const source = fixture(file);
			const parser = new SseParser();
			const frames = [];
			for (let offset = 0; offset < source.length; offset += 17) frames.push(...parser.push(source.slice(offset, offset + 17)));
			assert.equal(frames.at(-1)?.data, "[DONE]", file);
			for (const frame of frames) if (frame.data !== "[DONE]") assert.doesNotThrow(() => JSON.parse(frame.data), file);
		}
	});
});

describe("network contract", () => {
	it("pairs and clears credentials on removal", async () => {
		let stored: any = null;
		const fetchLike = async (url: string, init?: RequestInit) => {
			if (url.endsWith("hello")) return Response.json({ app: "learnharness", version: "mock", name: "Mac" });
			if (url.endsWith("pair")) return Response.json({ token: "secret", name: "Mac" });
			assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
			return Response.json({ message: "Not paired" }, { status: 401 });
		};
		let removed = "";
		const client = new PhoneClient({ get: async () => stored, set: async (v) => { stored = v; } }, fetchLike as typeof fetch, (name) => { removed = name; });
		await client.pair("http://100.1.2.3:4791", "ABCD1234", "iPhone");
		await assert.rejects(() => client.json("/api/chats"));
		assert.equal(stored, null);
		assert.equal(removed, "Mac");
		assert.deepEqual(parsePairingLink(pairingLink("http://100.1.2.3:4791", "ABCD1234")), { url: "http://100.1.2.3:4791", code: "ABCD1234" });
		assert.equal(hostUrl("mock.tailnet"), "http://mock.tailnet:4791");
	});
});

describe("shared core and render pipeline", () => {
	it("projects the recorded chat and grades the fixture quiz", () => {
		const chat = JSON.parse(fixture("teach-final.json"));
		const view = projectView(chat.messages);
		assert.ok(view.length > 2);
		const call = chat.messages.flatMap((m: any) => m.role === "assistant" ? m.content : []).find((b: any) => b.type === "toolCall" && b.name === "quiz");
		const options = shuffleOptions(normalizeOptions(call.arguments.options), seededRandom(call.id));
		const correct = resolveCorrect(call.arguments.correctAnswer, options).indices;
		const answer = buildAnswer({ id: call.id, kind: "quiz", question: call.arguments.question, mode: "single-select", options, correctIndices: correct, explanation: call.arguments.explanation, createdAt: "" }, { values: [options[correct[0] - 1].value], confidence: 70, readingThinking: "my draft" }, "quiz");
		assert.equal(answer.correct, true);
		assert.equal(answer.confidence, 70);
		assert.equal(answer.readingThinking, "my draft");
	});
	it("segments display and inline math while hiding an unfinished delimiter", () => {
		const parts = segmentMath("Scale $x^2$ then $$f'(x)=2x$$. Partial $x+");
		assert.deepEqual(parts.filter((p) => p.kind === "math").map((p) => p.value), ["x^2", "f'(x)=2x"]);
		assert.equal(parts.at(-1)?.kind, "pending");
		assert.ok(markdownBlocks("# Heading\n\n|a|b|\n|-|-|\n|1|2|").some((b) => b.type === "table"));
		assert.match(mathSvg("x^2"), /<svg/);
		const before = mathCacheSize(); mathSvg("x^2"); assert.equal(mathCacheSize(), before);
	});
	it("replaces full streaming partials by slot", () => {
		const session = new PhoneSession({} as any, "a");
		session.apply({ type: "message_start", message: { role: "assistant", content: [] } });
		session.apply({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } });
		assert.equal(session.state.tail.length, 1);
		assert.equal((session.state.tail[0] as any).content[0].text, "Hello");
	});
	it("maps picked progress and outcome", () => {
		const messages = [{ role: "custom", customType: "graph-context", details: { propositions: [{ id: "a" }, { id: "b" }] } }, { role: "assistant", content: [{ type: "toolCall", name: "problem", arguments: { target: ["a"] } }, { type: "toolCall", id: "done", name: "conclude", arguments: { outcome: "solved" } }] }, { role: "toolResult", toolCallId: "done", isError: false }];
		assert.deepEqual(practiceProgress(messages as never), { reviewed: 1, total: 2 });
		assert.deepEqual(outcomeLabel({ outcome: "solved", rung: null }), { label: "SOLVED · NO HINTS", missed: false });
		assert.deepEqual(splitVerdict("Good work. Keep going."), { headline: "Good work.", rest: "Keep going." });
	});
});
