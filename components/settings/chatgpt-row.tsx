"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { notifySettingsSaved } from "@/components/settings-signal";

type Status = { state: "idle" | "waiting" | "signed_in" } | { state: "error"; message: string };

function ChatGPTEvents({ refresh }: { refresh: () => void }) {
	useServerEvent("auth-changed", refresh);
	useServerResync(refresh);
	return null;
}

export function ChatGPTRow({ events = true }: { events?: boolean }) {
	const [mounted, setMounted] = useState(false);
	const [status, setStatus] = useState<Status>({ state: "idle" });
	const [busy, setBusy] = useState(false);
	const [url, setUrl] = useState<string | null>(null);
	const [manual, setManual] = useState("");
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/auth/chatgpt/status");
			if (!res.ok) throw new Error();
			const next = await res.json() as Status;
			setStatus(next);
			if (next.state === "signed_in" || next.state === "idle") setUrl(null);
			if (next.state === "signed_in") notifySettingsSaved("keys");
		} catch { setError("Could not read sign-in status."); }
	}, []);
	useEffect(() => { setMounted(true); void refresh(); }, [refresh]);
	useEffect(() => {
		if (events || status.state !== "waiting") return;
		const timer = setInterval(() => { void refresh(); }, 1000);
		return () => clearInterval(timer);
	}, [events, status.state, refresh]);

	async function start() {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/auth/chatgpt/start", { method: "POST" });
			if (!res.ok) throw new Error();
			const body = await res.json() as { url: string };
			setUrl(body.url);
			setStatus({ state: "waiting" });
			window.open(body.url, "_blank", "noopener,noreferrer");
		} catch { setError("Could not start sign-in."); void refresh(); }
		finally { setBusy(false); }
	}

	async function action(path: "cancel" | "logout") {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/auth/chatgpt/${path}`, { method: "POST" });
			if (!res.ok) throw new Error();
			await refresh();
			notifySettingsSaved("keys");
		} catch { setError(path === "cancel" ? "Could not cancel sign-in." : "Could not sign out."); }
		finally { setBusy(false); }
	}

	async function submit() {
		const res = await fetch("/api/auth/chatgpt/submit", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: manual }),
		}).catch(() => null);
		if (!res?.ok) setError("Could not use that URL.");
		else { setManual(""); setError(null); }
	}

	const waiting = status.state === "waiting";
	return (
		<div data-testid="chatgpt-row" className="flex flex-col gap-2 rounded-sm px-1 py-1.5">
			{events && mounted && <ChatGPTEvents refresh={() => { void refresh(); }} />}
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="font-ui text-xs text-foreground">ChatGPT / Codex</p>
					<p className="text-xs text-muted-foreground">The plan Codex runs on (Plus or Pro) — no API key.</p>
				</div>
				{status.state === "signed_in" ? (
					<div className="flex shrink-0 items-center gap-2 text-xs"><span>Signed in · ChatGPT subscription</span><button type="button" disabled={busy} onClick={() => void action("logout")} className="underline">Sign out</button></div>
				) : waiting ? (
					<div className="flex shrink-0 items-center gap-2 text-xs"><span>Finish signing in in your browser…</span><button type="button" disabled={busy} onClick={() => void action("cancel")} className="underline">Cancel</button></div>
				) : (
					<button type="button" disabled={busy} onClick={() => void start()} className="shrink-0 rounded-sm border border-border px-3 py-1.5 font-ui text-xs">Sign in with ChatGPT</button>
				)}
			</div>
			{waiting && url && <a href={url} target="_blank" rel="noreferrer" className="text-xs underline">Open sign-in page ↗</a>}
			{waiting && <div className="flex gap-2"><input aria-label="Redirected URL" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Paste the URL you were redirected to" className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 text-xs" /><button type="button" disabled={!manual.trim()} onClick={() => void submit()} className="text-xs underline">Use URL</button></div>}
			{(error || status.state === "error") && <p role="alert" className="text-xs text-red-500">{status.state === "error" ? status.message : error}</p>}
		</div>
	);
}
