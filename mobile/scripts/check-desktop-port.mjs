import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-phone-port-'));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ version: 1, phone: { enabled: true } }));
const env = { ...process.env, LH_DATA_DIR: data, LH_PHONE_HOST: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1' };
delete env.PORT; delete env.__NEXT_PRIVATE_ORIGIN;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3218'], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', (b) => { logs += b; }); server.stderr.on('data', (b) => { logs += b; });
const local = 'http://127.0.0.1:3218'; const phone = 'http://127.0.0.1:4791';
const started = performance.now();
try {
	let ready = false;
	for (let i = 0; i < 120; i++) {
		try { const res = await fetch(phone + '/api/phone/hello', { signal: AbortSignal.timeout(1000) }); if (res.ok) { ready = true; break; } } catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	assert.ok(ready, 'Next phone listener did not start');
	const mint = await fetch(local + '/api/phone/pairing', { method: 'POST' });
	assert.equal(mint.status, 200); const pairing = await mint.json();
	const pair = await fetch(phone + '/api/phone/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code, deviceName: 'Port check' }) });
	assert.equal(pair.status, 200); const { token } = await pair.json();
	const headers = { authorization: `Bearer ${token}` };
	const check = performance.now();
	const forwarded = await fetch(phone + '/api/chats', { headers });
	assert.equal(forwarded.status, 200); assert.deepEqual((await forwarded.json()).chats, []);
	const status = await (await fetch(local + '/api/phone')).json();
	assert.equal(status.devices.length, 1);
	const revoke = await fetch(local + '/api/phone/devices/' + status.devices[0].id, { method: 'DELETE' }); assert.equal(revoke.status, 200);
	assert.equal((await fetch(phone + '/api/chats', { headers })).status, 401);
	console.log(JSON.stringify({ command: 'next dev -p 3218 (PORT unset)', totalMs: performance.now() - started, proxyAndRevokeMs: performance.now() - check, forwardedStatus: 200, revokedStatus: 401 }, null, 2));
} catch (error) { console.error(error.message); console.error(logs.slice(-2500)); process.exitCode = 1; }
finally { process.kill(-server.pid, 'SIGTERM'); await new Promise((r) => server.once('exit', r)); fs.rmSync(data, { recursive: true, force: true }); }
