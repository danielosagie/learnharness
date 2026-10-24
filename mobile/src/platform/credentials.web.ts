import type { CredentialStore, Credentials } from "../net/client";
// Browser preview credentials never enter the native SecureStore implementation.
const KEY = "learnharness-phone-preview";
export const credentialStore: CredentialStore = {
	async get() { const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY); return raw ? JSON.parse(raw) as Credentials : null; },
	async set(value) { if (value) localStorage.setItem(KEY, JSON.stringify(value)); else localStorage.removeItem(KEY); },
};
