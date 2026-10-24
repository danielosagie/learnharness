import type { ChatInput } from "../../../src/core/input-events.ts";
import { needsContinuation, newAnswerResult, newNextMessage, newProblemDismissedMarker, newThinkingMessage, newUserMessage, type LhMessage } from "../../../src/core/native-messages.ts";
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
	private generation = 0;
	private active = true;
	private submitting = false;
	private syncGeneration: number | null = null;
	private sentPrompt = false;
	constructor(readonly client: PhoneClient, readonly id: string) {}
	get isAttached(): boolean { return this.abort !== null; }
	subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
	private emit() { for (const fn of this.listeners) fn(); }
	private patch(patch: Partial<SessionSnapshot>) { this.state = { ...this.state, ...patch }; this.emit(); }
	get messages(): LhMessage[] { return [...(this.state.record?.messages ?? []), ...this.state.tail]; }
	get view() { return projectView(this.messages, { executions: this.state.executions, inFlight: this.state.busy, streamingIds: this.state.streamingIds }); }
	async load(signal?: AbortSignal): Promise<ChatRecord> {
		const generation = this.generation;
		const record = await this.client.json<ChatRecord>(`/api/chats/${encodeURIComponent(this.id)}`, { signal });
		if (this.active && generation === this.generation && !signal?.aborted) this.patch({ record, tail: [], busy: !!record.turnInFlight, error: null });
		return record;
	}
	/** A focused foreground view owns the reader. A late POST may finish, but
	 *  must never reopen a socket after that ownership has been released. */
	async open(prompt?: string): Promise<void> {
		this.active = true;
		await this.resync(prompt);
	}
	async resync(prompt?: string): Promise<void> {
		if (!this.active || this.isAttached || this.submitting || this.syncGeneration === this.generation) return;
		const generation = this.generation;
		this.syncGeneration = generation;
		try {
			const record = await this.load();
			if (!this.active || generation !== this.generation) return;
			if (prompt && !this.sentPrompt) { this.sentPrompt = true; void this.send({ type: "text", text: prompt }); }
			else if (record.turnInFlight) void this.attach();
			else if (needsContinuation(record.messages)) void this.send({ type: "continue" });
		} catch (e) { if (this.active && generation === this.generation) this.patch({ error: (e as Error).message }); }
		finally { if (this.syncGeneration === generation) this.syncGeneration = null; }
	}
	async attach(): Promise<void> {
		if (!this.active) return;
		this.abort?.abort();
		const controller = new AbortController(); this.abort = controller;
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
			if (!controller.signal.aborted) {
				const error = this.state.error;
				await this.load(controller.signal);
				if (error && !controller.signal.aborted) this.patch({ error });
			}
		} catch (e) { if (!controller.signal.aborted) this.patch({ error: (e as Error).message, busy: false }); }
		finally { if (this.abort === controller) { this.abort = null; this.patch({ busy: false, streamingIds: new Set(), executions: new Map() }); } }
	}
	apply(event: Record<string, unknown>): void {
		if (event.type === "error") { this.patch({ error: String(event.errorText ?? "Turn failed") }); return; }
		if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
			const message = event.message as LhMessage | undefined;
			if (!message) return;
			// Injected steer markers have their own id and cannot consume the assistant slot.
			if (message.role !== "assistant" && !message.id) return;
			const id = message.id ?? this.slot ?? localId();
			if (message.role === "assistant") this.slot = id;
			const withId = { ...message, id } as LhMessage;
			const tail = [...this.state.tail]; const index = tail.findIndex((m) => m.id === id);
			if (index < 0) tail.push(withId); else tail[index] = withId;
			const streamingIds = new Set(this.state.streamingIds);
			if (message.role === "assistant") {
				streamingIds.add(id);
				if (event.type === "message_end") {
					this.slot = null; streamingIds.delete(id);
					const failed = message as unknown as { stopReason?: string; errorMessage?: string };
					if (failed.stopReason === "error") this.patch({ error: failed.errorMessage ?? "Turn failed" });
				}
			}
			this.patch({ tail, streamingIds }); return;
		}
		if (event.type === "tool_execution_end") {
			const result = event.result as { details?: unknown; content?: Array<{ text?: string }> } | undefined;
			const executions = new Map(this.state.executions);
			executions.set(String(event.toolCallId), { isError: event.isError === true, output: result?.details, errorText: result?.content?.[0]?.text });
			this.patch({ executions }); return;
		}
		if (event.type === "turn_end" && Array.isArray(event.toolResults)) this.patch({ tail: [...this.state.tail, ...(event.toolResults as LhMessage[]).map((m) => ({ ...m, id: localId() }))] });
	}
	async send(input: ChatInput): Promise<void> {
		if (this.submitting || !this.active) return;
		this.submitting = true;
		const generation = this.generation;
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
			for (let elapsed = 0; response.status === 409 && elapsed < 30_000 && this.active && generation === this.generation; elapsed += 500) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				const job = await this.client.json<{ turnInFlight: boolean }>(`/api/jobs?chatId=${encodeURIComponent(this.id)}`).catch(() => ({ turnInFlight: true }));
				if (!job.turnInFlight) response = await this.client.api("/api/chat", { method: "POST", body: JSON.stringify({ chatId: this.id, input }) });
			}
			if (!response.ok) throw new Error(response.status === 503 ? "No models set up on your computer." : `Send failed (${response.status}).`);
			if (!this.active || generation !== this.generation) return;
			await this.load();
			if (!this.active || generation !== this.generation) return;
			this.submitting = false;
			await this.attach();
		} catch (e) { if (this.active && generation === this.generation) this.patch({ busy: false, error: (e as Error).message }); }
		finally { this.submitting = false; if (this.active && generation !== this.generation) void this.resync(); }
	}
	async steer(text: string): Promise<void> {
		try {
			const res = await this.client.api(`/api/chats/${encodeURIComponent(this.id)}/steer`, { method: "POST", body: JSON.stringify({ input: { type: "steer", id: `steer_${localId()}`, text } }) });
			if (res.status === 409) await this.send({ type: "text", text });
			else if (!res.ok) this.patch({ error: `Could not steer (${res.status}).` });
		} catch (e) { this.patch({ error: (e as Error).message }); }
	}
	async stop(): Promise<void> {
		try { await this.client.json("/api/activity/abort", { method: "POST", body: JSON.stringify({ kind: "turn", id: this.id }) }); this.abort?.abort(); this.abort = null; this.slot = null; this.patch({ busy: false, streamingIds: new Set(), executions: new Map() }); await this.load(); }
		catch (e) { this.patch({ error: (e as Error).message }); }
	}
	async dismiss(input: { type: "dismiss"; toolCallId: string; answer: unknown } | { type: "dismiss-problem"; problemCallId: string }): Promise<void> {
		if (this.state.busy) return;
		const call = input.type === "dismiss" ? this.messages.flatMap((m) => m.role === "assistant" ? m.content : []).find((b) => b.type === "toolCall" && b.id === input.toolCallId) : undefined;
		const marker = input.type === "dismiss-problem" ? newProblemDismissedMarker(input.problemCallId) : newAnswerResult(input.toolCallId, call?.type === "toolCall" ? call.name : "quiz", input.answer);
		this.patch({ tail: [...this.state.tail, { ...marker, id: localId() }] });
		try { await this.client.json(`/api/chats/${encodeURIComponent(this.id)}/dismiss`, { method: "POST", body: JSON.stringify({ input }) }); await this.load(); }
		catch (e) { this.patch({ error: (e as Error).message }); }
	}
	close(): void {
		this.active = false; this.generation++; this.abort?.abort(); this.abort = null; this.slot = null;
		this.patch({ busy: false, streamingIds: new Set(), executions: new Map() });
	}
}
