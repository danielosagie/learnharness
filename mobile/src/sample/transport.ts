/** The development mock and the bundled lesson share one in-memory server.
 *  This adapter never delegates a request to the network. */
import { sampleResponse } from "./response.ts";
import lesson from "./lesson.json" with { type: "json" };
import type { FetchLike, Credentials, CredentialStore } from "../net/client.ts";
import type { LhMessage } from "../../../src/core/native-messages.ts";
import { newAnswerResult, newNextMessage, newProblemDismissedMarker, newThinkingMessage, newUserMessage } from "../../../src/core/native-messages.ts";

type Message = LhMessage;
type RecordData = { id: string; title: string; kind: string; createdAt: string; updatedAt: string; messages: Message[]; tree?: unknown; turnInFlight: boolean; problemNumber?: number; pendingInput?: any };
export const sampleCredentials: Credentials = { url: "https://sample.invalid", token: "sample", name: "SAMPLE" };
export function memoryCredentials(initial: Credentials | null = null): CredentialStore {
	let value = initial;
	return { get: async () => value, set: async (next) => { value = next; } };
}
export interface SampleOptions {
	name?: string;
	token?: string;
	code?: string;
	frameMs?: number;
	records?: RecordData[];
	summaries?: () => unknown[];
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export function createSampleFetch(options: SampleOptions = {}): FetchLike {
	const record = copy(lesson.record) as unknown as RecordData;
	record.updatedAt = new Date(Date.now() - 120_000).toISOString();
	const chats = new Map<string, RecordData>([record, ...(options.records ?? [])].map((chat) => [chat.id, copy(chat)]));
	const replayed = new Set<string>();
	const solved = new Set<string>();
	const eventClients = new Set<(type: string, payload: object) => void>();
	const token = options.token ?? sampleCredentials.token;
	const name = options.name ?? "SAMPLE";
	let sequence = 0;
	const id = () => `sample-${++sequence}`;
	const now = () => new Date().toISOString();
	const notify = (type: string, payload: object = {}) => { for (const fn of eventClients) fn(type, payload); };
	const due = Array.from({ length: 12 }, (_, i) => ({ id: `idea-${i + 1}`, name: ["Chain rule", "Derivative of cos", "Power rule"][i % 3], statement: "Review this idea", lane: i < 3 ? "new" : "review", dueAt: now() }));
	const assistant = (content: unknown[]): Message => ({ id: id(), role: "assistant", content, timestamp: Date.now() }) as Message;
	const tool = (callId: string, toolName: string): Message => ({ id: id(), role: "toolResult", toolCallId: callId, toolName, content: [{ type: "text", text: "Done" }], details: null, isError: false, timestamp: Date.now() });
	const summary = (chat: RecordData) => {
		const results = new Set(chat.messages.filter((m) => m.role === "toolResult").map((m) => m.toolCallId));
		const calls = chat.messages.flatMap((m) => m.role === "assistant" ? m.content.filter((p) => p.type === "toolCall") : []);
		const pending = calls.some((p) => p.type === "toolCall" && ["quiz", "probe", "ask_user_question", "explain", "recall"].includes(p.name) && !results.has(p.id));
		return { ...chat, messages: undefined, tree: undefined, phase: "teach", pendingQuestion: pending, pendingProblem: calls.filter((p) => p.type === "toolCall" && ["problem", "conclude"].includes(p.name)).at(-1)?.name === "problem", busy: chat.turnInFlight };
	};
	function practiceTurn(chat: RecordData): Message[] {
		const input = chat.pendingInput ?? { type: "text" };
		if (input.type === "thinking") {
			const callId = id();
			solved.add(`idea-${chat.problemNumber ?? 1}`);
			return [assistant([{ type: "toolCall", id: callId, name: "conclude", arguments: { outcome: "solved", verdict: "Three layers, one product. You peeled from the outside and kept each inside untouched until its turn.", rung: null, missClass: null, retest: false } }]), tool(callId, "conclude")];
		}
		if (input.type === "text" && chat.problemNumber) return [assistant([{ type: "text", text: "Work from the outside in. Which layer changes first?" }])];
		chat.problemNumber = (chat.problemNumber ?? 0) + 1;
		const callId = id();
		return [assistant([{ type: "toolCall", id: callId, name: "problem", arguments: { statement: "Differentiate, and say which layer you handled first.\n\n$$h(x)=\\cos^3(5x)$$", mode: "composition", target: [`idea-${chat.problemNumber}`], modelSolution: "Outside in: cube, then cos, then 5x.\n\n$$h'(x)=-15\\cos^2(5x)\\sin(5x)$$" } }]), tool(callId, "problem")];
	}
	const streamHeaders = { "content-type": "text/event-stream", "cache-control": "no-cache" };
	const encoder = new TextEncoder();
	const json = (body: unknown, status = 200) => sampleResponse(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	function stream(chat: RecordData, signal?: AbortSignal | null): Response {
		if (!chat.turnInFlight) return sampleResponse('data: {"type":"turn-settled"}\n\n', { headers: streamHeaders });
		// A replay is advanced once and persisted independently of its subscribers.
		const messages = chat.kind === "practice" ? practiceTurn(chat) : replayed.has(chat.id) ? [assistant([{ type: "text", text: "You've reached the end of the sample lesson. Try practice from Home to review the chain rule." }])] : copy(lesson.nextTurn) as unknown as Message[];
		replayed.add(chat.id);
		const frames: object[] = [{ type: "agent_start" }, { type: "turn_start" }];
		for (const message of messages) {
			if (message.role === "assistant") {
				const { id: _id, ...wire } = message;
				frames.push({ type: "message_start", message: { ...wire, content: [] } });
				for (let count = 1; count <= wire.content.length; count++) {
					const content = wire.content.slice(0, count);
					const last = content.at(-1)!;
					if (last.type === "text") {
						for (let end = 100; end < last.text.length; end += 100) frames.push({ type: "message_update", message: { ...wire, content: [...content.slice(0, -1), { ...last, text: last.text.slice(0, end) }] } });
					}
					frames.push({ type: "message_update", message: { ...wire, content } });
				}
				frames.push({ type: "message_end", message: wire });
			} else if (message.role === "toolResult") frames.push({ type: "tool_execution_end", toolCallId: message.toolCallId, isError: false, result: { details: message.details } });
		}
		frames.push({ type: "turn_end", toolResults: messages.filter((m) => m.role === "toolResult") }, { type: "agent_end" });
		chat.messages.push(...messages); chat.turnInFlight = false; chat.pendingInput = undefined; chat.updatedAt = now();
		notify("turn-settled", { chatId: chat.id });
		let timer: ReturnType<typeof setTimeout> | undefined;
		let index = -1;
		let closed = false;
		let stop = () => {};
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				stop = () => { if (closed) return; closed = true; clearTimeout(timer); signal?.removeEventListener("abort", stop); controller.close(); };
				const pump = () => {
					if (closed) return;
					controller.enqueue(encoder.encode(index < 0 ? ": ping\n\n" : index < frames.length ? `data: ${JSON.stringify(frames[index])}\n\n` : "data: [DONE]\n\n"));
					if (index++ >= frames.length) stop(); else timer = setTimeout(pump, options.frameMs ?? 35);
				};
				if (signal?.aborted) stop(); else { signal?.addEventListener("abort", stop, { once: true }); pump(); }
			},
			cancel() { closed = true; clearTimeout(timer); signal?.removeEventListener("abort", stop); },
		});
		return sampleResponse(body, { headers: streamHeaders });
	}
	return (async (input, init = {}) => {
		if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		const pathname = url.pathname;
		const method = init.method ?? "GET";
		const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
		if (pathname === "/api/phone/hello") return json({ app: "learnharness", version: "sample" });
		if (pathname === "/api/phone/pair" && method === "POST") return body.code === (options.code ?? "ABCD1234") ? json({ token, name }) : json({ message: "Bad or expired code" }, 401);
		if (new Headers(init.headers).get("authorization") !== `Bearer ${token}`) return json({ message: "Not paired" }, 401);
		if (pathname === "/api/events") {
			let cleanup = (_close = true) => {};
			return sampleResponse(new ReadableStream<Uint8Array>({ start(controller) {
				let closed = false;
				const send = (type: string, payload: object) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`));
				const timer = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 1000);
				const onAbort = () => cleanup();
				cleanup = (close = true) => { if (closed) return; closed = true; clearInterval(timer); eventClients.delete(send); init.signal?.removeEventListener("abort", onAbort); if (close) controller.close(); };
				eventClients.add(send); controller.enqueue(encoder.encode(": ping\n\n"));
				init.signal?.addEventListener("abort", onAbort, { once: true });
			}, cancel() { cleanup(false); } }), { headers: streamHeaders });
		}
		if (pathname === "/api/review") {
			const ids = url.searchParams.get("ids");
			return ids !== null ? json({ items: due.filter((p) => ids.split(",").includes(p.id)).map((p, i) => ({ ...p, lane: "review", dueAt: new Date(Date.now() + ([9, 14, 21][i] ?? 9) * 86_400_000).toISOString() })) }) : json({ due: due.filter((p) => !solved.has(p.id)), nextDueAt: null });
		}
		if (pathname === "/api/models") return json({ slots: { strong: "sample", cheap: "sample", vision: "sample" } });
		if (pathname === "/api/chats" && method === "GET") return json({ chats: options.summaries?.() ?? [...chats.values()].map(summary) });
		if (pathname === "/api/chats" && method === "POST") {
			const messages: Message[] = body.kind === "practice" && body.graphContext?.propositions?.length ? [{ id: id(), role: "custom", customType: "graph-context", details: { propositions: body.graphContext.propositions, chains: [] }, content: "[Session context]", display: true, timestamp: Date.now() }] : [];
			const chat = { ...copy(record), id: id(), title: body.title, kind: body.kind ?? "teach", tree: body.kind === "practice" ? null : record.tree, messages, createdAt: now(), updatedAt: now() };
			chats.set(chat.id, chat); notify("chats-changed"); return json({ id: chat.id, title: chat.title });
		}
		const match = /^\/api\/chats\/([^/]+)(?:\/(stream|steer|dismiss))?$/.exec(pathname);
		const chat = chats.get(match?.[1] ?? body.chatId ?? body.id ?? url.searchParams.get("chatId"));
		if (pathname === "/api/jobs") return json({ turnInFlight: !!chat?.turnInFlight });
		if (pathname === "/api/activity/abort") { if (chat) chat.turnInFlight = false; return json({ ok: true }); }
		if (!chat) return json({ message: "Chat not found" }, 404);
		if (match) {
			if (!match[2]) return json(chat);
			if (match[2] === "stream") return stream(chat, init.signal);
			if (match[2] === "steer") return json({ ok: chat.turnInFlight }, chat.turnInFlight ? 200 : 409);
			if (match[2] === "dismiss") {
				const value = body.input;
				if (value.type === "dismiss-problem") chat.messages.push(newProblemDismissedMarker(value.problemCallId));
				else chat.messages.push(newAnswerResult(value.toolCallId, "quiz", value.answer));
				return json({ ok: true });
			}
		}
		if (pathname === "/api/chat" && method === "POST") {
			if (chat.turnInFlight) return json({ message: "Running" }, 409);
			const value = body.input;
			if (value.type === "text") chat.messages.push(newUserMessage(value.text));
			if (value.type === "answer") {
				const call = chat.messages.flatMap((m) => m.role === "assistant" ? m.content : []).find((p) => p.type === "toolCall" && p.id === value.toolCallId);
				chat.messages.push(newAnswerResult(value.toolCallId, call?.type === "toolCall" ? call.name : "quiz", value.answer));
			}
			if (value.type === "thinking") chat.messages.push(newThinkingMessage(value.problemCallId, value.text));
			if (value.type === "next") chat.messages.push(newNextMessage());
			chat.turnInFlight = true; chat.pendingInput = value;
			notify("turn-started", { chatId: chat.id }); return json({ ok: true });
		}
		return json({ message: "Not found" }, 404);
	}) as FetchLike;
}
