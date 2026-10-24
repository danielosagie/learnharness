import { dueReviews, practiceRecordsFromChat, reviewState } from "../core/review.ts";
import { getGraph } from "../core/graph.ts";
import type { PracticeHistory } from "../core/contracts/review.ts";
import { stores } from "./stores.ts";

/** Compose the read from the existing chat and graph adapters. No review ledger is written. */
export function readReview(now = Date.now()) {
	const history = readPracticeHistory();
	const graph = getGraph(stores.graphStore);
	const nodes = graph.nodes;
	const retention = stores.settingsStore.readSettings()?.agent?.desiredRetention ?? 0.9;
	const state = reviewState(history, nodes, now, retention);
	const queue = dueReviews(state, nodes, graph.chains, now);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	return {
		due: queue.due.map((id) => ({
			id,
			name: byId.get(id)!.name,
			statement: byId.get(id)!.statement,
			...state.get(id)!,
		})),
		nextDueAt: queue.nextDueAt === null ? null : new Date(queue.nextDueAt).toISOString(),
		state,
	};
}

/** Resolve requested propositions from the same derived review evidence. */
export function readReviewItems(ids: readonly string[], now = Date.now()) {
	const graph = getGraph(stores.graphStore);
	const state = reviewState(readPracticeHistory(), graph.nodes, now, stores.settingsStore.readSettings()?.agent?.desiredRetention ?? 0.9);
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	return [...new Set(ids)].map((id) => {
		const node = byId.get(id);
		if (!node) return null;
		const review = state.get(node.id);
		return review ? { id: node.id, name: node.name, dueAt: new Date(review.dueAt).toISOString(), lane: review.lane } : null;
	}).filter((item) => item !== null);
}

export function readPracticeHistory(): PracticeHistory {
	const records: PracticeHistory["records"][number][] = [];
	const teachChatIds = new Set<string>();
	for (const summary of stores.chatStore.listChats()) {
		if (summary.kind === "teach") teachChatIds.add(summary.id);
		if (summary.kind !== "practice") continue;
		const chat = stores.chatStore.getChat(summary.id);
		if (chat) records.push(...practiceRecordsFromChat(chat.id, chat.messages));
	}
	return { records, teachChatIds };
}
