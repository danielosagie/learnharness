import type { LhMessage } from "../../../src/core/native-messages.ts";
export function practiceProgress(messages: readonly LhMessage[]): { reviewed: number; total: number } | null {
	const context = messages.find((m) => m.role === "custom" && m.customType === "graph-context");
	const picks = (context?.role === "custom" ? (context.details as { propositions?: Array<{ id: string }> })?.propositions : undefined) ?? [];
	if (!picks.length) return null;
	const picked = new Set(picks.map((p) => p.id));
	const reviewed = new Set<string>();
	let targets: string[] = [];
	const clean = new Set(messages.filter((m) => m.role === "toolResult" && !m.isError).map((m) => m.role === "toolResult" ? m.toolCallId : ""));
	for (const m of messages) if (m.role === "assistant") for (const block of m.content) if (block.type === "toolCall") {
		if (block.name === "problem") targets = (block.arguments as { target?: string[] })?.target ?? [];
		if (block.name === "conclude" && clean.has(block.id)) for (const id of targets) if (picked.has(id)) reviewed.add(id);
	}
	return { reviewed: reviewed.size, total: picked.size };
}
export function outcomeLabel(input: { outcome?: string; rung?: string | null }): { label: string; missed: boolean } {
	if (input.outcome === "solved") return { label: "SOLVED · NO HINTS", missed: false };
	if (input.outcome === "solvedWithHints") return { label: `SOLVED WITH HINTS · ${input.rung ?? "RUNG UNKNOWN"}`, missed: false };
	return { label: "NOT YET", missed: true };
}
export function splitVerdict(verdict: string): { headline: string; rest: string } {
	const match = /[.!?](?:\s|$)/.exec(verdict);
	if (!match) return { headline: verdict, rest: "" };
	const index = match.index + 1;
	return { headline: verdict.slice(0, index), rest: verdict.slice(index).trim() };
}
