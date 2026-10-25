import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createSampleFetch } from '../src/sample/transport.ts';
import { previewFixtures } from './preview-fixtures.mjs';
import fs from 'node:fs';
const preview = process.env.PHONE_PREVIEW === '1' ? previewFixtures(JSON.parse(fs.readFileSync(new URL('../fixtures/teach-final.json', import.meta.url), 'utf8'))) : null;
const code = process.env.MOCK_PAIR_CODE ?? crypto.randomBytes(4).toString('hex').toUpperCase();
const token = crypto.randomBytes(16).toString('hex');
const fetchLike = createSampleFetch({ code, token, name: preview ? 'MacBook' : 'Mock MacBook', ...(preview ? { records: preview.records, summaries: preview.summaries } : {}) });
const server = http.createServer(async (req, res) => {
	const abort = new AbortController();
	res.on('close', () => abort.abort());
	try {
		if (preview) {
			res.setHeader('access-control-allow-origin', 'http://localhost:8084');
			res.setHeader('access-control-allow-headers', 'authorization,content-type');
			res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
			if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
		}
		let body = ''; for await (const chunk of req) body += chunk;
		const response = await fetchLike(`http://mock${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}), signal: abort.signal });
		res.writeHead(response.status, Object.fromEntries(response.headers));
		if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
	} catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
server.listen(4791, '0.0.0.0', () => console.log(`Mock LearnHarness on port 4791\nPair code: ${code}\nPair link: learnharness://pair?url=${encodeURIComponent('http://127.0.0.1:4791')}&code=${code}`));
