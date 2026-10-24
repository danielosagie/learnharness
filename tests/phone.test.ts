import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { NetworkInterfaceInfo } from "node:os";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const data = mkdtempSync(path.join(tmpdir(), "lh-phone-test-"));
process.env.LH_DATA_DIR = data;
process.env.LH_PHONE_HOST = "127.0.0.1";
const { tailscaleAddress, mintPairing, setPhoneEnabled, removePhoneDevice, phoneStatus, PHONE_PORT } = await import("../src/server/phone.ts");
const { parsePhoneSettingsBody } = await import("../src/server/settings-body.ts");
const { withTurnHeartbeat } = await import("../src/server/pi/ui-stream.ts");
const management = await import("../app/api/phone/route.ts");
const pairingRoute = await import("../app/api/phone/pairing/route.ts");
const deviceRoute = await import("../app/api/phone/devices/[id]/route.ts");
const state = () => (globalThis as unknown as Record<symbol, {
	server?: Server; timer?: ReturnType<typeof setInterval>; clock: () => number; failures: number[]; blockedUntil: number;
}>)[Symbol.for("lh.phone")]!;
let upstream: Server | undefined;
const phone = (route: string, options?: RequestInit) => fetch(`http://127.0.0.1:${PHONE_PORT}${route}`, options);
const json = (body: object): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

after(async () => {
	await setPhoneEnabled(false);
	if (state().timer) clearInterval(state().timer);
	if (upstream) {
		upstream.closeAllConnections();
		await new Promise<void>((resolve) => upstream!.close(() => resolve()));
	}
	rmSync(data, { recursive: true, force: true });
});

describe("phone access", () => {
	it("requires both Tailscale addresses on the same non-loopback interface", () => {
		const v4 = (address: string, internal = false) => ({ address, family: "IPv4", internal }) as NetworkInterfaceInfo;
		const v6 = (address: string) => ({ address, family: "IPv6", internal: false }) as NetworkInterfaceInfo;
		const sample = { warp: [v4("100.101.2.3")], utun: [v6("fd7a:115c:a1e0::1"), v4("100.85.4.5")], lo: [v6("fd7a:115c:a1e0::2"), v4("100.86.4.5", true)] };
		assert.equal(tailscaleAddress({ warp: sample.warp }), undefined);
		assert.equal(tailscaleAddress({ warp: sample.warp, utun: sample.utun }), "100.85.4.5");
		assert.equal(tailscaleAddress({ lo: sample.lo }), undefined);
	});

	it("validates the enabled setting", () => {
		assert.deepEqual(parsePhoneSettingsBody({ enabled: true }), { ok: true, settings: { enabled: true } });
		assert.equal(parsePhoneSettingsBody({ enabled: "yes" }).ok, false);
	});

	it("rejects forwarded management requests", async () => {
		const request = new Request("http://127.0.0.1/api/phone", { headers: { "x-lh-phone": "1" } });
		assert.equal(management.GET(request).status, 403);
		assert.equal((await management.PUT(new Request(request.url, { method: "PUT", headers: request.headers, body: "{}" }))).status, 403);
		assert.equal((await pairingRoute.POST(request)).status, 403);
		assert.equal((await deviceRoute.DELETE(request, { params: Promise.resolve({ id: "x" }) })).status, 403);
	});

	it("reports a visible error when the fixed port is occupied", async () => {
		const blocker = createServer();
		await new Promise<void>((resolve) => blocker.listen(PHONE_PORT, "127.0.0.1", resolve));
		try {
			await setPhoneEnabled(true);
			assert.deepEqual(phoneStatus().status, { state: "error", message: "Port 4791 is in use" });
		} finally {
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
		}
	});

	it("pairs once, stores hashes, forwards streams, and revokes immediately", async () => {
		let forwarded: Record<string, string | string[] | undefined> = {};
		let upstreamAborted!: () => void;
		const aborted = new Promise<void>((resolve) => { upstreamAborted = resolve; });
		upstream = createServer((req, res) => {
			forwarded = req.headers;
			if (req.url === "/hang") {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write("data: ready\n\n");
				res.on("close", () => { if (!res.writableEnded) upstreamAborted(); });
				return;
			}
			if (req.url === "/stream") {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write("data: one\n\n");
				setTimeout(() => res.end("data: two\n\n"), 80);
				return;
			}
			res.end(`${req.method} ${req.url}`);
		});
		await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
		process.env.PORT = String((upstream.address() as { port: number }).port);
		await setPhoneEnabled(true);
		assert.equal(phoneStatus().status.state, "listening");
		assert.equal((await phone("/api/chats")).status, 401);
		assert.equal((await (await phone("/api/phone/hello")).json() as { app: string }).app, "learnharness");
		const first = mintPairing()!;
		const second = mintPairing()!;
		assert.notEqual(first.code, second.code);
		assert.equal((await phone("/api/phone/pair", json({ code: first.code, deviceName: "iPhone" }))).status, 401);
		const paired = await phone("/api/phone/pair", json({ code: second.code, deviceName: "iPhone" }));
		assert.equal(paired.status, 200);
		const { token } = await paired.json() as { token: string };
		assert.equal(token.length, 43);
		assert.equal((await phone("/api/phone/pair", json({ code: second.code, deviceName: "other" }))).status, 401);
		const disk = readFileSync(path.join(data, "phone-devices.json"), "utf8");
		assert.equal(disk.includes(token), false);
		assert.match(disk, /"tokenHash": "[a-f0-9]{64}"/);
		assert.equal(statSync(path.join(data, "phone-devices.json")).mode & 0o777, 0o600);
		const headers = { Authorization: `Bearer ${token}`, "x-lh-phone": "client", "x-forwarded-for": "client" };
		const ordinary = await phone("/test?x=1", { method: "POST", headers, body: "hello" });
		assert.equal(await ordinary.text(), "POST /test?x=1");
		assert.equal(forwarded["x-lh-phone"], "1");
		assert.notEqual(forwarded["x-forwarded-for"], "client");
		assert.equal(forwarded.authorization, undefined);
		const stream = await phone("/stream", { headers });
		const reader = stream.body!.getReader();
		const firstChunk = await reader.read();
		assert.match(new TextDecoder().decode(firstChunk.value), /one/);
		const secondChunk = await reader.read();
		assert.match(new TextDecoder().decode(secondChunk.value), /two/);
		await reader.cancel();
		const controller = new AbortController();
		const hanging = await phone("/hang", { headers, signal: controller.signal });
		await hanging.body!.getReader().read();
		controller.abort();
		await Promise.race([aborted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("upstream did not close")), 1_000))]);
		const id = phoneStatus().devices[0]!.id;
		assert.equal(await removePhoneDevice(id), true);
		assert.equal((await phone("/api/chats", { headers })).status, 401);
	});

	it("expires codes and limits five failed attempts within a minute", async () => {
		let now = Date.now();
		state().clock = () => now;
		state().failures = [];
		state().blockedUntil = 0;
		const pairing = mintPairing()!;
		now += 300_001;
		assert.equal((await phone("/api/phone/pair", json({ code: pairing.code, deviceName: "x" }))).status, 401);
		for (let i = 0; i < 3; i++) assert.equal((await phone("/api/phone/pair", json({ code: "BAD", deviceName: "x" }))).status, 401);
		assert.equal((await phone("/api/phone/pair", json({ code: "BAD", deviceName: "x" }))).status, 429);
		assert.equal((await phone("/api/phone/pair", json({ code: "BAD", deviceName: "x" }))).status, 429);
		now += 60_001;
		assert.equal((await phone("/api/phone/pair", json({ code: "BAD", deviceName: "x" }))).status, 401);
		state().clock = Date.now;
	});
});

it("adds comment heartbeats without ending a turn stream", async () => {
	let finish!: () => void;
	const source = new ReadableStream<Uint8Array>({ start(controller) {
		finish = () => controller.close();
	} });
	const reader = withTurnHeartbeat(source, 5).getReader();
	const ping = await reader.read();
	assert.equal(new TextDecoder().decode(ping.value), ": ping\n\n");
	finish();
	await reader.cancel();
});
