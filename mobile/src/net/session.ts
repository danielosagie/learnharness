import type { ChatInput } from "../../../src/core/input-events.ts";
import { newAnswerResult, newNextMessage, newThinkingMessage, newUserMessage, type LhMessage } from "../../../src/core/native-messages.ts";
import { projectView, type LiveExecution } from "../../../src/core/view.ts";
import type { PhoneClient } from "./client";

export interface ChatRecord { id: string; title: string; kind?: string; messages: LhMessage[]; tree?: unknown; turnInFlight?: boolean; compacting?: boolean; phase?: string }
export interface SessionSnapshot { record: ChatRecord | null; tail: LhMessage[]; busy: boolean; error: string | null; executions: Map<string, LiveExecution>; streamingIds: Set<string> }
let localSeq = 0;
const localId = () => `c_${Date.now().toString(36)}_${localSeq++}`;
export class PhoneSession {
	state: SessionSnapshot = { record: null, tail: [], busy: false, error: null, executions: new Map(), streamingIds: new Set() };
	private abort: AbortController | null = null;
	private slot: string | null = null;
	private listeners = new Set<() => void>();
	constructor(readonly client: PhoneClient, readonly id: string) {}
	get isAttached(): boolean { return this.abort !== null; }
	subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
	private emit() { for (const fn of this.listeners) fn(); }
	private patch(patch: Partial<SessionSnapshot>) { this.state = { ...this.state, ...patch }; this.emit(); }
	get messages(): LhMessage[] { return [...(this.state.record?.messages ?? []), ...this.state.tail]; }
	get view() { return projectView(this.messages, { executions: this.state.executions, inFlight: this.state.busy, streamingIds: this.state.streamingIds }); }
	async load(): Promise<ChatRecord> {
		const record = await this.client.json<ChatRecord>(`/api/chats/${encodeURIComponent(this.id)}`);
		this.patch({ record, tail: [], busy: !!record.turnInFlight, error: null });
		return record;
	}
	async attach(refetch = false): Promise<void> {
		this.abort?.abort();
		const controller = new AbortController(); this.abort = controller;
		if (refetch) await this.load();
		this.slot = null;
		this.patch({ tail: [], busy: true, executions: new Map(), streamingIds: new Set() });
		try {
			for await (const frame of this.client.stream(`/api/chats/${encodeURIComponent(this.id)}/stream`, controller.signal)) {
				if (controller.signal.aborted) break;
				if (frame.data === "[DONE]") break;
				let event: Record<string, unknown>;
				try { event = JSON.parse(frame.data); } catch { continue; }
				if (event.type === "turn-settled") break;
				this.apply(event);
			}
			if (!controller.signal.aborted) await this.load();
		} catch (e) { if (!controller.signal.aborted) this.patch({ error: (e as Error).message, busy: false }); }
		finally { if (this.abort === controller) { this.abort = null; this.patch({ busy: false, streamingIds: new Set(), executions: new Map() }); } }
	}
	apply(event: Record<string, unknown>): void {
		if (event.type === "error") { this.patch({ error: String(event.errorText ?? "Turn failed") }); return; }
		if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
			const message = event.message as LhMessage | undefined;
			if (!message) return;
			const id = message.id ?? (event.type === "message_start" ? localId() : this.slot ?? localId());
			if (message.role === "assistant") this.slot = id;
			const withId = { ...message, id } as LhMessage;
			const tail = [...this.state.tail]; const index = tail.findIndex((m) => m.id === id);
			if (index < 0) tail.push(withId); else tail[index] = withId;
			const streamingIds = new Set(this.state.streamingIds);
			if (message.role === "assistant") streamingIds.add(id);
			if (event.type === "message_end") { this.slot = null; streamingIds.delete(id); }
			this.patch({ tail, streamingIds }); return;
		}
		if (event.type === "tool_execution_end") {
			const result = event.result as { details?: unknown; content?: Array<{ text?: string }> } | undefined;
			const executions = new Map(this.state.executions);
			executions.set(String(event.toolCallId), { isError: event.isError === true, output: result?.details, errorText: result?.content?.[0]?.text });
			this.patch({ executions }); return;
		}
		if (event.type === "turn_end" && Array.isArray(event.toolResults)) {
			this.patch({ tail: [...this.state.tail, ...(event.toolResults as LhMessage[]).map((m) => ({ ...m, id: localId() }))] });
		}
	}
	async send(input: ChatInput): Promise<void> {
		const optimistic: LhMessage[] = [];
		if (input.type === "text") optimistic.push({ ...newUserMessage(input.text), id: localId() });
		if (input.type === "answer") {
			const tool = this.messages.flatMap((m) => m.role === "assistant" ? m.content : []).find((b) => b.type === "toolCall" && b.id === input.toolCallId);
			optimistic.push({ ...newAnswerResult(input.toolCallId, tool?.type === "toolCall" ? tool.name : "quiz", input.answer), id: localId() });
		}
		if (input.type === "thinking") optimistic.push({ ...newThinkingMessage(input.problemCallId, input.text), id: localId() });
		if (input.type === "next") optimistic.push({ ...newNextMessage(), id: localId() });
		this.patch({ tail: [...this.state.tail, ...optimistic], busy: true, error: null });
		try {
			let response = await this.client.api("/api/chat", { method: "POST", body: JSON.stringify({ chatId: this.id, input }) });
			for (let elapsed = 0; response.status === 409 && elapsed < 30_000; elapsed += 500) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				const job = await this.client.json<{ turnInFlight: boolean }>(`/api/jobs?chatId=${encodeURIComponent(this.id)}`).catch(() => ({ turnInFlight: true }));
				if (!job.turnInFlight) response = await this.client.api("/api/chat", { method: "POST", body: JSON.stringify({ chatId: this.id, input }) });
			}
			if (!response.ok) throw new Error(response.status === 503 ? "Set up models on your computer." : `Send failed (${response.status}).`);
			await this.load();
			await this.attach();
		} catch (e) { this.patch({ busy: false, error: (e as Error).message }); }
	}
	async steer(text: string): Promise<void> {
		const id = `steer_${localId()}`;
		const res = await this.client.api(`/api/chats/${encodeURIComponent(this.id)}/steer`, { method: "POST", body: JSON.stringify({ input: { type: "steer", id, text } }) });
		if (res.status === 409) await this.send({ type: "text", text });
		else if (!res.ok) this.patch({ error: `Could not steer (${res.status}).` });
	}
	async stop(): Promise<void> { await this.client.json("/api/activity/abort", { method: "POST", body: JSON.stringify({ kind: "turn", id: this.id }) }); await this.load(); }
	async dismiss(input: { type: "dismiss"; toolCallId: string; answer: unknown } | { type: "dismiss-problem"; problemCallId: string }): Promise<void> { await this.client.json(`/api/chats/${encodeURIComponent(this.id)}/dismiss`, { method: "POST", body: JSON.stringify({ input }) }); await this.load(); }
	close(): void { this.abort?.abort(); this.abort = null; }
}
