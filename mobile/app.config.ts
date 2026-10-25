import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
	name: "LearnHarness",
	slug: "learnharness",
	scheme: "learnharness",
	owner: "anorha",
	version: "1.0.0",
	orientation: "portrait",
	userInterfaceStyle: "dark",
	icon: "./assets/icon.png",
	backgroundColor: "#141414",
	ios: {
		bundleIdentifier: "com.danielosagie.learnharness",
		supportsTablet: false,
		infoPlist: {
			NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
			NSLocalNetworkUsageDescription: "Connect to LearnHarness on your computer.",
			NSCameraUsageDescription: "Scan the pairing code on your computer.",
			NSMicrophoneUsageDescription: "Speak a message to your tutor.",
			NSSpeechRecognitionUsageDescription: "Turn your speech into text on this phone.",
			ITSAppUsesNonExemptEncryption: false,
		},
	},
	extra: { eas: { projectId: "cbf01ed3-ee72-4a43-8800-0397b3c0bb40" } },
	plugins: ["expo-router", "expo-secure-store", "expo-camera", "expo-speech-recognition", ["expo-splash-screen", { backgroundColor: "#141414" }]],
};
export default config;
