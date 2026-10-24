import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { usePhone } from "../src/net/runtime";
import { ApiError } from "../src/net/client";
import { Button, Label, Mark } from "../src/ui/atoms";
import { C, font } from "../src/ui/theme";
import { daysUntil, relativeTime } from "../src/ui/format";

type Due = { id: string; name: string; statement: string; lane: "new" | "review" };
type Review = { due: Due[]; nextDueAt: string | null };
type Chat = { id: string; title: string; updatedAt: string; kind?: string; phase?: string; pendingQuestion?: unknown; pendingProblem?: unknown; busy?: boolean };
export default function Home() {
	const { client, credentials, ready, connected, eventVersion, foregroundVersion, refresh: refreshPhone } = usePhone();
	const [review, setReview] = useState<Review | null>(null);
	const [chats, setChats] = useState<Chat[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [draft, setDraft] = useState("");
	const [mode, setMode] = useState<"teach" | "practice">("teach");
	const [settings, setSettings] = useState(false);
	const refresh = useCallback(async () => {
		if (!credentials) return;
		setLoading(true);
		try { const [r, c] = await Promise.all([client.json<Review>("/api/review"), client.json<{ chats: Chat[] }>("/api/chats")]); setReview(r); setChats(c.chats); setError(""); }
		catch (e) { setError(e instanceof Error ? e.message : "Could not refresh"); }
		finally { setLoading(false); }
	}, [client, credentials]);
	useEffect(() => { if (ready && !credentials) router.replace("/pair"); }, [ready, credentials]);
	useEffect(() => { void refresh(); }, [refresh, eventVersion, foregroundVersion]);
	const create = async (title: string, kind?: "practice", picks?: Due[]) => {
		try {
			const models = await client.json<{ slots?: { strong?: { model?: { provider?: string } } | string | null; cheap?: unknown; vision?: unknown }; providers?: { id: string; keyPresent: boolean }[] }>("/api/models");
			if (!models.slots?.strong || !models.slots?.cheap || !models.slots?.vision) { setError("Set up models on your computer."); return; }
			const provider = typeof models.slots.strong === "object" ? models.slots.strong.model?.provider : undefined;
			if (provider && models.providers && !models.providers.some((item) => item.id === provider && item.keyPresent)) { setError("Set up AI on your computer."); return; }
			const chat = await client.json<{ id: string }>("/api/chats", { method: "POST", body: JSON.stringify({ title, ...(kind ? { kind } : {}), ...(picks?.length ? { graphContext: { propositions: picks.map(({ id, name, statement }) => ({ id, name, statement })) } } : {}) }) });
			setDraft("");
			router.push({ pathname: "/session/[id]", params: { id: chat.id, prompt: title } });
		} catch (e) { setError(e instanceof ApiError && e.status === 503 ? "Set up models on your computer." : e instanceof Error ? e.message : "Could not start session"); }
	};
	const due = review?.due ?? [];
	const dueCount = due.length;
	const newCount = due.filter((p) => p.lane === "new").length;
	return <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
		<ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={C.text} />} contentContainerStyle={{ padding: 24, paddingBottom: 25 }}>
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22 }}><Mark /><Pressable onPress={() => setSettings(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? C.sure : C.muted }} /><Label>{credentials?.name ?? "COMPUTER"}</Label></Pressable></View>
			{!connected && credentials && <Text style={{ color: C.muted, fontFamily: font.prose, marginTop: 22 }}>Can’t reach {credentials.name}. Is LearnHarness open and Tailscale on?</Text>}
			<View style={{ marginTop: 75 }}><Label>DUE FOR REVIEW</Label>{dueCount ? <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 12 }}><Text style={{ color: C.lamp, fontFamily: font.serif, fontSize: 112, lineHeight: 118 }}>{dueCount}</Text><View style={{ paddingBottom: 12 }}><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 17 }}>ideas fading</Text><Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 14 }}>weakest first · {newCount} new</Text></View></View> : <View style={{ marginTop: 20 }}><Text style={{ color: C.muted, fontFamily: font.serif, fontSize: 36 }}>Nothing due</Text>{review?.nextDueAt && <Text style={{ color: C.muted, fontFamily: font.mono }}>{daysUntil(review.nextDueAt).replace("back", "next")}</Text>}</View>}</View>
			{dueCount > 0 && <View style={{ marginTop: 22 }}><Button onPress={() => void create("Practice what's due", "practice", due.slice(0, 64))}>PRACTICE WHAT’S DUE     →</Button>{dueCount > 64 && <Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 11, marginTop: 8 }}>64 of {dueCount} due included</Text>}</View>}
			<View style={{ marginTop: 50 }}><Label>SESSIONS</Label>{chats.map((chat) => { const yourTurn = !!(chat.pendingQuestion || chat.pendingProblem); const phase = chat.kind === "practice" ? "practice" : chat.phase === "probe" ? "probing" : chat.phase === "plan" ? "planning" : "teaching"; return <Pressable key={chat.id} onPress={() => router.push({ pathname: "/session/[id]", params: { id: chat.id } })} style={{ paddingVertical: 20, borderTopWidth: 1, borderColor: C.hairline }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 17 }}>{chat.title}</Text>{yourTurn && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.lamp }} />}</View><Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 12, marginTop: 5 }}>{phase} · {yourTurn ? "your turn" : chat.busy ? "working…" : "done"} · {relativeTime(chat.updatedAt)}</Text></Pressable>; })}</View>
			{error ? <Text style={{ color: C.miss, marginTop: 10 }}>{error}</Text> : null}
		</ScrollView>
		<View style={{ padding: 16, borderTopWidth: 1, borderColor: C.hairline }}><View style={{ flexDirection: "row", backgroundColor: C.raised, borderRadius: 19, borderWidth: 1, borderColor: C.line, alignItems: "center", paddingLeft: 16 }}><TextInput value={draft} onChangeText={setDraft} placeholder="What do you want to learn?" placeholderTextColor={C.muted} multiline style={{ flex: 1, color: C.text, fontFamily: font.prose, fontSize: 17, minHeight: 55 }} /><Pressable onPress={() => { if (draft.trim()) void create(draft.trim(), mode === "practice" ? "practice" : undefined); }} style={{ backgroundColor: C.pressed, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center", margin: 6 }}><Text style={{ color: C.text, fontSize: 25 }}>↑</Text></Pressable></View><View style={{ flexDirection: "row", gap: 20, marginTop: 10 }}>{(["teach", "practice"] as const).map((m) => <Pressable key={m} onPress={() => setMode(m)}><Label color={mode === m ? C.text : C.muted}>{m}</Label></Pressable>)}</View></View>
		<Modal visible={settings} transparent animationType="slide" onRequestClose={() => setSettings(false)}><Pressable onPress={() => setSettings(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}><View style={{ backgroundColor: C.raised, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 25, gap: 14 }}><Label>CONNECTED COMPUTER</Label><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 24 }}>{credentials?.name}</Text><Text style={{ color: C.muted, fontFamily: font.mono }}>{credentials?.url}</Text><Button secondary onPress={() => { void client.unpair().then(() => refreshPhone()); setSettings(false); router.replace("/pair"); }}>UNPAIR THIS PHONE</Button></View></Pressable></Modal>
	</SafeAreaView>;
}
