import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { buildAnswer, CONFIDENCE_STOPS, emptyDockSelection, toggleOption, toggleOther, type QuestionAnswerData } from "../../../src/core/question-core.ts";
import { Markdown } from "../render/markdown";
import { useBottomSpace } from "../platform/screen";
import { questionData, type PendingCheck } from "./check-model";
import { Button, Label } from "./atoms";
import { C, font } from "./theme";
export type { PendingCheck } from "./check-model";
const colors = ["#EF4444", "#F97316", "#EAB308", "#84CC16", "#22C55E", "#10B981"];
function ConfidenceSlider({ index, onChange }: { index: number; onChange(index: number): void }) {
	const [width, setWidth] = useState(1);
	const value = CONFIDENCE_STOPS[index] ?? 50;
	const move = (x: number) => onChange(CONFIDENCE_STOPS.reduce((best, stop, i) => Math.abs(stop - x / width * 100) < Math.abs(CONFIDENCE_STOPS[best]! - x / width * 100) ? i : best, 0));
	return <View accessibilityLabel="Confidence" accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 100, now: value }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(event) => onChange(Math.max(0, Math.min(5, index + (event.nativeEvent.actionName === "increment" ? 1 : -1))))} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} onStartShouldSetResponder={() => true} onResponderGrant={(event) => move(event.nativeEvent.locationX)} onResponderMove={(event) => move(event.nativeEvent.locationX)} style={{ height: 44, marginTop: -11, justifyContent: "center" }}>
		<View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: C.ink }}><View style={{ width: `${value}%`, height: 4, borderRadius: 2, backgroundColor: colors[index] }} /></View>
		<View pointerEvents="none" style={{ position: "absolute", left: Math.max(0, Math.min(width - 22, width * value / 100 - 11)), width: 22, height: 22, borderRadius: 11, backgroundColor: C.text }} />
	</View>;
}
export function CheckSheet({ pending, readingThinking, onClose, onSubmit, onDismiss, disabled = false }: { pending: PendingCheck | null; readingThinking: string; onClose(): void; onSubmit(answer: QuestionAnswerData): void; onDismiss(): void; disabled?: boolean }) {
	const bottom = useBottomSpace();
	const [selection, setSelection] = useState(emptyDockSelection);
	const [other, setOther] = useState("");
	const [text, setText] = useState("");
	const [thinkingHeight, setThinkingHeight] = useState(22);
	const [thinking, setThinking] = useState("");
	const [confidence, setConfidence] = useState(2);
	const qd = useMemo(() => pending ? questionData(pending) : null, [pending]);
	const mode = qd?.mode === "multi-select" ? "multi-select" : "single-select";
	const canSubmit = qd?.mode === "text" ? !!text.trim() : selection.dontKnow || !!selection.selected.size || (selection.otherSelected && !!other.trim());
	const submit = () => { if (qd && pending && canSubmit && !disabled) onSubmit(buildAnswer(qd, { values: [...selection.selected].map((i) => qd.options[i]!.value), dontKnow: selection.dontKnow, other: selection.otherSelected ? other : undefined, text, thinking, readingThinking, confidence: qd.kind === "quiz" ? CONFIDENCE_STOPS[confidence] : undefined }, pending.tool)); };
	return <Modal visible={!!pending} transparent animationType="slide" onRequestClose={onClose}><View style={{ flex: 1, justifyContent: "flex-end" }}><Pressable accessibilityLabel="Close check sheet" onPress={onClose} style={{ position: "absolute", inset: 0, backgroundColor: "#0009" }} /><View style={{ backgroundColor: C.raised, borderColor: C.line, borderTopWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" }}>
		<Pressable accessibilityLabel="Close check sheet" onPress={onClose} style={{ width: 76, height: 44, alignSelf: "center", alignItems: "center", paddingTop: 10, marginBottom: -7 }}><View style={{ width: 36, height: 5, backgroundColor: C.line, borderRadius: 3 }} /></Pressable>
		<ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottom, gap: 16 }} keyboardShouldPersistTaps="handled">
			<View style={{ height: 44, marginVertical: -15, marginHorizontal: -15, paddingLeft: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Label color={C.lamp}>{pending?.tool === "probe" ? "PROBE" : pending?.tool === "recall" ? "RECALL" : "CHECK"}</Label><Pressable disabled={disabled} accessibilityLabel="Dismiss check" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }} onPress={onDismiss}><Text style={{ fontFamily: font.mono, fontSize: 11, lineHeight: 14, color: C.muted }}>×</Text></Pressable></View>
			<Markdown text={qd?.question ?? ""} size={18} />
			{qd?.context ? <Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 17, lineHeight: 26 }}>{qd.context}</Text> : null}
			{qd?.mode === "text" ? <TextInput multiline value={text} onChangeText={setText} placeholder="Your answer" placeholderTextColor={C.muted} style={{ color: C.text, fontFamily: font.prose, fontSize: 17, minHeight: 120, backgroundColor: C.ink, padding: 16, borderRadius: 12 }} /> : <View style={{ gap: 8 }}>{qd?.options.map((option, i) => { const active = selection.selected.has(i); return <Pressable accessibilityRole="radio" accessibilityState={{ selected: active }} key={option.value} onPress={() => setSelection((old) => toggleOption(mode, old, i))} style={{ borderColor: active ? C.text : C.line, borderWidth: active ? 1.5 : 1, borderRadius: 12, minHeight: 50, paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: active ? C.pressed : C.raised }}><View style={{ width: 18, height: 18, borderRadius: mode === "multi-select" ? 4 : 9, borderColor: active ? C.text : C.muted, borderWidth: active ? 5 : 1.5 }} /><View style={{ flex: 1 }}><Markdown text={option.label} size={20} serif />{option.description ? <Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 15 }}>{option.description}</Text> : null}</View></Pressable>; })}
			{qd?.kind === "quiz" && <Pressable onPress={() => setSelection((old) => ({ selected: new Set(), otherSelected: false, dontKnow: !old.dontKnow }))} style={{ minHeight: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderStyle: "dashed", borderColor: selection.dontKnow ? C.text : C.line, borderRadius: 12 }}><View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: selection.dontKnow ? 5 : 1, borderStyle: "dashed", borderColor: C.muted }} /><Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 13 }}>I don’t know</Text></Pressable>}
			{qd?.kind === "ask" && <Pressable onPress={() => setSelection((old) => toggleOther(mode, old))} style={{ minHeight: 50, padding: 14, borderWidth: 1, borderColor: selection.otherSelected ? C.text : C.line, borderRadius: 12 }}><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 17 }}>Other</Text>{selection.otherSelected && <TextInput value={other} onChangeText={setOther} placeholder="Write your answer" placeholderTextColor={C.muted} style={{ color: C.text, fontFamily: font.prose, paddingTop: 10 }} />}</Pressable>}</View>}
			{qd?.kind === "quiz" && <View style={{ paddingTop: 4, gap: 10, marginBottom: -11, opacity: selection.dontKnow ? 0.4 : 1 }} pointerEvents={selection.dontKnow ? "none" : "auto"}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Label>HOW SURE</Label><Text style={{ color: C.text, fontFamily: font.mono, fontSize: 13, lineHeight: 16 }}>{selection.dontKnow ? "—" : `${CONFIDENCE_STOPS[confidence]}%`}</Text></View><ConfidenceSlider index={confidence} onChange={setConfidence} /></View>}
			{qd?.mode !== "text" && <View style={{ backgroundColor: C.ink, borderWidth: 1, borderColor: C.hairline, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 6, minHeight: 72 }}><Label>YOUR THINKING</Label><TextInput hitSlop={11} value={thinking} onChangeText={setThinking} onContentSizeChange={(event) => setThinkingHeight(Math.max(22, Math.min(120, event.nativeEvent.contentSize.height)))} multiline placeholder="What makes you think so?" placeholderTextColor={C.muted} style={{ color: C.text, fontFamily: font.prose, fontSize: 16, lineHeight: 22, height: thinkingHeight, minHeight: 22, padding: 0 }} /></View>}
			<Button disabled={!canSubmit || disabled} onPress={submit}>SUBMIT</Button>
		</ScrollView></View></View></Modal>;
}
