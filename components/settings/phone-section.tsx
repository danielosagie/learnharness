"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";

interface PhoneSnapshot {
	enabled: boolean;
	status: { state: "off" | "listening" | "no-tailscale" | "needs-approval" | "error"; address?: string; mode?: "public"; approveUrl?: string; message?: string };
	devices: Array<{ id: string; name: string; createdAt: string; lastSeenAt: string }>;
	pairing: { code: string; link: string; expiresAt: string } | null;
}

function ago(then: string, now: number): string {
	const minutes = Math.max(0, Math.floor((now - Date.parse(then)) / 60_000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hr ago`;
	return `${Math.floor(hours / 24)} days ago`;
}

export function PhoneSection() {
	const [snapshot, setSnapshot] = useState<PhoneSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const [qr, setQr] = useState<{ link: string; svg: string } | null>(null);
	const refresh = useCallback(() => {
		void fetch("/api/phone").then(async (res) => {
			if (!res.ok) throw new Error(`Phone status failed (${res.status})`);
			setSnapshot(await res.json() as PhoneSnapshot);
		}).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Phone status failed"));
	}, []);
	useEffect(() => { refresh(); }, [refresh]);
	useServerEvent("phone-changed", refresh);
	useServerResync(refresh);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		const link = snapshot?.pairing?.link;
		if (!link) return;
		let live = true;
		void QRCode.toString(link, { type: "svg", margin: 2 }).then((svg) => {
			if (live) setQr({ link, svg });
		}).catch(() => { if (live) setQr(null); });
		return () => { live = false; };
	}, [snapshot?.pairing?.link]);

	async function request(path: string, method: "PUT" | "POST" | "DELETE", body?: object) {
		setError(null);
		try {
			const res = await fetch(path, {
				method,
				headers: body ? { "content-type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			});
			if (!res.ok) {
				const result = await res.json() as { message?: string };
				throw new Error(result.message ?? `Phone request failed (${res.status})`);
			}
			refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Phone request failed");
		}
	}
	const pairing = snapshot?.pairing;
	const seconds = pairing ? Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1_000)) : 0;
	const state = snapshot?.status;
	const status = state?.state === "listening" ? "On · reachable from anywhere"
		: state?.state === "no-tailscale" ? "Install and sign in to Tailscale on this computer"
		: state?.state === "needs-approval" ? "Approve Tailscale Funnel once so your phone can connect without Tailscale"
		: state?.state === "error" ? state.message ?? "Phone access failed"
		: "Off";
	return <>
		<SettingsRow label="Phone access" hint={status} testid="row-phone-access">
			<Toggle checked={snapshot?.enabled ?? false} disabled={!snapshot} label="phone access" onChange={(enabled) => void request("/api/phone", "PUT", { enabled })} />
		</SettingsRow>
		{state?.state === "needs-approval" && state.approveUrl && <button type="button" className="self-start text-xs underline" onClick={() => window.open(state.approveUrl, "_blank")}>Approve in Tailscale</button>}
		{state?.state === "no-tailscale" && <a className="text-xs underline" href="https://tailscale.com/download" target="_blank" rel="noreferrer">Download Tailscale</a>}
		{error && <p role="alert" className="text-xs text-red-500">{error}</p>}
		{state?.state === "listening" && <SettingsGroup label="Pair a phone">
			<button type="button" className="self-start rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-accent" onClick={() => void request("/api/phone/pairing", "POST")}>Pair a phone</button>
			{pairing && seconds > 0 && <div className="flex items-center gap-4">
				{qr?.link === pairing.link && <div className="size-40 shrink-0 bg-white p-1" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: qr.svg }} />}
				<div className="text-xs">
					<p className="font-mono text-lg tracking-widest">{pairing.code.slice(0, 4)}·{pairing.code.slice(4)}</p>
					<p className="text-muted-foreground">Expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>
				</div>
			</div>}
		</SettingsGroup>}
		<SettingsGroup label="Paired devices">
			{snapshot?.devices.length === 0 && <p className="text-xs text-muted-foreground">No phones yet</p>}
			{snapshot?.devices.map((device) => <SettingsRow key={device.id} label={`${device.name} · last used ${ago(device.lastSeenAt, now)}`}>
				<button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void request(`/api/phone/devices/${encodeURIComponent(device.id)}`, "DELETE")}>Remove</button>
			</SettingsRow>)}
		</SettingsGroup>
	</>;
}
