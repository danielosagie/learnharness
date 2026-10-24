import * as SecureStore from "expo-secure-store";
import type { CredentialStore, Credentials } from "../net/client";
const KEY = "learnharness-phone-credentials";
export const credentialStore: CredentialStore = {
	async get() { const raw = await SecureStore.getItemAsync(KEY); return raw ? JSON.parse(raw) as Credentials : null; },
	async set(value) { if (value) await SecureStore.setItemAsync(KEY, JSON.stringify(value)); else await SecureStore.deleteItemAsync(KEY); },
};
