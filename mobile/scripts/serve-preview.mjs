import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../.preview/web/', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
http.createServer((req, res) => {
	const pathname = decodeURIComponent(new URL(req.url, 'http://preview').pathname);
	const target = path.resolve(root, '.' + pathname);
	if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
	const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
	res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
	fs.createReadStream(file).pipe(res);
}).listen(8084, '127.0.0.1', () => console.log('Phone preview: http://localhost:8084'));
