import { sseFrames, type SseFrame } from "./sse";

export interface Credentials { url: string; token: string; name: string }
export interface CredentialStore {
	get(): Promise<Credentials | null>;
	set(value: Credentials | null): Promise<void>;
}
export type FetchLike = typeof fetch;
export class ApiError extends Error {
	constructor(public status: number, message: string) { super(message); }
}
export function normalizePhoneCode(value: string): string { return value.toUpperCase().replaceAll("O", "0").replace(/[IL]/g, "1"); }
export function pairingLink(url: string, code: string): string {
	return `learnharness://pair?url=${encodeURIComponent(url)}&code=${encodeURIComponent(code)}`;
}
export function parsePairingLink(link: string): { url: string; code: string } {
	const parsed = new URL(link);
	if (parsed.protocol !== "learnharness:" || parsed.hostname !== "pair") throw new Error("Invalid pairing link");
	const url = parsed.searchParams.get("url") ?? "";
	const code = parsed.searchParams.get("code") ?? "";
	if (!/^http:\/\/[^/?#]+:4791$/.test(url) || !/^[A-Za-z0-9]{8}$/.test(code)) throw new Error("Invalid pairing details");
	return { url, code };
}
export function hostUrl(host: string): string {
	const clean = host.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
	if (!/^[a-zA-Z0-9.:-]+$/.test(clean) || !clean) throw new Error("Enter the computer's Tailscale IP or name.");
	return `http://${clean.replace(/:4791$/, "")}:4791`;
}
export class PhoneClient {
	private credentials: Credentials | null = null;
	constructor(private readonly storage: CredentialStore, private readonly fetchLike: FetchLike, private readonly onRemoved?: (name: string) => void) {}
	async restore(): Promise<Credentials | null> { this.credentials = await this.storage.get(); return this.credentials; }
	get paired(): Credentials | null { return this.credentials; }
	async hello(url = this.credentials?.url, signal?: AbortSignal): Promise<{ app: string; version: string; name: string }> {
		if (!url) throw new Error("No computer address");
		const res = await this.fetchLike(`${url}/api/phone/hello`, { signal });
		if (!res.ok) throw new ApiError(res.status, "Can't reach LearnHarness");
		return res.json();
	}
	async pair(url: string, code: string, deviceName: string): Promise<Credentials> {
		const hello = await this.hello(url);
		if (hello.app !== "learnharness") throw new Error("This is not LearnHarness.");
		const res = await this.fetchLike(`${url}/api/phone/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: normalizePhoneCode(code), deviceName }) });
		if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? "Pairing failed");
		const body = await res.json();
		this.credentials = { url, token: body.token, name: body.name };
		await this.storage.set(this.credentials);
		return this.credentials;
	}
	async unpair(): Promise<void> { this.credentials = null; await this.storage.set(null); }
	async api(path: string, init: RequestInit = {}): Promise<Response> {
		const creds = this.credentials;
		if (!creds) throw new Error("Pair this phone first.");
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${creds.token}`);
		if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
		const res = await this.fetchLike(`${creds.url}${path}`, { ...init, headers });
		if (res.status === 401) {
			const body = await res.clone().json().catch(() => ({}));
			if (body.message === "Not paired") { await this.unpair(); this.onRemoved?.(creds.name); throw new ApiError(401, "Not paired"); }
		}
		return res;
	}
	async json<T>(path: string, init: RequestInit = {}): Promise<T> {
		const res = await this.api(path, init);
		if (!res.ok) throw new ApiError(res.status, (await res.clone().json().catch(() => ({}))).message ?? `Request failed (${res.status})`);
		return res.json() as Promise<T>;
	}
	async *stream(path: string, signal?: AbortSignal): AsyncGenerator<SseFrame> {
		const res = await this.api(path, { signal });
		if (!res.ok || !res.body) throw new ApiError(res.status, `Stream failed (${res.status})`);
		for await (const frame of sseFrames(res.body)) yield frame;
	}
}
