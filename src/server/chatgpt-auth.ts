import type { AuthPrompt, Models } from "@earendil-works/pi-ai";
import { piModels } from "../agent/models.ts";
import { emit } from "../core/events.ts";
import { hasOAuthCredential, oauthDeviceId } from "../store/oauth.ts";

export type ChatGPTStatus = { state: "idle" | "waiting" | "signed_in" } | { state: "error"; message: string };

interface Flow {
	controller: AbortController;
	url: Promise<string>;
	done: Promise<void>;
	manual?: { resolve: (value: string) => void; reject: (reason?: unknown) => void };
}

interface AuthRuntime {
	flow?: Flow;
	error?: string;
}

const RUNTIME_KEY = Symbol.for("lh.chatgptAuth");
function runtime(): AuthRuntime {
	const global = globalThis as Record<symbol, AuthRuntime | undefined>;
	return (global[RUNTIME_KEY] ??= {});
}

function changed() { emit("auth-changed", {}); }

export function chatGPTStatus(): ChatGPTStatus {
	const state = runtime();
	if (state.flow) return { state: "waiting" };
	if (hasOAuthCredential("openai")) return { state: "signed_in" };
	if (state.error) return { state: "error", message: state.error };
	return { state: "idle" };
}

/** Injecting a Models instance keeps the state machine deterministic in tests. */
export async function startChatGPTLogin(models: Pick<Models, "login"> = piModels()): Promise<{ url: string }> {
	const state = runtime();
	if (state.flow) return { url: await state.flow.url };
	state.error = undefined;
	const controller = new AbortController();
	let resolveUrl!: (url: string) => void;
	let rejectUrl!: (reason?: unknown) => void;
	const url = new Promise<string>((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject; });
	// A login may fail before it emits auth_url; both promises are observed.
	void url.catch(() => undefined);
	const flow: Flow = { controller, url, done: Promise.resolve() };
	state.flow = flow;
	changed();
	flow.done = oauthDeviceId().then((deviceId) => models.login("openai", "oauth", {
		signal: controller.signal,
		notify(event) {
			if (event.type === "auth_url") resolveUrl(event.url);
		},
		prompt(prompt: AuthPrompt) {
			if (prompt.type !== "manual_code") return Promise.reject(new Error("Unsupported sign-in prompt"));
			return new Promise<string>((resolve, reject) => {
				flow.manual = { resolve, reject };
				const abort = () => reject(new Error("Sign-in cancelled"));
				prompt.signal?.addEventListener("abort", abort, { once: true });
				if (prompt.signal?.aborted) abort();
			});
		},
	}, { getDeviceId: () => deviceId, agentName: "LearnHarness" }))
		.then(() => {
			if (state.flow === flow) { state.flow = undefined; changed(); }
		})
		.catch((error: unknown) => {
			rejectUrl(error);
			if (state.flow !== flow) return;
			state.flow = undefined;
			if (!controller.signal.aborted) state.error = error instanceof Error && error.message.includes("Port 1455")
				? "Port 1455 is in use. Close the other sign-in and try again."
				: `Sign-in failed: ${error instanceof Error ? error.message.trim().slice(0, 200) : String(error).trim().slice(0, 200)}`;
			changed();
		});
	return { url: await url };
}

export async function cancelChatGPTLogin(): Promise<void> {
	const flow = runtime().flow;
	if (!flow) return;
	flow.controller.abort();
	flow.manual?.reject(new Error("Sign-in cancelled"));
	await flow.done;
}

export function submitChatGPTCallback(value: string): boolean {
	const flow = runtime().flow;
	if (!flow?.manual || !value.trim()) return false;
	flow.manual.resolve(value.trim());
	flow.manual = undefined;
	return true;
}

export async function logoutChatGPT(models: Pick<Models, "logout"> = piModels()): Promise<void> {
	await cancelChatGPTLogin();
	await models.logout("openai");
	runtime().error = undefined;
	changed();
}
