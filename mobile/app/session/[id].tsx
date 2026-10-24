import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { WebView } from "react-native-webview";
import { SvgXml } from "react-native-svg";
import { danglingQuestionOf, activeProblemOf, hasProbeDone, type LhMessage } from "../../../src/core/native-messages.ts";
import { type LhViewMessage, type LhViewPart } from "../../../src/core/view.ts";
import { dismissedAnswer } from "../../../src/core/question-core.ts";
import { PhoneSession } from "../../src/net/session";
import { usePhone } from "../../src/net/runtime";
import { Markdown } from "../../src/render/markdown";
import { CheckSheet, type PendingCheck } from "../../src/ui/check";
import { Button, Label } from "../../src/ui/atoms";
import { daysUntil } from "../../src/ui/format";
import { outcomeLabel, practiceProgress, splitVerdict } from "../../src/ui/practice";
import { C, font } from "../../src/ui/theme";

function toolPart(part: LhViewPart, openDemo: (html: string) => void) {
	const name = part.type.slice(5);
	const input = (part.input ?? {}) as Record<string, unknown>;
	const output = (part.output ?? {}) as Record<string, unknown>;
	if (["quiz", "probe", "ask_user_question", "explain", "recall"].includes(name)) {
		if (part.state !== "output-available") return null;
		const answer = output as { questionText?: string; answers?: { label: string }[]; text?: string; other?: string; correct?: boolean; explanation?: string; dismissed?: boolean };
		return <View style={{ backgroundColor: C.raised, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.hairline, gap: 5 }}><Label color={C.lamp}>CHECK</Label><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 15 }}>{answer.questionText ?? String(input.question ?? "")}</Text><Text style={{ color: answer.correct === false ? C.miss : C.text, fontFamily: font.prose }}>Your answer: {answer.dismissed ? "skipped" : answer.answers?.map((a) => a.label).join(", ") || answer.text || answer.other || "—"} {answer.correct === true ? "✓" : answer.correct === false ? "✗" : ""}</Text>{answer.explanation ? <Text style={{ color: C.muted, fontFamily: font.prose }}>{answer.explanation}</Text> : null}</View>;
	}
	if (name === "problem") return <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16 }}><Label>PROBLEM</Label><Markdown text={String(input.statement ?? "")} /></View>;
	if (name === "conclude") return <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16, gap: 7 }}><Label>CONCLUDED</Label><Text style={{ color: C.text, fontFamily: font.prose }}>{String(input.verdict ?? "")}</Text></View>;
	if (name === "demo") return <Pressable onPress={() => { const html = String(output.html ?? output.srcDoc ?? ""); if (html) openDemo(html); }} style={{ backgroundColor: C.raised, borderRadius: 12, padding: 16 }}><Label>DEMO</Label><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 17 }}>{String(output.title ?? input.brief ?? "Open demo")}  ›</Text></Pressable>;
	if (name === "visual" && typeof output.svg === "string") return <SvgXml xml={sanitizeSvg(output.svg)} width="100%" />;
	if (name === "research") return <View style={{ gap: 5 }}><Label>RESEARCH</Label><Text style={{ color: C.text }}>{String(output.brief ?? input.brief ?? "Research completed")}</Text>{Array.isArray(output.sources) && output.sources.map((source: unknown, i: number) => { const url = typeof source === "string" ? source : String((source as { url?: string }).url ?? ""); return <Text key={i} onPress={() => void Linking.openURL(url)} style={{ color: C.muted, textDecorationLine: "underline" }}>{url}</Text>; })}</View>;
	return <Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 11 }}>{name.replaceAll("_", " ")}</Text>;
}
function sanitizeSvg(svg: string): string { return svg.replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<script[^>]*\/?>/gi, "").replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(?:href|xlink:href)\s*=\s*(?:"\s*(?:javascript|data:text\/html)[^"]*"|'\s*(?:javascript|data:text\/html)[^']*'|(?:javascript|data:text\/html)[^\s>]*)/gi, ""); }
function sandboxDemo(html: string): string {
	const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'">`;
	return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => head + policy) : policy + html;
}
function Transcript({ messages, openDemo }: { messages: LhViewMessage[]; openDemo(html: string): void }) {
	return <View style={{ gap: 22 }}>{messages.map((message) => <View key={message.id} style={{ gap: 16 }}>{message.parts.map((part, i) => {
		if (part.type === "reasoning" || part.type === "step-start") return null;
		if (part.type === "text") return <Markdown key={i} text={String(part.text ?? "")} />;
		if (part.type.startsWith("tool-")) return <View key={i}>{toolPart(part, openDemo)}</View>;
		if (part.type === "data-practice-thinking") return <View key={i} style={{ borderLeftWidth: 2, borderColor: C.line, paddingLeft: 15 }}><Label>YOUR WORK</Label><Markdown text={String((part.data as { text?: string })?.text ?? "")} /></View>;
		if (part.type === "data-subagent-artifact") { const data = part.data as { kind?: string; result?: { svg?: string; html?: string; srcDoc?: string; brief?: string; sources?: Array<string | { title: string; url: string }> } }; if (data.kind === "visual" && data.result?.svg) return <SvgXml key={i} xml={sanitizeSvg(data.result.svg)} width="100%" />; if (data.kind === "demo" && (data.result?.html || data.result?.srcDoc)) return <Pressable key={i} onPress={() => openDemo(data.result?.html ?? data.result?.srcDoc ?? "")}><Label>DEMO  ›</Label></Pressable>; if (data.kind === "research") return <View key={i} style={{ gap: 8 }}><Label>RESEARCH</Label><Text style={{ color: C.text, fontFamily: font.prose }}>{data.result?.brief}</Text>{data.result?.sources?.map((source, n) => { const url = typeof source === "string" ? source : source.url; return <Text key={n} onPress={() => void Linking.openURL(url)} style={{ color: C.muted, textDecorationLine: "underline" }}>{typeof source === "string" ? source : source.title}</Text>; })}</View>; return null; }
		return null;
	})}</View>)}</View>;
}
function PracticeView({ input, progress, work, setWork, submit, ask, reply }: { input: { statement?: string }; progress: { reviewed: number; total: number } | null; work: string; setWork(v: string): void; submit(): void; ask(text: string): void; reply?: string }) {
	const [asking, setAsking] = useState(false);
	const [question, setQuestion] = useState("");
	return <View style={{ flex: 1, padding: 24 }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Pressable onPress={() => router.back()}><Text style={{ color: C.text, fontSize: 30 }}>‹</Text></Pressable>{progress && <Label>{progress.reviewed + 1} OF {progress.total}</Label>}</View>{progress && <View style={{ flexDirection: "row", gap: 4, marginTop: 10 }}>{Array.from({ length: progress.total }, (_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: i < progress.reviewed ? C.text : i === progress.reviewed ? C.lamp : C.pressed }} />)}</View>}
		<View style={{ marginTop: 40 }}><Label>PROBLEM</Label><View style={{ marginTop: 24 }}><Markdown text={input.statement ?? ""} /></View></View>
		<View style={{ marginTop: 40, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16, minHeight: 220 }}><Label>YOUR WORK</Label><TextInput multiline value={work} onChangeText={setWork} placeholder="Work through the problem here" placeholderTextColor={C.muted} style={{ color: C.text, fontFamily: font.prose, fontSize: 17, flex: 1, textAlignVertical: "top", marginTop: 12 }} /></View>
		{reply ? <Text style={{ color: C.muted, fontFamily: font.prose, marginTop: 15 }}>{reply}</Text> : null}<View style={{ flex: 1 }} />{asking && <TextInput autoFocus value={question} onChangeText={setQuestion} placeholder="Ask your tutor" placeholderTextColor={C.muted} style={{ color: C.text, backgroundColor: C.raised, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 12, fontFamily: font.prose }} />}
		<View style={{ flexDirection: "row", gap: 10 }}><Button secondary onPress={() => setAsking(true)} style={{ flex: 1 }}>ASK</Button>{asking ? <Button disabled={!question.trim()} onPress={() => { ask(question.trim()); setQuestion(""); setAsking(false); }} style={{ flex: 2 }}>SEND QUESTION</Button> : <Button disabled={!work.trim()} onPress={submit} style={{ flex: 2 }}>SUBMIT WORK</Button>}</View></View>;
}
function ResultView({ part, items, next, busy, progress }: { part: LhViewPart; items: { id: string; name: string; dueAt: string }[]; next(): void; busy: boolean; progress: { reviewed: number; total: number } | null }) {
	const input = (part.input ?? {}) as { outcome?: string; verdict?: string; rung?: string | null };
	const { label, missed } = outcomeLabel(input);
	const { headline, rest } = splitVerdict(input.verdict ?? "");
	const [solution, setSolution] = useState(false);
	return <View style={{ flex: 1 }}>
		<ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 45 }}>
			<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Pressable onPress={() => router.back()}><Text style={{ color: C.text, fontSize: 30 }}>‹</Text></Pressable>{progress && <Label>{progress.reviewed} OF {progress.total}</Label>}</View>
			{progress && <View style={{ flexDirection: "row", gap: 4, marginTop: 10 }}>{Array.from({ length: progress.total }, (_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: i < progress.reviewed - 1 ? C.text : i === progress.reviewed - 1 ? C.lamp : C.pressed }} />)}</View>}
			<View style={{ marginTop: 42, gap: 14 }}><Label color={missed ? C.miss : C.sure}>{missed ? "✗" : "✓"} {label}</Label><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 34 }}>{headline}</Text><Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 17, lineHeight: 26 }}>{rest}</Text></View>
			<View style={{ marginTop: 35 }}>{items.map((item) => <View key={item.id} style={{ borderTopWidth: 1, borderColor: C.hairline, paddingVertical: 18, flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: C.text, fontFamily: font.prose }}>{item.name}</Text><Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 11 }}>{daysUntil(item.dueAt)}</Text></View>)}</View>
			<Pressable onPress={() => setSolution(!solution)} style={{ borderTopWidth: 1, borderColor: C.hairline, paddingTop: 24, marginTop: 22 }}><Label>MODEL SOLUTION  {solution ? "⌃" : "⌄"}</Label></Pressable>{solution && <View style={{ marginTop: 20 }}><Markdown text={String(part.reveal ?? "")} /></View>}
		</ScrollView>
		<View style={{ padding: 16 }}><Button disabled={busy} onPress={next}>NEXT PROBLEM  →</Button></View>
	</View>;
}
export default function SessionScreen() {
	const { id, prompt } = useLocalSearchParams<{ id: string; prompt?: string }>();
	const { client, eventVersion, foregroundVersion } = usePhone();
	const session = useMemo(() => new PhoneSession(client, id), [client, id]);
	const [, update] = useState(0);
	const [draft, setDraft] = useState("");
	const [work, setWork] = useState("");
	const [checkOpen, setCheckOpen] = useState(false);
	const [planOpen, setPlanOpen] = useState(false);
	const [demoHtml, setDemoHtml] = useState<string | null>(null);
	const [items, setItems] = useState<{ id: string; name: string; dueAt: string }[]>([]);
	const [recognizing, setRecognizing] = useState(false);
	useSpeechRecognitionEvent("start", () => setRecognizing(true));
	useSpeechRecognitionEvent("end", () => setRecognizing(false));
	useSpeechRecognitionEvent("result", (event) => { const transcript = event.results[0]?.transcript; if (transcript) setDraft((old) => `${old}${old && !old.endsWith(" ") ? " " : ""}${transcript}`); });
	useEffect(() => session.subscribe(() => update((v) => v + 1)), [session]);
	useEffect(() => { let active = true; void session.load().then((record) => { if (!active) return; if (prompt) void session.send({ type: "text", text: prompt }); else if (record.turnInFlight) void session.attach(); }).catch(() => {}); return () => { active = false; session.close(); }; }, [session]);
	useEffect(() => { if (session.isAttached || session.state.busy || !session.state.record) return; void session.load().then((record) => { if (record.turnInFlight && !session.isAttached) void session.attach(); }).catch(() => {}); }, [eventVersion]);
	useEffect(() => { if (!foregroundVersion || !session.state.record) return; session.close(); void session.load().then((record) => { if (record.turnInFlight) void session.attach(); }).catch(() => {}); }, [foregroundVersion]);
	const state = session.state;
	const record = state.record;
	const messages = session.messages;
	const view = session.view;
	const candidate = danglingQuestionOf(messages) as PendingCheck | null;
	const pending = candidate && view.flatMap((m) => m.parts).find((part) => part.toolCallId === candidate.toolCallId)?.state === "input-available" ? candidate : null;
	const problem = activeProblemOf(messages);
	const allParts = view.flatMap((m) => m.parts);
	const conclusionIndex = allParts.findLastIndex((p) => p.type === "tool-conclude");
	const lastConclude = allParts[conclusionIndex];
	const nextIndex = allParts.findLastIndex((p) => p.type === "data-practice-next");
	const showResult = record?.kind === "practice" && !problem && lastConclude?.state === "output-available" && conclusionIndex > nextIndex;
	const progress = practiceProgress(messages);
	useEffect(() => { if (!showResult) return; const targets = ((lastConclude?.problemInput as { target?: string[] })?.target ?? []); if (!targets.length) return; void client.json<{ items: typeof items }>(`/api/review?ids=${targets.map(encodeURIComponent).join(",")}`).then((r) => setItems(r.items)).catch(() => {}); }, [showResult, lastConclude?.toolCallId]);
	const send = () => { const text = draft.trim(); if (!text) return; setDraft(""); if (state.busy) void session.steer(text); else void session.send({ type: "text", text }); };
	const mic = async () => { if (recognizing) { ExpoSpeechRecognitionModule.stop(); return; } const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync(); if (permission.granted) ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: false, continuous: false, requiresOnDeviceRecognition: true }); };
	if (!record) return <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}><Text style={{ color: C.muted, margin: 24 }}>Loading session…</Text></SafeAreaView>;
	if (problem && record.kind === "practice") return <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}><PracticeView input={problem.input as { statement?: string }} progress={progress} work={work} setWork={setWork} submit={() => { if (work.trim()) { void session.send({ type: "thinking", problemCallId: problem.toolCallId, text: work }); setWork(""); } }} ask={(text) => { if (state.busy) void session.steer(text); else void session.send({ type: "text", text }); }} reply={String([...view.filter((m) => m.role === "assistant").flatMap((m) => m.parts)].reverse().find((p) => p.type === "text")?.text ?? "")} /></SafeAreaView>;
	if (showResult && lastConclude) return <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}><ResultView part={lastConclude} items={items} progress={progress} busy={state.busy} next={() => void session.send({ type: "next" })} /></SafeAreaView>;
	return <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20 }}><Pressable onPress={() => router.back()}><Text style={{ color: C.text, fontSize: 30 }}>‹</Text></Pressable><View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>{!!record.tree && <Pressable onPress={() => setPlanOpen(true)} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 7 }}><Label>⌘ PLAN</Label></Pressable>}<Label>{record.kind === "practice" ? "PRACTICE" : !hasProbeDone(messages) ? "PROBING" : record.tree ? "TEACHING" : "PLANNING"}</Label></View></View>
		<ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 50, gap: 25 }}><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 32 }}>{record.title}</Text><Transcript messages={view} openDemo={setDemoHtml} />{state.busy && <Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 12 }}>thinking…</Text>}{state.error && <Text style={{ color: C.miss }}>{state.error}</Text>}</ScrollView>
		{pending && <Pressable onPress={() => setCheckOpen(true)} style={{ backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 15, marginHorizontal: 16, marginBottom: 10, flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1, gap: 4 }}><Label color={C.lamp}>CHECK</Label><Text numberOfLines={2} style={{ color: C.text, fontFamily: font.prose, fontSize: 15 }}>{String((pending.input as { question?: string })?.question ?? "")}</Text></View><Text style={{ color: C.ink, backgroundColor: C.text, padding: 10, borderRadius: 7, fontFamily: font.mono }}>ANSWER</Text></Pressable>}
		<View style={{ flexDirection: "row", backgroundColor: C.raised, borderRadius: 18, borderWidth: 1, borderColor: C.hairline, margin: 16, alignItems: "center", paddingLeft: 16 }}><TextInput value={draft} onChangeText={setDraft} multiline placeholder="Say what you’re thinking" placeholderTextColor={C.muted} style={{ flex: 1, color: C.text, fontFamily: font.prose, fontSize: 17, minHeight: 50 }} /><Pressable accessibilityLabel={recognizing ? "Stop microphone" : "Start microphone"} onPress={() => void mic()}><Text style={{ color: recognizing ? C.lamp : C.muted, fontSize: 22 }}>♩</Text></Pressable>{state.busy && !!draft.trim() && <Pressable accessibilityLabel="Send steer" onPress={send} style={{ padding: 12 }}><Text style={{ color: C.text, fontSize: 24 }}>↑</Text></Pressable>}<Pressable accessibilityLabel={state.busy ? "Stop turn" : "Send"} onPress={() => { if (state.busy) void session.stop(); else if (pending) setCheckOpen(true); else send(); }} style={{ padding: 12 }}><Text style={{ color: C.text, fontSize: 24 }}>{state.busy ? "■" : "↑"}</Text></Pressable></View>
		<CheckSheet key={pending?.toolCallId} pending={checkOpen ? pending : null} readingThinking={draft} onClose={() => setCheckOpen(false)} onSubmit={(answer) => { if (!pending) return; setCheckOpen(false); setDraft(""); void session.send({ type: "answer", toolCallId: pending.toolCallId, answer }); }} onDismiss={() => { if (!pending) return; void session.dismiss({ type: "dismiss", toolCallId: pending.toolCallId, answer: dismissedAnswer(pending.tool === "quiz" || pending.tool === "probe" ? "quiz" : pending.tool === "explain" || pending.tool === "recall" ? "explain" : "ask", String((pending.input as { question?: string }).question ?? "")) }); setCheckOpen(false); }} />
		<Modal visible={planOpen} animationType="slide" onRequestClose={() => setPlanOpen(false)}><SafeAreaView style={{ flex: 1, backgroundColor: C.ink, padding: 24 }}><Pressable onPress={() => setPlanOpen(false)}><Label>DONE</Label></Pressable><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 30, marginVertical: 24 }}>Plan</Text><ScrollView>{((record.tree as { nodes?: { id: string; title: string }[] })?.nodes ?? []).map((node, i) => <Text key={node.id} style={{ color: C.text, fontFamily: font.prose, fontSize: 17, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.hairline }}>{i + 1}. {node.title}</Text>)}</ScrollView></SafeAreaView></Modal>
		<Modal visible={demoHtml !== null} animationType="slide" onRequestClose={() => setDemoHtml(null)}><SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}><Pressable onPress={() => setDemoHtml(null)} style={{ padding: 20 }}><Label>DONE</Label></Pressable>{demoHtml && <WebView source={{ html: sandboxDemo(demoHtml), baseUrl: "about:blank" }} originWhitelist={["about:blank"]} onShouldStartLoadWithRequest={(request) => request.url === "about:blank"} setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" />}</SafeAreaView></Modal>
	</SafeAreaView>;
}
