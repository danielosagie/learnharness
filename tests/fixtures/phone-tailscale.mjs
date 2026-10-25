#!/usr/bin/env node
// Deterministic CLI double: only its throwaway state file is mutable.
import fs from 'node:fs';
const file = process.env.LH_FAKE_TAILSCALE_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
state.calls ??= [];
state.calls.push(args);
fs.writeFileSync(file, JSON.stringify(state));
if (state.hang === args.join(' ')) setTimeout(() => {}, 60000);
else if (state.fail === args.join(' ')) { process.stderr.write('sensitive fake stderr'); process.exitCode = 1; }
else if (args[0] === 'status') console.log(JSON.stringify({ BackendState: state.backend ?? 'Running', Self: { ID: 'fake-node', DNSName: 'sample.tailnet.ts.net.', CapMap: state.approved ? { funnel: [], https: [] } : {} } }));
else if (args[0] === 'serve') console.log(JSON.stringify(state.config ?? {}));
else if (args[0] === 'funnel') {
	state.config = args.at(-1) === 'off' ? {} : { TCP: { '8443': { HTTPS: true } }, Web: { 'sample.tailnet.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4791' } } } }, AllowFunnel: { 'sample.tailnet.ts.net:8443': true } };
	fs.writeFileSync(file, JSON.stringify(state));
}
else process.exitCode = 1;
