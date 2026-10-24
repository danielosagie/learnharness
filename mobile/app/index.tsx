import { Screen, useBottomSpace } from "../src/platform/screen";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { usePhone } from "../src/net/runtime";
import { ApiError } from "../src/net/client";
import { Button, Icon, Label, Mark } from "../src/ui/atoms";
import { C, font } from "../src/ui/theme";
import { daysUntil, relativeTime } from "../src/ui/format";

type Due = { id: string; name: string; statement: string; lane: "new" | "review" };
type Review = { due: Due[]; nextDueAt: string | null };
type Chat = { id: string; title: string; updatedAt: string; kind?: string; phase?: string; pendingQuestion?: unknown; pendingProblem?: unknown; busy?: boolean };
export default function Home() {
	const { client, credentials, ready, connected, eventVersion, foregroundVersion, refresh: refreshPhone } = usePhone();
	const bottom = useBottomSpace();
	const [review, setReview] = useState<Review | null>(null);
	const [chats, setChats] = useState<Chat[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [draft, setDraft] = useState("");
	const [mode, setMode] = useState<"teach" | "practice">("teach");
	const [creating, setCreating] = useState(false);
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
		if (creating) return;
		setCreating(true);
		try {
			const models = await client.json<{ slots?: { strong?: { model?: { provider?: string } } | string | null; cheap?: unknown; vision?: unknown }; providers?: { id: string; keyPresent: boolean }[] }>("/api/models");
			if (!models.slots?.strong || !models.slots?.cheap || !models.slots?.vision) { setError("No models set up on your computer."); return; }
			const provider = typeof models.slots.strong === "object" ? models.slots.strong.model?.provider : undefined;
			if (provider && models.providers && !models.providers.some((item) => item.id === provider && item.keyPresent)) { setError("Set up AI on your computer."); return; }
			const chat = await client.json<{ id: string }>("/api/chats", { method: "POST", body: JSON.stringify({ title, ...(kind ? { kind } : {}), ...(picks?.length ? { graphContext: { propositions: picks.map(({ id, name, statement }) => ({ id, name, statement })) } } : {}) }) });
			setDraft("");
			router.push({ pathname: "/session/[id]", params: { id: chat.id, prompt: title } });
		} catch (e) { setError(e instanceof ApiError && e.status === 503 ? "No models set up on your computer." : e instanceof Error ? e.message : "Could not start session"); }
		finally { setCreating(false); }
	};
	const due = review?.due ?? [];
	const dueCount = due.length;
	const newCount = due.filter((p) => p.lane === "new").length;
	return <Screen style={{ flex: 1, backgroundColor: C.ink }}>
		<ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={C.text} />} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 25 }}>
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 44 }}><Mark /><Pressable onPress={() => setSettings(true)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? C.sure : C.muted }} /><Label>{credentials?.name ?? "COMPUTER"}</Label></Pressable></View>
			{!connected && credentials && <Text style={{ color: C.muted, fontFamily: font.prose, marginTop: 22 }}>Can’t reach {credentials.name}. Is LearnHarness open and Tailscale on?</Text>}
			<View style={{ marginTop: 48 }}><Label>DUE FOR REVIEW</Label>{dueCount ? <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14, marginTop: 20 }}><Text style={{ color: C.lamp, fontFamily: font.serif, fontSize: 112, lineHeight: 92, letterSpacing: -3.36 }}>{dueCount}</Text><View style={{ paddingBottom: 6 }}><Text style={{ color: C.text, fontFamily: font.prose, fontSize: 17, lineHeight: 22 }}>ideas fading</Text><Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 15, lineHeight: 20, marginTop: 4 }}>weakest first · {newCount} new</Text></View></View> : <View style={{ marginTop: 20 }}><Text style={{ color: C.muted, fontFamily: font.serif, fontSize: 36 }}>{review ? "Nothing due" : "Loading reviews…"}</Text>{review?.nextDueAt && <Text style={{ color: C.muted, fontFamily: font.mono }}>{daysUntil(review.nextDueAt).replace("back", "next")}</Text>}</View>}</View>
			{dueCount > 0 && <View style={{ marginTop: 20 }}><Button disabled={creating} style={{ height: 56, justifyContent: "space-between" }} arrow onPress={() => void create("Practice what's due", "practice", due.slice(0, 64))}>PRACTICE WHAT'S DUE</Button>{dueCount > 64 && <Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 11, marginTop: 8 }}>64 of {dueCount} due included</Text>}</View>}
			<View style={{ marginTop: 48 }}><View style={{ paddingBottom: 8 }}><Label>SESSIONS</Label></View>{!chats.length && review && <Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 17, paddingVertical: 14 }}>No sessions yet</Text>}{chats.map((chat) => { const yourTurn = !!(chat.pendingQuestion || chat.pendingProblem); const phase = chat.kind === "practice" ? "practice" : chat.phase === "probe" ? "probing" : chat.phase === "plan" ? "planning" : "teaching"; return <Pressable key={chat.id} onPress={() => router.push({ pathname: "/session/[id]", params: { id: chat.id } })} style={{ paddingVertical: 14, borderTopWidth: 1, borderColor: C.hairline, flexDirection: "row", alignItems: "center", gap: 12 }}><View style={{ flex: 1, gap: 4 }}><Text numberOfLines={2} style={{ color: C.text, fontFamily: font.prose, fontSize: 17, lineHeight: 22 }}>{chat.title}</Text><Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 12, lineHeight: 16 }}>{phase} · {yourTurn ? "your turn" : chat.busy ? "working…" : "done"} · {relativeTime(chat.updatedAt)}</Text></View><View style={{ width: 20, alignItems: "flex-end" }}>{yourTurn && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.lamp }} />}</View></Pressable>; })}</View>
			{error ? <Text style={{ color: C.miss, fontFamily: font.prose, marginTop: 10 }}>{error}</Text> : null}
		</ScrollView>
		<View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottom, borderTopWidth: 1, borderColor: C.hairline }}><View style={{ flexDirection: "row", backgroundColor: C.raised, borderRadius: 20, borderWidth: 1, borderColor: C.line, alignItems: "center", paddingLeft: 18 }}><TextInput value={draft} onChangeText={setDraft} placeholder="What do you want to learn?" placeholderTextColor={C.muted} multiline style={{ flex: 1, color: C.text, fontFamily: font.prose, fontSize: 17, height: 52, paddingVertical: 6, lineHeight: 22 }} /><Pressable disabled={creating} accessibilityLabel="Start session" hitSlop={2} onPress={() => { if (draft.trim()) void create(draft.trim(), mode === "practice" ? "practice" : undefined); }} style={{ backgroundColor: C.pressed, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center", margin: 6 }}><Icon name="up" size={16} /></Pressable></View><View style={{ height: 36 }} /><View style={{ position: "absolute", left: 20, right: 20, bottom, height: 44, flexDirection: "row", gap: 4 }}>{(["teach", "practice"] as const).map((m) => <Pressable accessibilityLabel={`${m} mode`} style={{ height: 44, justifyContent: "flex-end" }} key={m} onPress={() => setMode(m)}><View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: mode === m ? C.pressed : "transparent" }}><Label color={mode === m ? C.text : C.muted}>{m}</Label></View></Pressable>)}</View></View>
		<Modal visible={settings} transparent animationType="slide" onRequestClose={() => setSettings(false)}><Pressable onPress={() => setSettings(false)} style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }}><View style={{ backgroundColor: C.raised, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 25, gap: 14 }}><Label>CONNECTED COMPUTER</Label><Text style={{ color: C.text, fontFamily: font.serif, fontSize: 24 }}>{credentials?.name}</Text><Text style={{ color: C.muted, fontFamily: font.mono }}>{credentials?.url}</Text><Button secondary onPress={() => { void client.unpair().then(() => refreshPhone()); setSettings(false); router.replace("/pair"); }}>UNPAIR THIS PHONE</Button></View></Pressable></Modal>
	</Screen>;
}
