import { Screen, useBottomSpace } from "../src/platform/screen";
import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "../src/platform/camera";
import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { usePhone } from "../src/net/runtime";
import { hostUrl, normalizePhoneCode, parsePairingLink } from "../src/net/client";
import { Button, Label, Mark } from "../src/ui/atoms";
import { C, font } from "../src/ui/theme";
export default function Pair() {
	const bottom = useBottomSpace(44);
	const params = useLocalSearchParams<{ url?: string; code?: string }>();
	const { client, refresh, removed, startDemo } = usePhone();
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
	return <Screen style={{ flex: 1, backgroundColor: "#0B0B0B" }}>
		<View style={{ paddingHorizontal: 24, paddingTop: 40 }}>
		<Mark />
		<Text numberOfLines={2} style={{ color: C.text, fontFamily: font.serif, fontSize: 34, lineHeight: 40, letterSpacing: -0.34, marginTop: 24 }}>Pair with your computer</Text>
		<Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 17, lineHeight: 26, marginTop: 12 }}>In LearnHarness on your computer, open Settings → Phone and scan the code.</Text>
		{removed && <Text style={{ color: C.miss, fontFamily: font.prose, marginTop: 16 }}>This phone was removed from {removed}. Pair again.</Text>}
		</View>
		{manual ? <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 14 }}>
			<Label>Computer address</Label><TextInput value={host} onChangeText={setHost} placeholder="computer.ts.net or IP" placeholderTextColor={C.muted} autoCapitalize="none" style={{ backgroundColor: C.raised, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 16, fontFamily: font.mono }} />
			<Label>8-character code</Label><TextInput value={code} onChangeText={(value) => setCode(normalizePhoneCode(value))} placeholder="CODE1234" placeholderTextColor={C.muted} autoCapitalize="characters" maxLength={8} style={{ backgroundColor: C.raised, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 16, fontFamily: font.mono }} />
			<Button disabled={busy || code.length !== 8} onPress={() => { try { void pair(hostUrl(host), code); } catch (e) { setError((e as Error).message); } }}>PAIR PHONE</Button>
		</View> : <Pressable onPress={() => { if (!permission?.granted) void requestPermission(); }} style={{ alignItems: "center", marginTop: 40 }}>
			<View style={{ width: 300, height: 300, borderRadius: 28, overflow: "hidden", backgroundColor: C.raised }}>
				{permission?.granted ? <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => fromLink(data)} /> : <Text style={{ color: C.muted, textAlign: "center", marginTop: 120, fontFamily: font.prose }}>Tap to allow camera</Text>}
			<View pointerEvents="none" style={{ position: "absolute", top: 50, left: 50, right: 50, bottom: 50 }}>
					{[0, 1, 2, 3].map((corner) => <View key={corner} style={{ position: "absolute", width: 40, height: 40, borderColor: C.lamp, borderTopWidth: corner < 2 ? 3 : 0, borderBottomWidth: corner > 1 ? 3 : 0, borderLeftWidth: corner % 2 === 0 ? 3 : 0, borderRightWidth: corner % 2 ? 3 : 0, top: corner < 2 ? 0 : undefined, bottom: corner > 1 ? 0 : undefined, left: corner % 2 === 0 ? 0 : undefined, right: corner % 2 ? 0 : undefined, borderTopLeftRadius: corner === 0 ? 14 : 0, borderTopRightRadius: corner === 1 ? 14 : 0, borderBottomLeftRadius: corner === 2 ? 14 : 0, borderBottomRightRadius: corner === 3 ? 14 : 0 }} />)}
					<View style={{ top: 86, height: 2, backgroundColor: "#EAB3088C" }} />
				</View></View>
		</Pressable>}
		{!manual && <View style={{ flex: 1 }} />}<View style={{ paddingHorizontal: 24, paddingBottom: bottom, gap: 18 }}>
		{error ? <Text style={{ color: C.miss, fontFamily: font.prose, marginBottom: 12 }}>{error}</Text> : null}
		<Button secondary onPress={() => setManual(!manual)}>{manual ? "SCAN CODE INSTEAD" : "ENTER CODE INSTEAD"}</Button>
		<Pressable accessibilityRole="link" hitSlop={10} style={{ height: 24, paddingTop: 4, alignItems: "center", justifyContent: "center" }} onPress={() => { startDemo(); router.replace("/"); }}><Text style={{ color: C.muted, fontFamily: font.prose, fontSize: 16, lineHeight: 20, textDecorationLine: "underline" }}>Try a sample lesson</Text></Pressable></View>
	</Screen>;
}
