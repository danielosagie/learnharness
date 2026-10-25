import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { credentialStore as store } from "../platform/credentials";
import { fetch as expoFetch } from "expo/fetch";
import * as ExpoCrypto from "expo-crypto";
import { router } from "expo-router";
import { reconnectPause } from "./sse";
import { createSampleFetch, memoryCredentials, sampleCredentials } from "../sample/transport";
import { PhoneClient, type Credentials } from "./client";

if (!globalThis.crypto?.randomUUID) (globalThis as { crypto?: { randomUUID: () => string } }).crypto = { randomUUID: ExpoCrypto.randomUUID };
export interface PhoneContextValue {
	client: PhoneClient;
	demo: boolean;
	startDemo(): void;
	leaveDemo(): void;
	credentials: Credentials | null;
	ready: boolean;
	connected: boolean;
	removed: string | null;
	eventVersion: number;
	foregroundVersion: number;
	foreground: boolean;
	refresh(): Promise<void>;
}
const Context = createContext<PhoneContextValue | null>(null);
export function usePhone(): PhoneContextValue { const value = useContext(Context); if (!value) throw new Error("Phone provider missing"); return value; }
export function PhoneProvider({ children }: { children: React.ReactNode }) {
	const [demo, setDemo] = useState(false);
	const [credentials, setCredentials] = useState<Credentials | null>(null);
	const [ready, setReady] = useState(false);
	const [connected, setConnected] = useState(false);
	const [removed, setRemoved] = useState<string | null>(null);
	const [eventVersion, setEventVersion] = useState(0);
	const [foregroundVersion, setForegroundVersion] = useState(0);
	const [foreground, setForeground] = useState(true);
	const client = useMemo(() => demo
		? new PhoneClient(memoryCredentials(sampleCredentials), createSampleFetch())
		: new PhoneClient(store, ((input, init) => expoFetch(input, init as never)) as typeof fetch, (name) => { setRemoved(name); setCredentials(null); setConnected(false); router.replace("/pair"); }), [demo]);
	const currentClient = useRef(client);
	currentClient.current = client;
	const startDemo = useCallback(() => { setDemo(true); setCredentials(sampleCredentials); setRemoved(null); setConnected(true); }, []);
	const leaveDemo = useCallback(() => { setCredentials(null); setConnected(false); setDemo(false); }, []);
	const refresh = useCallback(async () => {
		const creds = await client.restore();
		if (currentClient.current !== client) return;
		setCredentials(creds); setReady(true);
		if (creds) {
			setRemoved(null);
			try { await client.hello(); if (currentClient.current === client) setConnected(true); }
			catch { if (currentClient.current === client) setConnected(false); }
		} else setConnected(false);
	}, [client]);
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
					await client.hello(undefined, abort.signal);
					if (!active) break;
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
				await reconnectPause(Math.min(30_000, delay * (0.75 + Math.random() * 0.5)), abort.signal);
				delay = Math.min(30_000, delay * 2);
			}
		})();
		return () => { active = false; abort.abort(); };
	}, [client, credentials, foreground]);
	return <Context.Provider value={{ client, demo, startDemo, leaveDemo, credentials, ready, connected, removed, eventVersion, foregroundVersion, foreground, refresh }}>{children}</Context.Provider>;
}
