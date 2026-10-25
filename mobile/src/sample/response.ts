/** React Native's global Response is the non-streaming XHR polyfill. Build
 *  sample responses from Web Streams directly so native replay stays offline. */
export function sampleResponse(source: string | ReadableStream<Uint8Array>, init: { status?: number; headers?: HeadersInit } = {}): Response {
	const status = init.status ?? 200;
	let used = false;
	let body = typeof source === "string" ? new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(source)); controller.close(); } }) : source;
	async function bytes(): Promise<Uint8Array<ArrayBuffer>> {
		if (used) throw new TypeError("Response body already used");
		used = true;
		const reader = body.getReader(); const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			for (;;) { const value = await reader.read(); if (value.done) break; chunks.push(value.value); length += value.value.length; }
		} finally { reader.releaseLock(); }
		const result = new Uint8Array(length); let offset = 0;
		for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
		return result;
	}
	const response = {
		status, statusText: "", ok: status >= 200 && status < 300, headers: new Headers(init.headers), url: "", redirected: false, type: "basic",
		get body() { return body; }, get bodyUsed() { return used || body.locked; },
		bytes,
		async arrayBuffer() { return (await bytes()).buffer; },
		async text() { return new TextDecoder().decode(await bytes()); },
		async json() { return JSON.parse(await response.text()); },
		async blob() { return new Blob([await bytes()], { type: response.headers.get("content-type") ?? "" }); },
		async formData() { throw new Error("Sample responses do not contain forms"); },
		clone() {
			if (used || body.locked) throw new TypeError("Response body already used");
			const [first, second] = body.tee(); body = first;
			return sampleResponse(second, init);
		},
	};
	return response as Response;
}
