import { normalizeOptions, normalizeQuizType, resolveCorrect, seededRandom, shuffleOptions, type QuestionData } from "../../../src/core/question-core.ts";
export interface PendingCheck { toolCallId: string; tool: string; input: unknown }
export function questionData(pending: PendingCheck): QuestionData {
	const input = pending.input as { question?: string; options?: { label: string; value?: string }[]; details?: string; correctAnswer?: string | string[]; explanation?: string; multiSelect?: boolean; type?: string };
	const kind = pending.tool === "quiz" || pending.tool === "probe" ? "quiz" : pending.tool === "explain" || pending.tool === "recall" ? "explain" : "ask";
	const options = normalizeOptions(kind === "explain" ? [] : input.options ?? []);
	const ordered = kind === "quiz" ? shuffleOptions(options, seededRandom(pending.toolCallId)) : options;
	return { id: pending.toolCallId, kind, question: input.question ?? "", context: input.details, mode: kind === "quiz" || ordered.length ? input.multiSelect ? "multi-select" : "single-select" : "text", options: ordered, correctIndices: kind === "quiz" ? resolveCorrect(input.correctAnswer ?? "", ordered).indices : undefined, explanation: input.explanation, committedAnswer: kind === "explain" ? String(input.correctAnswer ?? "") : undefined, questionType: kind === "quiz" ? normalizeQuizType(input.type) : undefined, createdAt: "" };
}
