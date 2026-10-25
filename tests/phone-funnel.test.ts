import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, copyFileSync, chmodSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PhoneFunnel, CliFailure, runPhoneCli, findPhoneCli } from "../src/server/phone-funnel.ts";
const own = { TCP: { "8443": { HTTPS: true } }, Web: { "sample.tailnet.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4791" } } } }, AllowFunnel: { "sample.tailnet.ts.net:8443": true } };
const running = (approved = true) => JSON.stringify({ BackendState: "Running", Self: { ID: "fake-node", DNSName: "sample.tailnet.ts.net.", CapMap: approved ? { funnel: [], https: [] } : {} } });
it("reports missing, signed-out, unapproved, approved, and idempotent Funnel states", async () => {
	assert.deepEqual(await new PhoneFunnel(undefined, async () => undefined).enable(), { state: "no-tailscale" });
	assert.deepEqual(await new PhoneFunnel(async () => '{"BackendState":"NeedsLogin"}', async () => "fake").enable(), { state: "no-tailscale" });
	const calls: string[][] = [];
	let approved = false; let config: object | null = null;
	const funnel = new PhoneFunnel(async (_file, args, timeout) => {
		calls.push(args);
		if (args[0] === "status") { assert.equal(timeout, 3500); return running(approved); }
		if (args[0] === "serve") { assert.equal(timeout, 3500); return JSON.stringify(config); }
		assert.equal(timeout, 10_000); config = args.at(-1) === "off" ? {} : own; return "";
	}, async () => "fake");
	assert.deepEqual(await funnel.enable(), { state: "needs-approval", approveUrl: "https://login.tailscale.com/f/funnel?node=fake-node" });
	approved = true;
	assert.deepEqual(await funnel.enable(), { state: "listening", address: "https://sample.tailnet.ts.net:8443", mode: "public" });
	await funnel.enable();
	assert.equal(calls.filter((args) => args[0] === "funnel").length, 1);
	await funnel.disable();
	assert.deepEqual(calls.at(-1), ["funnel", "--https=8443", "off"]);
	assert.deepEqual(config, {});
});
it("never mutates foreign mappings, extra mounts, TCP forwards, or foreground services", async () => {
	const configs = [
		{ TCP: { "8443": { TCPForward: "localhost:8080" } } },
		{ ...own, Web: { "sample.tailnet.ts.net:8443": { Handlers: { "/": { Proxy: "http://localhost:8080" } } } } },
		{ ...own, Web: { "sample.tailnet.ts.net:8443": { Handlers: { ...own.Web["sample.tailnet.ts.net:8443"].Handlers, "/other": { Text: "foreign" } } } } },
		{ Foreground: { other: own } },
	];
	for (const config of configs) {
		const funnel = new PhoneFunnel(async (_file, args) => {
			assert.notEqual(args[0], "funnel"); return args[0] === "status" ? running() : JSON.stringify(config);
		}, async () => "fake");
		const status = await funnel.enable(); assert.equal(status.state, "error");
		if (status.state === "error") assert.match(status.message, /8443 is used by/);
		await funnel.disable();
	}
});
it("maps timeouts to approval, rejects bad responses, and hides CLI stderr", async () => {
	for (const command of ["status", "serve", "funnel"]) {
		const funnel = new PhoneFunnel(async (_file, args) => {
			if (args[0] === command) throw new CliFailure("timeout");
			return args[0] === "status" ? running() : "{}";
		}, async () => "fake");
		assert.equal((await funnel.enable()).state, command === "status" ? "no-tailscale" : "needs-approval");
	}
	assert.equal((await new PhoneFunnel(async () => "invalid sensitive output", async () => "fake").enable()).state, "error");
});
it("finds a fake CLI on PATH, walks approval to disable, and kills timed-out children", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "lh-funnel-"));
	const previousPath = process.env.PATH; const previousState = process.env.LH_FAKE_TAILSCALE_STATE;
	try {
		const file = path.join(dir, "tailscale"); const stateFile = path.join(dir, "state.json");
		copyFileSync(new URL("./fixtures/phone-tailscale.mjs", import.meta.url), file); chmodSync(file, 0o755);
		process.env.PATH = `${dir}${path.delimiter}${previousPath}`; process.env.LH_FAKE_TAILSCALE_STATE = stateFile;
		writeFileSync(stateFile, JSON.stringify({ approved: false }));
		assert.equal(await findPhoneCli(), file);
		const funnel = new PhoneFunnel();
		assert.equal((await funnel.enable()).state, "needs-approval");
		writeFileSync(stateFile, JSON.stringify({ approved: true }));
		assert.equal((await funnel.enable()).state, "listening");
		await funnel.disable();
		assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")).config, {});
		writeFileSync(stateFile, JSON.stringify({ hang: "status --json" }));
		const start = performance.now();
		await assert.rejects(runPhoneCli(file, ["status", "--json"], 150), (error: unknown) => error instanceof CliFailure && error.code === "timeout");
		assert.ok(performance.now() - start < 1500);
	} finally {
		process.env.PATH = previousPath;
		if (previousState === undefined) delete process.env.LH_FAKE_TAILSCALE_STATE; else process.env.LH_FAKE_TAILSCALE_STATE = previousState;
		rmSync(dir, { recursive: true, force: true });
	}
});
