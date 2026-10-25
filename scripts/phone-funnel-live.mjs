// Real Next and HTTP proxy; the only simulated dependency is Tailscale's CLI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-phone-public-'));
const cli = path.join(data, 'tailscale'); const stateFile = path.join(data, 'cli.json');
fs.copyFileSync(new URL('../tests/fixtures/phone-tailscale.mjs', import.meta.url), cli); fs.chmodSync(cli, 0o755);
fs.writeFileSync(stateFile, JSON.stringify({ approved: false }));
const env = { ...process.env, PATH: `${data}${path.delimiter}${process.env.PATH}`, LH_FAKE_TAILSCALE_STATE: stateFile, LH_DATA_DIR: data, NEXT_TELEMETRY_DISABLED: '1' };
delete env.PORT; delete env.__NEXT_PRIVATE_ORIGIN; delete env.LH_PHONE_HOST;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3218'], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
const local = 'http://127.0.0.1:3218'; const phone = 'http://127.0.0.1:4791';
const started = performance.now(); const receipt = {};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(url, init) { const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) }); assert.equal(res.status, 200); return res.json(); }
const put = (enabled) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
function free(port) { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(() => resolve())); }); }
try {
	let ready = false;
	for (let i = 0; i < 120; i++) {
		try { if ((await fetch(local + '/api/phone', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
		await delay(500);
	}
	assert.ok(ready, 'Next did not start');
	assert.equal((await api(local + '/api/phone')).status.state, 'off'); assert.equal(state().calls, undefined);
	await api(local + '/api/phone', put(true));
	const pending = await api(local + '/api/phone'); assert.equal(pending.status.state, 'needs-approval');
	receipt.beforeApproval = pending.status;
	assert.equal((await fetch(local + '/api/phone/pairing', { method: 'POST' })).status, 409);
	fs.writeFileSync(stateFile, JSON.stringify({ ...state(), approved: true }));
	const approveAt = performance.now();
	let status;
	for (let i = 0; i < 75; i++) {
		status = await api(local + '/api/phone'); if (status.status.state === 'listening') break;
		await delay(500);
	}
	assert.deepEqual(status.status, { state: 'listening', address: 'https://sample.tailnet.ts.net:8443', mode: 'public' });
	receipt.approvalDetectedMs = performance.now() - approveAt; receipt.afterApproval = status.status;
	const hello = await api(phone + '/api/phone/hello'); assert.deepEqual(Object.keys(hello).sort(), ['app', 'version']);
	const pairing = await api(local + '/api/phone/pairing', { method: 'POST' });
	assert.equal(new URL(pairing.link).searchParams.get('url'), status.status.address);
	const paired = await api(phone + '/api/phone/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code, deviceName: 'Fake CLI live check' }) });
	const headers = { authorization: `Bearer ${paired.token}` };
	assert.deepEqual((await api(phone + '/api/chats', { headers })).chats, []);
	assert.equal((await fetch(phone + '/api/chats', { headers: { 'Tailscale-Funnel-Request': '1' } })).status, 401);
	assert.equal((await fetch(phone + '/api/phone', { headers })).status, 403);
	const pingAt = performance.now(); const abort = new AbortController();
	const events = await fetch(phone + '/api/events', { headers, signal: abort.signal }); const reader = events.body.getReader();
	const ping = await Promise.race([reader.read(), delay(28000).then(() => { throw new Error('No SSE ping'); })]);
	assert.match(new TextDecoder().decode(ping.value), /: ping|event:/); receipt.eventsFirstChunkMs = performance.now() - pingAt; abort.abort();
	for (const [key, base, options] of [['direct', local, {}], ['proxy', phone, { headers }]]) {
		const timings = [];
		for (let i = 0; i < 50; i++) { const start = performance.now(); await api(base + '/api/chats', options); timings.push(performance.now() - start); }
		timings.sort((a, b) => a - b); receipt[key] = { requests: 50, p50Ms: timings[24], p95Ms: timings[47] };
	}
	status = await api(local + '/api/phone'); await fetch(local + '/api/phone/devices/' + status.devices[0].id, { method: 'DELETE' });
	assert.equal((await fetch(phone + '/api/chats', { headers })).status, 401); receipt.revokedStatus = 401;
	await api(local + '/api/phone', put(false));
	assert.equal((await api(local + '/api/phone')).status.state, 'off');
	assert.deepEqual(state().config, {}); assert.ok(state().calls.some((args) => args.join(' ') === 'funnel --https=8443 off'));
	receipt.disabled = { state: 'off', mapping: 'removed' }; receipt.totalMs = performance.now() - started;
	await free(4791); receipt.listenerAfterDisable = 'closed';
	console.log(JSON.stringify(receipt, null, 2));
} catch (error) { console.error(error.message); console.error(logs.slice(-2000)); process.exitCode = 1; }
finally {
	const exited = once(child, 'exit'); process.kill(-child.pid, 'SIGTERM'); await exited;
	for (const port of [3218, 4791]) await free(port);
	fs.rmSync(data, { recursive: true, force: true }); console.log('Stopped Next; ports 3218 and 4791 are free.');
}
