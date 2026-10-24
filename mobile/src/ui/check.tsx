import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { buildAnswer, CONFIDENCE_STOPS, normalizeOptions, normalizeQuizType, resolveCorrect, seededRandom, shuffleOptions, type QuestionAnswerData, type QuestionData } from "../../../src/core/question-core.ts";
import { Markdown } from "../render/markdown";
import { Button, Label } from "./atoms";
import { C, font } from "./theme";
const colors = ["#EF4444", "#F97316", "#EAB308", "#84CC16", "#22C55E", "#10B981"];
function ConfidenceSlider({ index, onChange }: { index: number; onChange(index: number): void }) {
	const [width, setWidth] = useState(1);
	const value = CONFIDENCE_STOPS[index] ?? 50;
	return <Pressable onLayout={(event) => setWidth(event.nativeEvent.layout.width)} onPress={(event) => { const x = event.nativeEvent.locationX / width * 100; onChange(CONFIDENCE_STOPS.reduce((best, stop, i) => Math.abs(stop - x) < Math.abs(CONFIDENCE_STOPS[best]! - x) ? i : best, 0)); }} style={{ height: 30, justifyContent: "center" }}>
		<View style={{ height: 4, borderRadius: 3, backgroundColor: C.ink }}><View style={{ width: `${value}%`, height: 4, borderRadius: 3, backgroundColor: colors[index] }} /></View>
		<View pointerEvents="none" style={{ position: "absolute", left: Math.max(0, Math.min(width - 23, width * value / 100 - 11)), width: 23, height: 23, borderRadius: 12, backgroundColor: C.text }} />
	</Pressable>;
}
export interface PendingCheck { toolCallId: string; tool: string; input: unknown }
export function CheckSheet({ pending, readingThinking, onClose, onSubmit, onDismiss }: { pending: PendingCheck | null; readingThinking: string; onClose(): void; onSubmit(answer: QuestionAnswerData): void; onDismiss(): void }) {
	const [selected, setSelected] = useState<string[]>([]);
	const [dontKnow, setDontKnow] = useState(false);
	const [other, setOther] = useState("");
	const [otherSelected, setOtherSelected] = useState(false);
	const [text, setText] = useState("");
	const [thinking, setThinking] = useState("");
	const [confidence, setConfidence] = useState(2);
	const input = (pending?.input ?? {}) as { question?: string; options?: { label: string; value?: string; description?: string }[]; details?: string; correctAnswer?: string | string[]; explanation?: string; multiSelect?: boolean; type?: string };
	const isQuiz = pending?.tool === "quiz" || pending?.tool === "probe";
	const kind = isQuiz ? "quiz" : pending?.tool === "explain" || pending?.tool === "recall" ? "explain" : "ask";
	const qd = useMemo<QuestionData | null>(() => {
		if (!pending) return null;
		const options = normalizeOptions(input.options ?? []);
		const ordered = isQuiz ? shuffleOptions(options, seededRandom(pending.toolCallId)) : options;
		return { id: pending.toolCallId, kind, question: input.question ?? "", context: input.details, mode: options.length ? input.multiSelect ? "multi-select" : "single-select" : "text", options: ordered, correctIndices: isQuiz ? resolveCorrect(input.correctAnswer ?? "", ordered).indices : undefined, explanation: input.explanation, committedAnswer: kind === "explain" ? String(input.correctAnswer ?? "") : undefined, questionType: isQuiz ? normalizeQuizType(input.type) : undefined, createdAt: new Date().toISOString() };
	}, [pending]);
	const select = (value: string) => { setDontKnow(false); setSelected((old) => qd?.mode === "multi-select" ? old.includes(value) ? old.filter((v) => v !== value) : [...old, value] : [value]); if (qd?.mode !== "multi-select") setOtherSelected(false); };
	const submit = () => {
		if (!qd || !pending) return;
		onSubmit(buildAnswer(qd, { values: selected, dontKnow, other: otherSelected ? other : undefined, text, thinking, readingThinking, confidence: isQuiz ? CONFIDENCE_STOPS[confidence] : undefined }, pending.tool));
	};
	const canSubmit = qd?.mode === "text" ? !!text.trim() : dontKnow || !!selected.length || (otherSelected && !!other.trim());
	return <Modal visible={!!pending} transparent animationType="slide" onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: "#0009", justifyContent: "flex-end" }}><View style={{ backgroundColor: C.raised, borderColor: C.line, borderWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%", paddingTop: 10 }}>
		<View style={{ width: 36, height: 5, backgroundColor: C.line, borderRadius: 3, alignSelf: "center", marginBottom: 22 }} />
		<ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 35, gap: 12 }} keyboardShouldPersistTaps="handled">
			<Label color={C.lamp}>{pending?.tool === "probe" ? "PROBE" : pending?.tool === "recall" ? "RECALL" : "CHECK"}</Label>
			<Markdown text={input.question ?? ""} />
			{input.details ? <Text style={{ color: C.muted, fontFamily: font.prose }}>{input.details}</Text> : null}
			{qd?.mode === "text" ? <TextInput multiline value={text} onChangeText={setText} placeholder="Your answer" placeholderTextColor={C.muted} style={{ color: C.text, fontFamily: font.prose, fontSize: 17, minHeight: 120, backgroundColor: C.ink, padding: 16, borderRadius: 10, marginTop: 12 }} /> : qd?.options.map((option) => { const active = selected.includes(option.value); return <Pressable key={option.value} onPress={() => select(option.value)} style={{ borderColor: active ? C.text : C.line, borderWidth: 1, borderRadius: 11, minHeight: 53, padding: 14, flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: active ? C.pressed : C.raised }}><View style={{ width: 19, height: 19, borderRadius: 10, borderColor: active ? C.text : C.muted, borderWidth: active ? 6 : 1 }} /><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 20, flex: 1 }}>{option.label}</Text></Pressable>; })}
			{isQuiz && qd?.mode !== "text" && <Pressable onPress={() => { setDontKnow(true); setSelected([]); }} style={{ padding: 15, borderWidth: 1, borderStyle: "dashed", borderColor: C.line, borderRadius: 10 }}><Text style={{ color: C.muted, fontFamily: font.mono }}>○  I don’t know</Text></Pressable>}
			{kind === "ask" && qd?.mode !== "text" && <Pressable onPress={() => { setOtherSelected(true); if (qd?.mode === "single-select") setSelected([]); }} style={{ padding: 14, borderWidth: 1, borderColor: otherSelected ? C.text : C.line, borderRadius: 10 }}><Text style={{ color: C.text }}>Other</Text>{otherSelected && <TextInput value={other} onChangeText={setOther} placeholder="Write your answer" placeholderTextColor={C.muted} style={{ color: C.text, paddingTop: 10 }} />}</Pressable>}
			{isQuiz && !dontKnow && <View style={{ marginTop: 10, gap: 12 }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Label>HOW SURE</Label><Text style={{ color: C.text, fontFamily: font.mono }}>{CONFIDENCE_STOPS[confidence]}%</Text></View><ConfidenceSlider index={confidence} onChange={setConfidence} /></View>}
			{qd?.mode !== "text" && <View style={{ backgroundColor: C.ink, borderRadius: 10, padding: 14, marginTop: 14 }}><Label>YOUR THINKING</Label><TextInput value={thinking} onChangeText={setThinking} multiline placeholder="What makes you think so?" placeholderTextColor={C.muted} style={{ color: C.text, fontFamily: font.prose, fontSize: 16, minHeight: 55 }} /></View>}
			<Button disabled={!canSubmit} onPress={submit}>SUBMIT</Button><Pressable onPress={onDismiss} style={{ padding: 10, alignItems: "center" }}><Label>DISMISS CHECK</Label></Pressable>
		</ScrollView></View></View></Modal>;
}
