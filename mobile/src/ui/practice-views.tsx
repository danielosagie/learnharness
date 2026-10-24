import React, { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { LhViewPart } from "../../../src/core/view.ts";
import { Markdown } from "../render/markdown";
import { useBottomSpace } from "../platform/screen";
import { Button, Icon, Label } from "./atoms";
import { C, font } from "./theme";
import { daysUntil } from "./format";
import { outcomeLabel, splitVerdict } from "./practice";
type Progress = { reviewed: number; total: number } | null;
function PracticeHeader({ progress, result = false }: { progress: Progress; result?: boolean }) {
	const current = progress ? Math.min(progress.total, progress.reviewed + (result ? 0 : 1)) : 0;
	return <><View style={{ height: 44, paddingLeft: 12, paddingRight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ width: 44, height: 44, marginLeft: -8, alignItems: "center", justifyContent: "center" }}><Icon name="back" color={C.text} size={28} /></Pressable>{progress && <Label>{current} OF {progress.total}</Label>}</View>{progress && <View style={{ flexDirection: "row", gap: 3, paddingHorizontal: 24, marginTop: 2 }}>{Array.from({ length: progress.total }, (_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < current - 1 ? C.text : i === current - 1 ? C.lamp : C.pressed }} />)}</View>}</>;
}
export function PracticeView({ input, progress, work, setWork, submit, ask, reply, busy, error, dismiss, stop }: { input: { statement?: string }; progress: Progress; work: string; setWork(v: string): void; submit(): void; ask(text: string): void; reply?: string; busy: boolean; error: string | null; dismiss(): void; stop(): void }) {
	const bottom = useBottomSpace();
	const [asking, setAsking] = useState(false);
	const [question, setQuestion] = useState("");
	const [editing, setEditing] = useState(false);
	return <View style={{ flex: 1 }}><PracticeHeader progress={progress} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 36, paddingBottom: 24 }}>
		<Pressable accessibilityLabel="Problem" accessibilityHint="Hold to dismiss this problem" accessibilityActions={[{ name: "dismiss", label: "Dismiss problem" }]} onAccessibilityAction={dismiss} hitSlop={15} onLongPress={dismiss}><Label>PROBLEM</Label></Pressable><View style={{ marginTop: 14 }}><Markdown text={input.statement ?? ""} size={19} lineHeight={27} displaySize={30} /></View>
		<View style={{ marginTop: 24, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 236, gap: 10 }}><Label>YOUR WORK</Label>{editing || !work ? <TextInput accessibilityLabel="Your work" multiline autoFocus={editing} value={work} onChangeText={setWork} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} placeholder="Work through the problem here" placeholderTextColor={C.muted} selectionColor={C.lamp} style={{ color: C.text, fontFamily: font.prose, fontSize: 17, lineHeight: 25, minHeight: 180, textAlignVertical: "top", padding: 0 }} /> : <Pressable accessibilityLabel="Edit your work" onPress={() => setEditing(true)} style={{ minHeight: 180, gap: 10 }}><Markdown text={work} size={17} lineHeight={25} displaySize={19} /><View style={{ width: 2, height: 22, backgroundColor: C.lamp }} /></Pressable>}</View>
		{reply ? <Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 17, lineHeight: 26, marginTop: 15 }}>{reply}</Text> : null}{error && <Text style={{ color: C.miss, fontFamily: font.prose, marginTop: 16 }}>{error}</Text>}
		{asking && <TextInput autoFocus value={question} onChangeText={setQuestion} placeholder="Ask your tutor" placeholderTextColor={C.muted} style={{ color: C.text, backgroundColor: C.raised, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 16, fontFamily: font.prose, fontSize: 17 }} />}
	</ScrollView><View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottom }}><Button secondary onPress={() => setAsking(true)} style={{ width: 120 }}><Icon name="mic" color={C.text} size={18} /> ASK</Button>{busy ? <Button onPress={stop} style={{ flex: 1 }}>STOP</Button> : asking ? <Button disabled={!question.trim()} onPress={() => { ask(question.trim()); setQuestion(""); setAsking(false); }} style={{ flex: 1 }}>SEND QUESTION</Button> : <Button disabled={!work.trim()} onPress={submit} style={{ flex: 1 }}>SUBMIT WORK</Button>}</View></View>;
}
export function ResultView({ part, items, next, busy, progress, error }: { part: LhViewPart; items: { id: string; name: string; dueAt: string }[]; next(): void; busy: boolean; progress: Progress; error: string | null }) {
	const bottom = useBottomSpace();
	const input = (part.input ?? {}) as { outcome?: string; verdict?: string; rung?: string | null };
	const { label, missed } = outcomeLabel(input);
	const { headline, rest } = splitVerdict(input.verdict ?? "");
	const [solution, setSolution] = useState(false);
	return <View style={{ flex: 1 }}><PracticeHeader progress={progress} result /><ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24 }}>
		<View style={{ gap: 10 }}><View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name="check" color={missed ? C.miss : C.sure} size={14} /><Label color={missed ? C.miss : C.sure}>{label}</Label></View><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 34, lineHeight: 40, letterSpacing: -0.34 }}>{headline}</Text>{!!rest && <Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 17, lineHeight: 25 }}>{rest}</Text>}</View>
		<View style={{ marginTop: 32, borderBottomWidth: 1, borderColor: C.hairline }}>{items.map((item) => <View key={item.id} style={{ borderTopWidth: 1, borderColor: C.hairline, paddingVertical: 14, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}><Text style={{ flexShrink: 1, color: C.text, fontFamily: font.prose, fontSize: 17, lineHeight: 22 }}>{item.name}</Text><Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 12, lineHeight: 16 }}>{daysUntil(item.dueAt)}</Text></View>)}</View>
		<Pressable onPress={() => setSolution(!solution)} style={{ minHeight: 44, paddingTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Label>MODEL SOLUTION</Label><View style={{ transform: [{ rotate: solution ? "-90deg" : "90deg" }] }}><Icon name="chevron" size={16} /></View></Pressable>{solution && <View style={{ marginTop: 20 }}><Markdown text={String(part.reveal ?? "")} /></View>}{error && <Text style={{ color: C.miss, fontFamily: font.prose, marginTop: 16 }}>{error}</Text>}
	</ScrollView><View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottom }}><Button disabled={busy} arrow onPress={next}>NEXT PROBLEM</Button></View></View>;
}
