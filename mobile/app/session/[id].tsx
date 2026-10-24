import { Screen, useBottomSpace } from "../../src/platform/screen";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "../../src/platform/speech";
import { WebView } from "../../src/platform/demo";
import { SvgXml } from "react-native-svg";
import { danglingQuestionOf, activeProblemOf, hasProbeDone, type LhMessage } from "../../../src/core/native-messages.ts";
import { type LhViewMessage, type LhViewPart } from "../../../src/core/view.ts";
import { dismissedAnswer } from "../../../src/core/question-core.ts";
import { PhoneSession } from "../../src/net/session";
import { usePhone } from "../../src/net/runtime";
import { Markdown } from "../../src/render/markdown";
import { CheckSheet, type PendingCheck } from "../../src/ui/check";
import { Button, Icon, Label } from "../../src/ui/atoms";
import { PracticeView, ResultView } from "../../src/ui/practice-views";
import { practiceProgress } from "../../src/ui/practice";
import { C, font } from "../../src/ui/theme";

function toolPart(part: LhViewPart, openDemo: (html: string) => void) {
	const name = part.type.slice(5);
	if (["probe_done", "plan_init"].includes(name)) return null;
	const input = (part.input ?? {}) as Record<string, unknown>;
	const output = (part.output ?? {}) as Record<string, unknown>;
	if (["quiz", "probe", "ask_user_question", "explain", "recall"].includes(name)) {
		if (part.state !== "output-available") return null;
		const answer = output as { questionText?: string; answers?: { label: string }[]; text?: string; other?: string; correct?: boolean; explanation?: string; dismissed?: boolean };
		return <View style={{ backgroundColor: C.raised, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.hairline, gap: 5 }}><Label color={C.lamp}>CHECK</Label><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 15 }}>{answer.questionText ?? String(input.question ?? "")}</Text><Text style={{ color: answer.correct === false ? C.miss : C.text, fontFamily: font.prose }}>Your answer: {answer.dismissed ? "skipped" : answer.answers?.map((a) => a.label).join(", ") || answer.text || answer.other || "—"} {answer.correct === true ? "✓" : answer.correct === false ? "✗" : ""}</Text>{answer.explanation ? <Text style={{ color: C.muted, fontFamily: font.prose }}>{answer.explanation}</Text> : null}</View>;
	}
	if (name === "problem") return <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16 }}><Label>PROBLEM</Label><Markdown text={String(input.statement ?? "")} /></View>;
	if (name === "conclude") return <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 16, gap: 7 }}><Label>CONCLUDED</Label><Text style={{ color: C.text, fontFamily: font.prose }}>{String(input.verdict ?? "")}</Text></View>;
	if (name === "demo") return <DemoCard title={String(output.title ?? input.brief ?? "Open demo")} html={String(output.html ?? output.srcDoc ?? "")} openDemo={openDemo} />;
	if (name === "visual" && typeof output.svg === "string") return <SvgXml xml={sanitizeSvg(output.svg)} width="100%" />;
	if (name === "research") return <View style={{ gap: 5 }}><Label>RESEARCH</Label><Text style={{ color: C.text, fontFamily: font.prose }}>{String(output.brief ?? input.brief ?? "Research completed")}</Text>{Array.isArray(output.sources) && output.sources.map((source: unknown, i: number) => { const url = typeof source === "string" ? source : String((source as { url?: string }).url ?? ""); return <Text key={i} onPress={() => void Linking.openURL(url)} style={{ color: C.muted, fontFamily: font.prose, textDecorationLine: "underline" }}>{url}</Text>; })}</View>;
	return <Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 11 }}>{name.replaceAll("_", " ")}</Text>;
}
function sanitizeSvg(svg: string): string { return svg.replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<script[^>]*\/?>/gi, "").replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(?:href|xlink:href)\s*=\s*(?:"\s*(?:javascript|data:text\/html)[^"]*"|'\s*(?:javascript|data:text\/html)[^']*'|(?:javascript|data:text\/html)[^\s>]*)/gi, ""); }
function sandboxDemo(html: string): string {
	const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'">`;
	return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => head + policy) : policy + html;
}
function DemoCard({ title, html, openDemo }: { title: string; html: string; openDemo(html: string): void }) {
	return <Pressable onPress={() => openDemo(html)} style={{ backgroundColor: C.raised, borderWidth: 1, borderColor: C.hairline, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 14 }}><View style={{ width: 56, height: 56, backgroundColor: C.ink, borderRadius: 8, alignItems: "center", justifyContent: "center" }}><SvgXml width={40} height={32} xml={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 32"><path d="M2 28C10 26 14 18 20 14s12-8 18-12" fill="none" stroke="#8D8D8D" stroke-width="1.5"/><path d="m8 24 24-16" fill="none" stroke="#EAB308" stroke-width="1.5" stroke-dasharray="2 3"/><circle cx="20" cy="14" r="2.5" fill="#E6E6E6"/></svg>'} /></View><View style={{ flex: 1, gap: 4 }}><Label>DEMO</Label><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 16, lineHeight: 20 }}>{title}</Text></View><Icon name="chevron" size={16} /></Pressable>;
}
function Transcript({ messages, openDemo }: { messages: LhViewMessage[]; openDemo(html: string): void }) {
	const children = messages.flatMap((message) => message.parts.map((part, i) => {
		const key = `${message.id}-${i}`;
		if (part.type === "reasoning" || part.type === "step-start") return null;
		if (part.type === "text") return part.text?.trim() ? <Markdown key={key} text={part.text} /> : null;
		if (part.type.startsWith("tool-")) { const content = toolPart(part, openDemo); return content ? <View key={key}>{content}</View> : null; }
		if (part.type === "data-practice-thinking") return <View key={key} style={{ borderLeftWidth: 2, borderColor: C.line, paddingLeft: 15 }}><Label>YOUR WORK</Label><Markdown text={String((part.data as { text?: string })?.text ?? "")} /></View>;
		if (part.type === "data-subagent-artifact") {
			const data = part.data as { kind?: string; result?: { title?: string; svg?: string; html?: string; srcDoc?: string; brief?: string; sources?: Array<string | { title: string; url: string }> } };
			if (data.kind === "visual" && data.result?.svg) return <SvgXml key={key} xml={sanitizeSvg(data.result.svg)} width="100%" />;
			if (data.kind === "demo" && (data.result?.html || data.result?.srcDoc)) return <DemoCard key={key} title={data.result.title ?? "Open demo"} html={data.result.html ?? data.result.srcDoc ?? ""} openDemo={openDemo} />;
			if (data.kind === "research") return <View key={key} style={{ gap: 8 }}><Label>RESEARCH</Label><Text style={{ color: C.text, fontFamily: font.prose }}>{data.result?.brief}</Text>{data.result?.sources?.map((source, n) => { const url = typeof source === "string" ? source : source.url; return <Text key={n} onPress={() => void Linking.openURL(url)} style={{ color: C.muted, fontFamily: font.prose, textDecorationLine: "underline" }}>{typeof source === "string" ? source : source.title}</Text>; })}</View>;
		}
		return null;
	})).filter(Boolean);
	return <View style={{ gap: 18 }}>{children}</View>;
}
export default function SessionScreen() {
	const bottom = useBottomSpace();
	const { id, prompt } = useLocalSearchParams<{ id: string; prompt?: string }>();
	const { client, eventVersion, foreground } = usePhone();
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
	useFocusEffect(useCallback(() => { if (foreground) void session.open(prompt); else session.close(); return () => session.close(); }, [session, foreground]));
	useEffect(() => { void session.resync(); }, [session, eventVersion]);
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
	if (!record) return <Screen style={{ flex: 1, backgroundColor: C.ink }}><Text style={{ color: C.muted, fontFamily: font.prose, margin: 24 }}>{state.error ?? "Loading session…"}</Text><Button secondary onPress={() => void session.resync()}>RETRY</Button></Screen>;
	if (problem && record.kind === "practice") return <Screen style={{ flex: 1, backgroundColor: C.ink }}><PracticeView input={problem.input as { statement?: string }} progress={progress} work={work} setWork={setWork} submit={() => { if (work.trim()) { void session.send({ type: "thinking", problemCallId: problem.toolCallId, text: work }); setWork(""); } }} ask={(text) => { if (state.busy) void session.steer(text); else void session.send({ type: "text", text }); }} busy={state.busy} error={state.error} stop={() => void session.stop()} dismiss={() => void session.dismiss({ type: "dismiss-problem", problemCallId: problem.toolCallId })} reply={String([...view.filter((m) => m.role === "assistant").flatMap((m) => m.parts)].reverse().find((p) => p.type === "text")?.text ?? "")} /></Screen>;
	if (showResult && lastConclude) return <Screen style={{ flex: 1, backgroundColor: C.ink }}><ResultView part={lastConclude} items={items} error={state.error} progress={progress} busy={state.busy} next={() => void session.send({ type: "next" })} /></Screen>;
	return <Screen style={{ flex: 1, backgroundColor: C.ink }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 44, paddingLeft: 12, paddingRight: 16 }}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ width: 44, height: 44, marginLeft: -8, alignItems: "center", justifyContent: "center" }}><Icon name="back" color={C.text} size={28} /></Pressable><View style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 44 }}>{!!record.tree && <Pressable hitSlop={{ top: 9, bottom: 9 }} onPress={() => setPlanOpen(true)} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name="plan" size={12} /><Label>PLAN</Label></Pressable>}<Label>{record.kind === "practice" ? "PRACTICE" : !hasProbeDone(messages) ? "PROBING" : record.tree ? "TEACHING" : "PLANNING"}</Label></View></View>
		<ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 18 }}><Text numberOfLines={2} style={{ color: C.text, fontFamily: font.serif, fontSize: 30, lineHeight: 36, letterSpacing: -0.3 }}>{record.title}</Text><Transcript messages={view} openDemo={setDemoHtml} />{state.busy && <Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 12 }}>thinking…</Text>}{state.error && <Text style={{ color: C.miss, fontFamily: font.prose }}>{state.error}</Text>}</ScrollView>
		<View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottom, gap: 10 }}>
		{pending && <Pressable onPress={() => setCheckOpen(true)} style={{ backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 12, gap: 12, flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1, gap: 3 }}><Label color={C.lamp}>CHECK</Label><Text numberOfLines={2} style={{ color: C.text, fontFamily: font.prose, fontSize: 15, lineHeight: 20 }}>{String((pending.input as { question?: string })?.question ?? "")}</Text></View><View style={{ backgroundColor: C.text, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 6 }}><Text style={{ color: C.ink, fontFamily: font.mono, fontSize: 12, lineHeight: 16, letterSpacing: 0.72 }}>ANSWER</Text></View></Pressable>}
		<View style={{ flexDirection: "row", backgroundColor: C.raised, borderRadius: 20, borderWidth: 1, borderColor: C.hairline, alignItems: "center", paddingLeft: 18, paddingRight: 6, minHeight: 48 }}><TextInput value={draft} onChangeText={setDraft} multiline placeholder="Say what you’re thinking" placeholderTextColor={C.muted} style={{ flex: 1, color: C.text, fontFamily: font.prose, fontSize: 17, lineHeight: 22, height: 48, paddingVertical: 12 }} /><Pressable hitSlop={6} accessibilityLabel={recognizing ? "Stop microphone" : "Start microphone"} onPress={() => void mic()} style={{ width: 32, height: 44, justifyContent: "center", alignItems: "center" }}><Icon name="mic" color={recognizing ? C.lamp : C.muted} /></Pressable>{state.busy && !!draft.trim() && <Pressable accessibilityLabel="Send steer" onPress={send} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Icon name="up" color={C.text} size={16} /></Pressable>}<Pressable hitSlop={4} accessibilityLabel={state.busy ? "Stop turn" : "Send"} onPress={() => { if (state.busy) void session.stop(); else if (pending) setCheckOpen(true); else send(); }} style={{ backgroundColor: C.pressed, borderRadius: 18, width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>{state.busy ? <Text style={{ color: C.text }}>■</Text> : <Icon name="up" size={15} />}</Pressable></View></View>
		<CheckSheet disabled={state.busy || record.compacting} key={pending?.toolCallId} pending={checkOpen ? pending : null} readingThinking={draft} onClose={() => setCheckOpen(false)} onSubmit={(answer) => { if (!pending) return; setCheckOpen(false); setDraft(""); void session.send({ type: "answer", toolCallId: pending.toolCallId, answer }); }} onDismiss={() => { if (!pending) return; void session.dismiss({ type: "dismiss", toolCallId: pending.toolCallId, answer: dismissedAnswer(pending.tool === "quiz" || pending.tool === "probe" ? "quiz" : pending.tool === "explain" || pending.tool === "recall" ? "explain" : "ask", String((pending.input as { question?: string }).question ?? "")) }); setCheckOpen(false); }} />
		<Modal visible={planOpen} animationType="slide" onRequestClose={() => setPlanOpen(false)}><Screen style={{ flex: 1, backgroundColor: C.ink, padding: 24 }}><Pressable style={{ minHeight: 44, justifyContent: "center" }} onPress={() => setPlanOpen(false)}><Label>DONE</Label></Pressable><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 30, marginVertical: 24 }}>Plan</Text><ScrollView>{((record.tree as { nodes?: { id: string; title: string }[] })?.nodes ?? []).map((node, i) => <Text key={node.id} style={{ color: C.text, fontFamily: font.prose, fontSize: 17, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.hairline }}>{i + 1}. {node.title}</Text>)}</ScrollView></Screen></Modal>
		<Modal visible={demoHtml !== null} animationType="slide" onRequestClose={() => setDemoHtml(null)}><Screen style={{ flex: 1, backgroundColor: C.ink }}><Pressable onPress={() => setDemoHtml(null)} style={{ padding: 20 }}><Label>DONE</Label></Pressable>{demoHtml && <WebView source={{ html: sandboxDemo(demoHtml), baseUrl: "about:blank" }} originWhitelist={["about:blank"]} onShouldStartLoadWithRequest={(request) => request.url === "about:blank"} setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" />}</Screen></Modal>
	</Screen>;
}
