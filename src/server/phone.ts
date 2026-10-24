/** Paired-phone door: a second listener on the Tailscale interface only. */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os, { type NetworkInterfaceInfo } from "node:os";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { emit } from "../core/events.ts";
import { readSettings, writeSettings } from "../store/settings.ts";
import { phoneDevices, type PhoneDevice } from "../store/phone-devices.ts";
import { version } from "../../package.json";

export const PHONE_PORT = 4791;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const name = os.hostname().replace(/\.local$/i, "");
type PhoneStatus = { state: "off" | "listening" | "no-tailscale" | "error"; address?: string; message?: string };
type Pairing = { code: string; link: string; expiresAt: string };
interface Runtime {
	server?: http.Server;
	address?: string;
	status: PhoneStatus;
	pairing?: Pairing;
	pairingTimer?: ReturnType<typeof setTimeout>;
	failures: number[];
	blockedUntil: number;
	timer?: ReturnType<typeof setInterval>;
	pending?: Promise<void>;
	clock: () => number;
}
const KEY = Symbol.for("lh.phone");
function runtime(): Runtime {
	const global = globalThis as Record<symbol, Runtime | undefined>;
	return (global[KEY] ??= { status: { state: "off" }, failures: [], blockedUntil: 0, clock: Date.now });
}
function changed() { emit("phone-changed", {}); }
function status(next: PhoneStatus) {
	const state = runtime();
	if (JSON.stringify(state.status) === JSON.stringify(next)) return;
	state.status = next;
	changed();
}

/** A Tailscale IPv4 must share an interface with its unique IPv6 prefix. */
export function tailscaleAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = os.networkInterfaces()): string | undefined {
	for (const entries of Object.values(interfaces)) {
		if (!entries?.some((entry) => entry.family === "IPv6" && entry.address.toLowerCase().startsWith("fd7a:115c:a1e0:"))) continue;
		for (const entry of entries) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			const octets = entry.address.split(".").map(Number);
			if (octets.length === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return entry.address;
		}
	}
}

export function normalizePhoneCode(value: string): string { return value.toUpperCase().replaceAll("O", "0").replace(/[IL]/g, "1"); }

/** Next publishes its selected origin after listen, including CLI ports and retries.
 *  Standalone/Electron supply PORT directly. Resolve at request time, after startup. */
export function phoneUpstreamPort(env: Readonly<Record<string, string | undefined>> = process.env): number {
	if (env.__NEXT_PRIVATE_ORIGIN) {
		const origin = new URL(env.__NEXT_PRIVATE_ORIGIN);
		return Number(origin.port || (origin.protocol === "https:" ? 443 : 80));
	}
	return Number(env.PORT || 3000);
}

function code() { return Array.from(randomBytes(8), (byte) => ALPHABET[byte & 31]).join(""); }
function hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function publicDevice(device: PhoneDevice) {
	return { id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt };
}
function currentPairing(): Pairing | null {
	const state = runtime();
	if (!state.pairing) return null;
	if (Date.parse(state.pairing.expiresAt) <= state.clock()) {
		state.pairing = undefined;
		if (state.pairingTimer) clearTimeout(state.pairingTimer);
		state.pairingTimer = undefined;
		changed();
		return null;
	}
	return state.pairing;
}
export function phoneStatus() {
	return {
		enabled: readSettings()?.phone?.enabled ?? false,
		status: runtime().status,
		devices: phoneDevices.list().map(publicDevice),
		pairing: currentPairing(),
	};
}
export function mintPairing(): Pairing | null {
	const state = runtime();
	if (state.status.state !== "listening" || !state.address) return null;
	const value = code();
	const url = `http://${state.address}:${PHONE_PORT}`;
	const pairing = { code: value, link: `learnharness://pair?url=${encodeURIComponent(url)}&code=${value}`, expiresAt: new Date(state.clock() + 300_000).toISOString() };
	if (state.pairingTimer) clearTimeout(state.pairingTimer);
	state.pairing = pairing;
	state.pairingTimer = setTimeout(() => {
		if (state.pairing !== pairing) return;
		state.pairing = undefined;
		state.pairingTimer = undefined;
		changed();
	}, 300_000);
	state.pairingTimer.unref?.();
	changed();
	return pairing;
}
export async function removePhoneDevice(id: string): Promise<boolean> {
	const removed = await phoneDevices.remove(id);
	if (removed) changed();
	return removed;
}
export async function setPhoneEnabled(enabled: boolean) {
	const settings = readSettings() ?? { version: 1 };
	writeSettings({ ...settings, phone: { enabled } });
	await syncPhoneServer();
	changed();
}

function json(res: ServerResponse, statusCode: number, body: unknown) {
	res.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}
function validToken(token: string): PhoneDevice | undefined {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
	const candidate = Buffer.from(hash(token), "hex");
	return phoneDevices.list().find((device) => {
		if (!/^[a-f0-9]{64}$/.test(device.tokenHash)) return false;
		return timingSafeEqual(candidate, Buffer.from(device.tokenHash, "hex"));
	});
}
async function pair(req: IncomingMessage, res: ServerResponse) {
	const state = runtime();
	const now = state.clock();
	if (state.blockedUntil > now) return json(res, 429, { message: "Too many attempts. Try again in a minute." });
	let body = "";
	try {
		for await (const chunk of req) {
			body += chunk;
			if (body.length > 4096) return json(res, 400, { message: "Invalid request" });
		}
		const parsed: unknown = JSON.parse(body);
		const input = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
		const pairing = currentPairing();
		if (typeof input.code !== "string" || !pairing || normalizePhoneCode(input.code) !== pairing.code) {
			state.failures = state.failures.filter((at) => now - at < 60_000);
			state.failures.push(now);
			if (state.failures.length >= 5) {
				state.blockedUntil = now + 60_000;
				return json(res, 429, { message: "Too many attempts. Try again in a minute." });
			}
			return json(res, 401, { message: "That code expired or was already used." });
		}
		if (typeof input.deviceName !== "string" || !input.deviceName.trim() || input.deviceName.length > 80) return json(res, 400, { message: "Invalid device name" });
		state.pairing = undefined; // consume before the queued write
		if (state.pairingTimer) clearTimeout(state.pairingTimer);
		state.pairingTimer = undefined;
		changed();
		const token = randomBytes(32).toString("base64url");
		const at = new Date(now).toISOString();
		await phoneDevices.add({ id: randomUUID(), name: input.deviceName.trim(), tokenHash: hash(token), createdAt: at, lastSeenAt: at });
		changed();
		return json(res, 200, { token, name });
	} catch {
		return json(res, 400, { message: "Invalid request" });
	}
}

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
function stripHeaders(headers: http.IncomingHttpHeaders) {
	const blocked = new Set(HOP);
	for (const item of (headers.connection ?? "").split(",")) blocked.add(item.trim().toLowerCase());
	return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}
function forward(req: IncomingMessage, res: ServerResponse) {
	const headers = stripHeaders(req.headers);
	delete headers.authorization;
	const port = phoneUpstreamPort();
	headers.host = `127.0.0.1:${port}`;
	headers["accept-encoding"] = "identity";
	headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
	headers["x-lh-phone"] = "1";
	const upstream = http.request({ host: "127.0.0.1", port, method: req.method, path: req.url, headers }, (response) => {
		const responseHeaders = stripHeaders(response.headers);
		res.writeHead(response.statusCode ?? 502, responseHeaders);
		response.pipe(res);
	});
	upstream.on("error", () => { if (!res.headersSent) json(res, 502, { message: "Server unavailable" }); else res.destroy(); });
	req.on("aborted", () => upstream.destroy());
	res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
	req.pipe(upstream);
}
async function handle(req: IncomingMessage, res: ServerResponse) {
	const path = new URL(req.url ?? "/", "http://phone").pathname;
	if (req.method === "GET" && path === "/api/phone/hello") return json(res, 200, { app: "learnharness", version, name });
	if (req.method === "POST" && path === "/api/phone/pair") return pair(req, res);
	const authorization = req.headers.authorization;
	const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
	const device = validToken(token);
	if (!device) return json(res, 401, { message: "Not paired" });
	void phoneDevices.seen(device.id, new Date(runtime().clock()).toISOString()).then((updated) => { if (updated) changed(); });
	forward(req, res);
}

/** Reconcile the listener with settings and the current network interface. */
async function reconcilePhoneServer(): Promise<void> {
	const state = runtime();
	const enabled = readSettings()?.phone?.enabled === true;
	const address = enabled ? process.env.LH_PHONE_HOST || tailscaleAddress() : undefined;
	if (state.server && (!enabled || state.address !== address)) {
		state.server.close();
		state.server = undefined;
		state.address = undefined;
		state.pairing = undefined;
		if (state.pairingTimer) clearTimeout(state.pairingTimer);
		state.pairingTimer = undefined;
		changed();
	}
	if (!enabled) return status({ state: "off" });
	if (!address) return status({ state: "no-tailscale" });
	if (state.server) return;
	const server = http.createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, { message: "Phone access failed" }); else res.destroy(); }); });
	state.server = server;
	state.address = address;
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(PHONE_PORT, address, () => { server.off("error", reject); resolve(); });
		});
		status({ state: "listening", address });
	} catch (error) {
		state.server = undefined;
		state.address = undefined;
		status({ state: "error", message: (error as NodeJS.ErrnoException).code === "EADDRINUSE" ? "Port 4791 is in use" : `Phone access failed: ${error instanceof Error ? error.message : String(error)}` });
	}
}

/** Serialize startup and settings/network changes so a late listen cannot resurrect an off listener. */
export function syncPhoneServer(): Promise<void> {
	const state = runtime();
	const next = (state.pending ?? Promise.resolve()).catch(() => undefined).then(reconcilePhoneServer);
	state.pending = next;
	return next;
}

/** Called by Next's Node instrumentation hook; global guard survives reloads.
 *  LH_PHONE_HOST is a test-only bind override for hosts without Tailscale. */
export function startPhoneServer() {
	const state = runtime();
	if (state.timer) return;
	state.timer = setInterval(() => { void syncPhoneServer(); }, 30_000);
	state.timer.unref?.();
	void syncPhoneServer();
}
