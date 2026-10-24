"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { useSettingsSaved } from "@/components/settings-signal";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { strongKeyless } from "@/components/setup-cta";
import { REVIEW_PICK_LIMIT, dueIncludedMessage, type ModelCatalogResponse } from "@/src/core";

type DueResponse = {
	due: { id: string; name: string; statement: string }[];
	nextDueAt: string | null;
};

/** Both entry points read the same due list and create a regular practice chat. */
export function PracticeDueButton({ className = "" }: { className?: string }) {
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();
	const [review, setReview] = useState<DueResponse | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/api/review", { cache: "no-store" });
			if (!response.ok) throw new Error("Could not load reviews");
			setReview(await response.json() as DueResponse);
			setError(null);
		} catch { setError("Could not load reviews"); }
	}, []);
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const scheduleRefresh = useCallback(() => {
		if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
		refreshTimer.current = setTimeout(() => {
			refreshTimer.current = null;
			void refresh();
		}, 250);
	}, [refresh]);
	useEffect(() => () => { if (refreshTimer.current !== null) clearTimeout(refreshTimer.current); }, []);
	useEffect(() => { void refresh(); }, [refresh]);
	useServerEvent("turn-settled", scheduleRefresh);
	useServerEvent("chats-changed", scheduleRefresh);
	useServerEvent("activity-changed", scheduleRefresh);
	useServerResync(() => void refresh());
	useSettingsSaved((section) => { if (section === "agent") scheduleRefresh(); });
	useEffect(() => {
		window.addEventListener("lh:graph-revision", scheduleRefresh);
		return () => window.removeEventListener("lh:graph-revision", scheduleRefresh);
	}, [scheduleRefresh]);
	const count = review?.due.length ?? 0;
	useEffect(() => {
		if (!review?.nextDueAt || count > 0) return;
		const delay = Math.min(2_147_483_647, Math.max(0, Date.parse(review.nextDueAt) - Date.now() + 50));
		const timer = window.setTimeout(() => void refresh(), delay);
		return () => window.clearTimeout(timer);
	}, [review?.nextDueAt, count, refresh]);
	const start = async () => {
		if (!review || count === 0 || busy) return;
		setBusy(true);
		setError(null);
		try {
			const modelsResponse = await fetch("/api/models", { cache: "no-store" });
			if (!modelsResponse.ok) throw new Error("Could not check models");
			const catalog = await modelsResponse.json() as ModelCatalogResponse;
			if (!catalog.slots.strong || !catalog.slots.cheap || !catalog.slots.vision) {
				openSettings("agent");
				setBusy(false);
				return;
			}
			if (strongKeyless(catalog)) {
				openSettings("keys");
				setBusy(false);
				return;
			}
			const title = "Practice what's due";
			const response = await fetch("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title, kind: "practice", graphContext: { propositions: review.due.slice(0, REVIEW_PICK_LIMIT) } }),
			});
			if (!response.ok) throw new Error("Could not start practice");
			const { id } = await response.json() as { id: string };
			router.push(`/chat/${id}?prompt=${encodeURIComponent(title)}`);
		} catch {
			setError("Could not start practice");
			setBusy(false);
		}
	};
	return (
		<div className={className}>
			<button type="button" disabled={!review || !count || busy || error === "Could not load reviews"} onClick={() => void start()} className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:text-muted-foreground" data-testid="practice-due">
				{review ? count ? `Practice what's due · ${count}` : "Nothing due" : error ?? "Checking reviews…"}
			</button>
			{error && review && <p className="mt-1 text-xs text-muted-foreground">{error}</p>}
			{review && dueIncludedMessage(count) && <p className="mt-1 text-xs text-muted-foreground">{dueIncludedMessage(count)}</p>}
			{review && count === 0 && review.nextDueAt && <p className="mt-1 text-xs text-muted-foreground">Next due {new Date(review.nextDueAt).toLocaleString()}</p>}
		</div>
	);
}
