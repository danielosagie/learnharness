import type { GraphChain, GraphNode } from "./contracts/graph.ts";
import type { PracticeHistory, PracticeRecord, PropositionReviewState, ReviewRating } from "./contracts/review.ts";
import type { LhMessage } from "./native-messages.ts";

const DAY = 86_400_000;
export const REVIEW_PICK_LIMIT = 64;
export function dueIncludedMessage(count: number): string | null {
	return count > REVIEW_PICK_LIMIT ? `${REVIEW_PICK_LIMIT} of ${count} due included` : null;
}
// py-fsrs 6.3.2 DEFAULT_PARAMETERS. Only the long-term memory equations run here.
export const FSRS_W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542] as const;
const FACTOR = 0.9 ** (-1 / FSRS_W[20]) - 1;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function fsrsRetrievability(stability: number, elapsedDays: number): number {
	return (1 + FACTOR * Math.max(0, elapsedDays) / stability) ** -FSRS_W[20];
}

export function fsrsInterval(stability: number, retention: number): number {
	return stability / FACTOR * (retention ** (-1 / FSRS_W[20]) - 1);
}

export function fsrsUpdate(previous: { stability: number; difficulty: number } | null, rating: ReviewRating, elapsedDays = 0): { stability: number; difficulty: number } {
	const n = rating === "Again" ? 1 : rating === "Hard" ? 2 : 3;
	if (!previous) return {
		stability: FSRS_W[n - 1]!,
		difficulty: clamp(FSRS_W[4] - Math.exp(FSRS_W[5] * (n - 1)) + 1, 1, 10),
	};
	const { stability: s, difficulty: d } = previous;
	const r = fsrsRetrievability(s, elapsedDays);
	const nextDifficulty = clamp(FSRS_W[7] * (FSRS_W[4] - Math.exp(FSRS_W[5] * 3) + 1) + (1 - FSRS_W[7]) * (d + (10 - d) * (-FSRS_W[6] * (n - 3)) / 9), 1, 10);
	const nextStability = rating === "Again"
		? Math.min(FSRS_W[11] * d ** -FSRS_W[12] * ((s + 1) ** FSRS_W[13] - 1) * Math.exp((1 - r) * FSRS_W[14]), s / Math.exp(FSRS_W[17] * FSRS_W[18]))
		: s * (1 + Math.exp(FSRS_W[8]) * (11 - d) * s ** -FSRS_W[9] * (Math.exp((1 - r) * FSRS_W[10]) - 1) * (rating === "Hard" ? FSRS_W[15] : 1));
	return { stability: Math.max(0.001, nextStability), difficulty: nextDifficulty };
}

export function reviewRating(record: PracticeRecord, target: string): ReviewRating | null {
	if (record.outcome === "dismissed") return null;
	if (record.missed) {
		if (record.missed.includes(target)) {
			if (record.outcome !== "movedOn" && record.outcome !== "surrendered" && (!record.rung || record.rung < "R3") && (record.missClass === "execution" || record.missClass === "careless")) return "Hard";
			return "Again";
		}
		if (record.outcome === "movedOn" || record.outcome === "surrendered" || (record.rung && record.rung >= "R3")) return "Good";
	}
	if (record.outcome === "movedOn" || record.outcome === "surrendered" || (record.rung && record.rung >= "R3")) return "Again";
	if (record.missClass === "execution" || record.missClass === "careless") return "Hard";
	if (record.outcome === "solved" && record.rung === null) return "Good";
	return "Hard";
}

/** Read clean pose/conclude pairs, preserving the conclude's timestamp. */
export function practiceRecordsFromChat(chatId: string, messages: readonly LhMessage[]): PracticeRecord[] {
	const clean = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult" && !message.isError) clean.add(message.toolCallId);
	}
	const records: PracticeRecord[] = [];
	let active: string[] | null = null;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type !== "toolCall" || !clean.has(block.id)) continue;
			const args = block.arguments as Record<string, unknown>;
			if (block.name === "problem") {
				active = Array.isArray(args.target) ? args.target.filter((id): id is string => typeof id === "string") : [];
			} else if (block.name === "conclude" && active !== null) {
				if (typeof args.outcome === "string" && ["solved", "solvedWithHints", "movedOn", "surrendered", "dismissed"].includes(args.outcome)) {
					records.push({ chatId, at: message.timestamp, targets: active, outcome: args.outcome as PracticeRecord["outcome"], rung: typeof args.rung === "string" ? args.rung as PracticeRecord["rung"] : null, missClass: typeof args.missClass === "string" ? args.missClass as PracticeRecord["missClass"] : null, ...(Array.isArray(args.missed) ? { missed: args.missed.filter((id): id is string => typeof id === "string") } : {}) });
				}
				active = null;
			}
		}
	}
	return records;
}

/** Replay only the first concluded target per session; later retests are in-session practice. */
export function reviewState(practiceRecords: PracticeHistory, graphNodes: readonly GraphNode[], now: number, retention = 0.9): Map<string, PropositionReviewState> {
	const nodes = new Map(graphNodes.map((node) => [node.id, node]));
	const state = new Map<string, PropositionReviewState>();
	for (const node of graphNodes) {
		if (!practiceRecords.teachChatIds.has(node.provenance[0]?.chatId ?? "")) continue;
		state.set(node.id, { stability: null, difficulty: null, lastReview: null, reviews: 0, retrievability: null, dueAt: Date.parse(node.createdAt) + FSRS_W[2] * DAY, lane: "new" });
	}
	const seen = new Set<string>();
	for (const record of [...practiceRecords.records].sort((a, b) => a.at - b.at)) {
		if (record.outcome === "dismissed") continue;
		for (const id of new Set(record.targets)) {
			if (!nodes.has(id)) continue;
			const key = `${record.chatId}\0${id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const rating = reviewRating(record, id);
			if (!rating) continue;
			const prior = state.get(id);
			const next = fsrsUpdate(prior?.stability != null && prior.difficulty != null ? { stability: prior.stability, difficulty: prior.difficulty } : null, rating, prior?.lastReview == null ? 0 : Math.max(0, (record.at - prior.lastReview) / DAY));
			state.set(id, { ...next, lastReview: record.at, reviews: (prior?.reviews ?? 0) + 1, retrievability: fsrsRetrievability(next.stability, (now - record.at) / DAY), dueAt: record.at + fsrsInterval(next.stability, retention) * DAY, lane: "review" });
		}
	}
	return state;
}

export function dueReviews(state: ReadonlyMap<string, PropositionReviewState>, nodes: readonly GraphNode[], chains: readonly GraphChain[], now: number): { due: string[]; nextDueAt: number | null } {
	const serves = new Map<string, number>();
	for (const chain of chains) for (const id of chain.premises) serves.set(id, (serves.get(id) ?? 0) + 1);
	const born = new Map(nodes.map((node) => [node.id, Date.parse(node.createdAt)]));
	const due = [...state].filter(([, item]) => item.dueAt <= now).sort(([a, x], [b, y]) => {
		if (x.lane !== y.lane) return x.lane === "review" ? -1 : 1;
		return x.lane === "review" ? (x.retrievability! - y.retrievability! || (serves.get(b) ?? 0) - (serves.get(a) ?? 0) || a.localeCompare(b)) : (born.get(a)! - born.get(b)! || a.localeCompare(b));
	}).map(([id]) => id);
	const future = [...state.values()].filter((item) => item.dueAt > now).map((item) => item.dueAt);
	return { due, nextDueAt: future.length ? Math.min(...future) : null };
}

/** Score only later reviews: the first practice establishes state but has no forecast. */
export function reviewCalibration(records: readonly PracticeRecord[], nodes: readonly GraphNode[]): { brier: number | null; logLoss: number | null; n: number } {
	const live = new Set(nodes.map((node) => node.id));
	const seen = new Set<string>();
	const state = new Map<string, { stability: number; difficulty: number; at: number }>();
	let brier = 0;
	let logLoss = 0;
	let n = 0;
	for (const record of [...records].sort((a, b) => a.at - b.at)) {
		if (record.outcome === "dismissed") continue;
		for (const id of new Set(record.targets)) {
			if (!live.has(id)) continue;
			const key = `${record.chatId}\0${id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const rating = reviewRating(record, id);
			if (!rating) continue;
			const previous = state.get(id);
			const days = previous ? Math.max(0, (record.at - previous.at) / DAY) : 0;
			if (previous) {
				const r = clamp(fsrsRetrievability(previous.stability, days), 1e-12, 1 - 1e-12);
				const success = rating === "Again" ? 0 : 1;
				brier += (r - success) ** 2;
				logLoss -= success ? Math.log(r) : Math.log(1 - r);
				n++;
			}
			state.set(id, { ...fsrsUpdate(previous ?? null, rating, days), at: record.at });
		}
	}
	return { brier: n ? brier / n : null, logLoss: n ? logLoss / n : null, n };
}
