export type HandyPhase = "idle" | "connecting" | "recording" | "stopping";
export type HandyRequest = (command: "toggle" | "cancel") => Promise<{ ok: boolean; error?: string }>;

/** One run is bounded even if Handy never pastes (for example its paste
 * method is set to None). Two hours is beyond a normal dictation session. */
export const HANDY_TRIPWIRE_MS = 2 * 60 * 60 * 1000;

export function createHandyController(
	request: HandyRequest,
	changed: (phase: HandyPhase, error: string | null) => void,
	timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
) {
	let phase: HandyPhase = "idle";
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let waiters: Array<() => void> = [];
	const set = (next: HandyPhase, error: string | null = null) => {
		phase = next;
		changed(next, error);
	};
	const reset = (error: string | null = null) => {
		generation++;
		if (timer) timers.clearTimeout(timer);
		timer = null;
		set("idle", error);
		for (const done of waiters.splice(0)) done();
	};
	const toggle = async () => {
		if (phase === "stopping" || phase === "connecting") return;
		const starting = phase === "idle";
		const id = ++generation;
		set(starting ? "connecting" : "stopping");
		const result = await request("toggle").catch(() => ({ ok: false, error: "Handy command failed" }));
		if (id !== generation) return;
		if (!result.ok) return reset(result.error ?? "Handy command failed");
		if (starting) {
			set("recording");
			timer = timers.setTimeout(() => reset("Handy did not paste"), HANDY_TRIPWIRE_MS);
		}
	};
	return {
		get phase() { return phase; },
		toggle,
		onPaste: () => { if (phase !== "idle") reset(); },
		cancel: () => {
			if (phase === "idle") return;
			void request("cancel").catch(() => {});
			reset();
		},
		finish: () => {
			if (phase === "idle") return Promise.resolve();
			const pending = new Promise<void>((resolve) => waiters.push(resolve));
			if (phase === "recording") void toggle();
			return pending;
		},
		dispose: () => reset(),
	};
}
