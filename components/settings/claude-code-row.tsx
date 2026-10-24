"use client";

import { useEffect, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { notifySettingsSaved } from "@/components/settings-signal";

interface Status {
	installed: boolean;
	loggedIn: boolean;
	subscriptionType: string | null;
}

function ClaudeCodeEvents({ refresh }: { refresh: () => void }) {
	useServerEvent("auth-changed", refresh);
	useServerResync(refresh);
	return null;
}

export function ClaudeCodeRow({ events = true }: { events?: boolean }) {
	const [status, setStatus] = useState<Status | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const refresh = async () => {
		setRefreshing(true);
		setFailed(false);
		try {
			const response = await fetch("/api/claude-code");
			if (!response.ok) throw new Error("Status unavailable");
			setStatus(await response.json() as Status);
			notifySettingsSaved("keys");
		} catch { setStatus(null); setFailed(true); }
		finally { setRefreshing(false); }
	};
	useEffect(() => { void refresh(); }, []);
	const line = status?.loggedIn
		? `Connected${status.subscriptionType ? ` · ${status.subscriptionType[0]?.toUpperCase()}${status.subscriptionType.slice(1)} plan` : ""}`
		: status?.installed
			? <>Run <code>claude</code> in a terminal, then <code>/login</code></>
			: status ? "Not installed" : failed ? "Status unavailable" : "Checking…";
	return (
		<div data-testid="claude-code-row" className="flex flex-col gap-2 rounded-sm px-1 py-1.5">
			{events && <ClaudeCodeEvents refresh={() => { void refresh(); }} />}
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="font-ui text-xs text-foreground">Claude</p>
					<p className="text-xs text-muted-foreground">Use your Claude Code login for Claude models — no API key.</p>
				</div>
				<span className="flex items-center gap-2 font-ui text-xs text-muted-foreground">
					<span>{line}</span>
					{status && !status.installed && <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer" className="underline">Install ↗</a>}
					<button type="button" onClick={() => void refresh()} disabled={refreshing} className="rounded-sm border border-border px-1.5 py-0.5 text-foreground disabled:opacity-40">Refresh</button>
				</span>
			</div>
		</div>
	);
}
