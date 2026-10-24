import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { usePhone } from "../src/net/runtime";
import { hostUrl, parsePairingLink } from "../src/net/client";
import { Button, Label, Mark } from "../src/ui/atoms";
import { C, font } from "../src/ui/theme";
export default function Pair() {
	const params = useLocalSearchParams<{ url?: string; code?: string }>();
	const { client, refresh, removed } = usePhone();
	const [permission, requestPermission] = useCameraPermissions();
	const [manual, setManual] = useState(false);
	const [host, setHost] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const pairingRef = useRef(false);
	const pair = async (url: string, value: string) => {
		if (pairingRef.current) return;
		pairingRef.current = true;
		setBusy(true); setError("");
		try { await client.pair(url, value, Device.deviceName ?? "iPhone"); await refresh(); router.replace("/"); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "Pairing failed"); }
		finally { setBusy(false); pairingRef.current = false; }
	};
	const fromLink = (link: string) => { try { const data = parsePairingLink(link); void pair(data.url, data.code); } catch { setError("This pairing code is invalid."); } };
	useEffect(() => { void Linking.getInitialURL().then((url) => { if (url?.startsWith("learnharness://pair?")) fromLink(url); }); const sub = Linking.addEventListener("url", (e) => { if (e.url.startsWith("learnharness://pair?")) fromLink(e.url); }); return () => sub.remove(); }, []);
	useEffect(() => { if (params.url && params.code) fromLink(`learnharness://pair?url=${encodeURIComponent(params.url)}&code=${encodeURIComponent(params.code)}`); }, [params.url, params.code]);
	return <SafeAreaView style={{ flex: 1, backgroundColor: "#0B0B0B", paddingHorizontal: 24, paddingTop: 45, paddingBottom: 34 }}>
		<Mark />
		<Text style={{ color: C.text, fontFamily: font.serif, fontSize: 35, marginTop: 45 }}>Pair with your computer</Text>
		<Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 17, lineHeight: 26, marginTop: 20 }}>In LearnHarness on your computer, open Settings → Phone and scan the code.</Text>
		{removed && <Text style={{ color: C.miss, marginTop: 16 }}>This phone was removed from {removed}. Pair again.</Text>}
		{manual ? <View style={{ flex: 1, justifyContent: "center", gap: 14 }}>
			<Label>Computer address</Label><TextInput value={host} onChangeText={setHost} placeholder="100.x.y.z or computer.tailnet" placeholderTextColor={C.muted} autoCapitalize="none" style={{ backgroundColor: C.raised, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 16, fontFamily: font.mono }} />
			<Label>8-character code</Label><TextInput value={code} onChangeText={setCode} placeholder="CODE1234" placeholderTextColor={C.muted} autoCapitalize="characters" maxLength={8} style={{ backgroundColor: C.raised, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 16, fontFamily: font.mono }} />
			<Button disabled={busy || code.length !== 8} onPress={() => { try { void pair(hostUrl(host), code); } catch (e) { setError((e as Error).message); } }}>PAIR PHONE</Button>
		</View> : <Pressable onPress={() => { if (!permission?.granted) void requestPermission(); }} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
			<View style={{ width: "84%", aspectRatio: 1, maxHeight: 300, borderRadius: 30, overflow: "hidden", backgroundColor: C.raised, borderWidth: 3, borderColor: C.lamp }}>
				{permission?.granted ? <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => fromLink(data)} /> : <Text style={{ color: C.muted, textAlign: "center", marginTop: 120 }}>Tap to allow camera</Text>}
			</View>
		</Pressable>}
		{error ? <Text style={{ color: C.miss, marginBottom: 12 }}>{error}</Text> : null}
		<Text style={{ color: C.muted, fontFamily: font.mono, fontSize: 12, textAlign: "center", marginBottom: 20 }}>Your phone and computer must both be on Tailscale.</Text>
		<Button secondary onPress={() => setManual(!manual)}>{manual ? "SCAN CODE INSTEAD" : "ENTER CODE INSTEAD"}</Button>
	</SafeAreaView>;
}
