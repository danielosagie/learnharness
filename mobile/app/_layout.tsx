import React from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { PhoneProvider } from "../src/net/runtime";
import { C } from "../src/ui/theme";
export default function Layout() {
	const [loaded] = useFonts({ CMUSerif: require("../assets/cmunbx.ttf"), SourceSans3: require("../assets/source-sans-3-regular.ttf"), SourceSans3Bold: require("../assets/source-sans-3-bold.ttf"), JetBrainsMono: require("../assets/jetbrains-mono-regular.ttf") });
	if (!loaded) return null;
	return <PhoneProvider><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ink } }} /></PhoneProvider>;
}
