import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import * as ExpoCrypto from "expo-crypto";
import { router } from "expo-router";
import { PhoneClient, type Credentials } from "./client";

const KEY = "learnharness-phone-credentials";
if (!globalThis.crypto?.randomUUID) (globalThis as { crypto?: { randomUUID: () => string } }).crypto = { randomUUID: ExpoCrypto.randomUUID };
const store = {
	async get(): Promise<Credentials | null> { const raw = await SecureStore.getItemAsync(KEY); return raw ? JSON.parse(raw) : null; },
	async set(value: Credentials | null): Promise<void> { if (value) await SecureStore.setItemAsync(KEY, JSON.stringify(value)); else await SecureStore.deleteItemAsync(KEY); },
};
export interface PhoneContextValue {
	client: PhoneClient;
	credentials: Credentials | null;
	ready: boolean;
	connected: boolean;
	removed: string | null;
	eventVersion: number;
	foregroundVersion: number;
	refresh(): Promise<void>;
}
const Context = createContext<PhoneContextValue | null>(null);
export function usePhone(): PhoneContextValue { const value = useContext(Context); if (!value) throw new Error("Phone provider missing"); return value; }
export function PhoneProvider({ children }: { children: React.ReactNode }) {
	const [credentials, setCredentials] = useState<Credentials | null>(null);
	const [ready, setReady] = useState(false);
	const [connected, setConnected] = useState(false);
	const [removed, setRemoved] = useState<string | null>(null);
	const [eventVersion, setEventVersion] = useState(0);
	const [foregroundVersion, setForegroundVersion] = useState(0);
	const [foreground, setForeground] = useState(true);
	const client = useMemo(() => new PhoneClient(store, expoFetch as typeof fetch, (name) => { setRemoved(name); setCredentials(null); setConnected(false); router.replace("/pair"); }), []);
	const refresh = useCallback(async () => { const creds = await client.restore(); setCredentials(creds); setReady(true); if (creds) { setRemoved(null); try { await client.hello(); setConnected(true); } catch { setConnected(false); } } else setConnected(false); }, [client]);
	useEffect(() => { void refresh(); }, [refresh]);
	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => { setForeground(state === "active"); if (state === "active") { setForegroundVersion((v) => v + 1); void refresh(); } });
		return () => sub.remove();
	}, [refresh]);
	useEffect(() => {
		if (!credentials || !foreground) return;
		let active = true;
		const abort = new AbortController();
		void (async () => {
			let delay = 1000;
			while (active) {
				try {
					await client.hello();
					setConnected(true);
					setEventVersion((v) => v + 1);
					for await (const frame of client.stream("/api/events", abort.signal)) {
						if (!active) break;
						setConnected(true);
						delay = 1000;
						if (frame.event !== "message" || frame.data !== "ping") setEventVersion((v) => v + 1);
					}
				} catch { if (active) setConnected(false); }
				if (!active) break;
				await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, delay * (0.75 + Math.random() * 0.5))));
				delay = Math.min(30_000, delay * 2);
			}
		})();
		return () => { active = false; abort.abort(); };
	}, [client, credentials, foreground]);
	return <Context.Provider value={{ client, credentials, ready, connected, removed, eventVersion, foregroundVersion, refresh }}>{children}</Context.Provider>;
}
