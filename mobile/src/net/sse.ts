export interface SseFrame {
	event: string;
	data: string;
}

/** Both streams use the same incremental framing, including CRLF and comment pings. */
export class SseParser {
	private buffer = "";
	push(chunk: string): SseFrame[] {
		this.buffer += chunk;
		const out: SseFrame[] = [];
		for (;;) {
			const match = /\r?\n\r?\n/.exec(this.buffer);
			if (!match) break;
			const raw = this.buffer.slice(0, match.index);
			this.buffer = this.buffer.slice(match.index + match[0].length);
			let event = "message";
			const data: string[] = [];
			for (const line of raw.split(/\r?\n/)) {
				if (line.startsWith(":")) continue;
				if (line.startsWith("event:")) event = line.slice(6).trimStart();
				if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
			}
			if (data.length) out.push({ event, data: data.join("\n") });
		}
		return out;
	}
}

export async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
	const reader = body.getReader();
	const parser = new SseParser();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const frame of parser.push(decoder.decode(value, { stream: true }))) yield frame;
		}
		for (const frame of parser.push(decoder.decode())) yield frame;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

/** Backgrounding cancels backoff as well as the stream reader. */
export function reconnectPause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) { resolve(); return; }
		const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}
