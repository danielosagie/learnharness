export type HandyPhase = "idle" | "connecting" | "recording" | "stopping";
export type HandyRequest = (command: "toggle" | "cancel") => Promise<{ ok: boolean; error?: string }>;

/** One run is bounded even if Handy never pastes (for example its paste
 * method is set to None). Two hours is beyond a normal dictation session. */
export const HANDY_TRIPWIRE_MS = 2 * 60 * 60 * 1000;
/** Streaming models paste within ~1s of stop; long Parakeet recordings and
 * Handy LLM post-processing can take tens of seconds. Three minutes is far
 * past any good run, so an empty transcript cannot hold submit indefinitely. */
export const HANDY_STOP_TRIPWIRE_MS = 3 * 60_000;

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
		if (phase === "stopping") return cancel();
		if (phase === "connecting") return;
		const starting = phase === "idle";
		const id = ++generation;
		set(starting ? "connecting" : "stopping");
		const result = await request("toggle").catch(() => ({ ok: false, error: "Handy command failed" }));
		if (id !== generation) return;
		if (!result.ok) return reset(result.error ?? "Handy command failed");
		if (starting) {
			set("recording");
			timer = timers.setTimeout(() => reset("Handy did not paste"), HANDY_TRIPWIRE_MS);
		} else {
			if (timer) timers.clearTimeout(timer);
			timer = timers.setTimeout(() => reset(), HANDY_STOP_TRIPWIRE_MS);
		}
	};
	const cancel = () => {
		if (phase === "idle") return;
		void request("cancel").catch(() => {});
		reset();
	};
	return {
		get phase() { return phase; },
		toggle,
		onPaste: () => { if (phase !== "idle") reset(); },
		cancel,
		finish: () => {
			if (phase === "idle") return Promise.resolve();
			const pending = new Promise<void>((resolve) => waiters.push(resolve));
			if (phase === "recording") void toggle();
			return pending;
		},
		dispose: () => reset(),
	};
}
