import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import type { GraphNode, GraphChain } from "../src/core/contracts/graph.ts";
import type { PracticeRecord, PropositionReviewState } from "../src/core/contracts/review.ts";
import { FSRS_W, REVIEW_PICK_LIMIT, dueIncludedMessage, dueReviews, fsrsRetrievability, fsrsUpdate, practiceRecordsFromChat, reviewCalibration, reviewRating, reviewState } from "../src/core/review.ts";
import { newGraphContextMessage } from "../src/core/native-messages.ts";
import { concludeTool } from "../src/agent/tools/practice.ts";
import { parseAgentSettingsBody } from "../src/server/settings-body.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";

const vectors = JSON.parse(fs.readFileSync(new URL("./fixtures/fsrs-6.3.2.json", import.meta.url), "utf-8")) as {
	defaultParameters: number[];
	vectors: { previous: { stability: number; difficulty: number } | null; rating: "Again" | "Hard" | "Good"; elapsedDays: number; stability: number; difficulty: number; retrievability?: number }[];
};
const day = 86_400_000;
const start = Date.parse("2026-01-01T00:00:00Z");
const node = (id: string, chatId = "teach", born = start): GraphNode => ({ id, name: id, statement: id, aliases: [], createdAt: new Date(born).toISOString(), provenance: [{ chatId, messageId: "m" }] });
const record = (chatId: string, at: number, targets: string[], changes: Partial<PracticeRecord> = {}): PracticeRecord => ({ chatId, at, targets, outcome: "solved", rung: null, missClass: null, ...changes });
const history = (records: PracticeRecord[]) => ({ records, teachChatIds: new Set(["teach"]) });

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10 * Math.max(1, Math.abs(expected)), `${actual} ≠ ${expected}`);

describe("FSRS-6 long-term port", () => {
	it("matches py-fsrs 6.3.2 default parameters and generated vectors", () => {
		assert.deepEqual([...FSRS_W], vectors.defaultParameters);
		for (const v of vectors.vectors) {
			const updated = fsrsUpdate(v.previous, v.rating, v.elapsedDays);
			near(updated.stability, v.stability);
			near(updated.difficulty, v.difficulty);
			if (v.previous && v.retrievability !== undefined) near(fsrsRetrievability(v.previous.stability, v.elapsedDays), v.retrievability);
		}
	});
});

describe("review evidence and lanes", () => {
	it("maps the categorical grade table", () => {
		const base = record("p", start, ["a"]);
		assert.equal(reviewRating(base, "a"), "Good");
		assert.equal(reviewRating({ ...base, rung: "R1" }, "a"), "Hard");
		assert.equal(reviewRating({ ...base, outcome: "solvedWithHints", rung: "R2" }, "a"), "Hard");
		assert.equal(reviewRating({ ...base, rung: "R3" }, "a"), "Again");
		assert.equal(reviewRating({ ...base, outcome: "movedOn" }, "a"), "Again");
		assert.equal(reviewRating({ ...base, outcome: "surrendered" }, "a"), "Again");
		assert.equal(reviewRating({ ...base, missClass: "execution" }, "a"), "Hard");
		assert.equal(reviewRating({ ...base, missClass: "careless" }, "a"), "Hard");
		assert.equal(reviewRating({ ...base, outcome: "dismissed" }, "a"), null);
	});

	it("counts only the first concluded target per session, excluding dismissals and untagged problems", () => {
		const records = [record("p1", start, ["a"], { outcome: "dismissed" }), record("p1", start + 1, []), record("p1", start + 2, ["a"]), record("p1", start + 3, ["a"], { outcome: "surrendered" }), record("p2", start + day, ["a"])];
		const state = reviewState(history(records), [node("a")], start + 2 * day).get("a")!;
		assert.equal(state.reviews, 2);
		assert.equal(state.lastReview, start + day);
	});

	it("reads only clean pose and conclude calls from the native transcript", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "toolCall", id: "pose", name: "problem", arguments: { target: ["a", "b"] } }], timestamp: start },
			{ role: "toolResult", toolCallId: "pose", isError: false },
			{ role: "assistant", content: [{ type: "toolCall", id: "bad", name: "conclude", arguments: { outcome: "solved" } }], timestamp: start + 1 },
			{ role: "toolResult", toolCallId: "bad", isError: true },
			{ role: "assistant", content: [{ type: "toolCall", id: "done", name: "conclude", arguments: { outcome: "movedOn", rung: "R2", missClass: "cue", missed: ["a"] } }], timestamp: start + 2 },
			{ role: "toolResult", toolCallId: "done", isError: false },
		];
		assert.deepEqual(practiceRecordsFromChat("p", messages as never), [record("p", start + 2, ["a", "b"], { outcome: "movedOn", rung: "R2", missClass: "cue", missed: ["a"] })]);
	});

	it("uses teaching birth only as a due-time prior and waits for notes-born practice", () => {
		const nodes = [node("teach-new"), node("notes-new", "src_notes")];
		const before = reviewState(history([]), nodes, start + day);
		assert.equal(before.get("teach-new")?.lane, "new");
		assert.equal(before.get("teach-new")?.reviews, 0);
		assert.equal(before.get("teach-new")?.dueAt, start + FSRS_W[2] * day);
		assert.equal(before.has("notes-new"), false);
		assert.deepEqual(dueReviews(before, nodes, [], start + day).due, []);
		assert.deepEqual(dueReviews(before, nodes, [], start + 3 * day).due, ["teach-new"]);
		const after = reviewState(history([record("p", start + day, ["notes-new"])]), nodes, start + 3 * day);
		assert.equal(after.get("notes-new")?.lane, "review");
	});

	it("orders reviews by R, ties by premise chain count, then new oldest first; deleted nodes drop out", () => {
		const nodes = [node("r1"), node("r2"), node("r3"), node("new-old", "teach", start), node("new-young", "teach", start + day)];
		const item = (r: number, lane: "review" | "new"): PropositionReviewState => ({ stability: lane === "review" ? 2 : null, difficulty: lane === "review" ? 5 : null, lastReview: lane === "review" ? start : null, reviews: lane === "review" ? 1 : 0, retrievability: lane === "review" ? r : null, dueAt: start, lane });
		const state = new Map([["r1", item(0.2, "review")], ["r2", item(0.2, "review")], ["r3", item(0.1, "review")], ["new-young", item(0, "new")], ["new-old", item(0, "new")]]);
		const chains: GraphChain[] = [{ id: "c1", premises: ["r2"], conclusion: "r3", createdAt: new Date(start).toISOString(), provenance: [] }];
		assert.deepEqual(dueReviews(state, nodes, chains, start + day).due, ["r3", "r2", "r1", "new-old", "new-young"]);
		assert.equal(reviewState(history([record("p", start, ["deleted"])]), nodes, start).has("deleted"), false);
	});

	it("validates missed ids and lapses only named targets", async () => {
		const gate = { problemActive: true, targets: ["a", "b"] };
		const tool = concludeTool(gate);
		const input = { outcome: "movedOn", verdict: "miss", rung: null, missClass: "cue", retest: true, missed: ["x"] } as const;
		assert.equal((await tool.execute("call", input as never)).isError, true);
		assert.equal(gate.problemActive, true);
		assert.equal((await tool.execute("call", { ...input, missed: ["a"] } as never)).isError, undefined);
		const selective = record("p", start, ["a", "b"], { outcome: "movedOn", missed: ["a"] });
		assert.equal(reviewRating(selective, "a"), "Again");
		assert.equal(reviewRating(selective, "b"), "Good");
		assert.equal(reviewRating(record("p", start, ["a", "b"], { missClass: "execution", missed: ["a"] }), "a"), "Hard");
		const conservative = { ...selective, missed: undefined };
		assert.equal(reviewRating(conservative, "b"), "Again");
	});
});

describe("review surfaces", () => {
	it("caps picks at 64 and reports truncation", () => {
		assert.equal(REVIEW_PICK_LIMIT, 64);
		assert.equal(dueIncludedMessage(65), "64 of 65 due included");
		assert.equal(dueIncludedMessage(64), null);
	});
	it("tags the model-facing pick lines", () => {
		const marker = newGraphContextMessage([{ id: "a", name: "A", statement: "A holds", tag: "review · last practised 9 days ago" }, { id: "b", name: "B", statement: "B holds", tag: "new" }], []);
		assert.match(marker.content, /A holds \(review · last practised 9 days ago\)/);
		assert.match(marker.content, /B holds \(new\)/);
	});
	it("validates the retention setting at the write and read seams", () => {
		assert.deepEqual(parseAgentSettingsBody({ desiredRetention: 0.92 }), { ok: true, settings: { desiredRetention: 0.92 } });
		assert.equal(parseAgentSettingsBody({ desiredRetention: 1 }).ok, false);
		assert.equal(parseAgentSettingsBody({ desiredRetention: "0.9" }).ok, false);
		assert.equal(sanitizeUserSettings({ version: 1, agent: { desiredRetention: 0.9 } })?.agent?.desiredRetention, 0.9);
	});
	it("calibrates pre-update R and counts only second and later reviews", () => {
		const score = reviewCalibration([record("p1", start, ["a"]), record("p2", start + 3 * day, ["a"])], [node("a")]);
		assert.equal(score.n, 1);
		assert.ok(score.brier! >= 0 && score.brier! <= 1);
		assert.ok(score.logLoss! >= 0);
	});
	it("replays 5,000 conclusions across 1,000 propositions within a generous tripwire", () => {
		const nodes = Array.from({ length: 1000 }, (_, i) => node(`n_${i}`));
		const records = Array.from({ length: 5000 }, (_, i) => record(`p_${Math.floor(i / 1000)}`, start + i * day, [`n_${i % 1000}`]));
		for (let i = 0; i < 2; i++) reviewState(history(records), nodes, start + 6000 * day);
		const t0 = performance.now();
		const state = reviewState(history(records), nodes, start + 6000 * day);
		const elapsed = performance.now() - t0;
		assert.equal(state.size, 1000);
		assert.ok(elapsed < 1000, `5,000-review replay took ${elapsed.toFixed(1)}ms`);
		console.log(`review replay: 5000 problems / 1000 propositions: ${elapsed.toFixed(2)} ms`);
	});
});
