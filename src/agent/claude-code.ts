import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
	createAssistantMessageEventStream,
	createProvider,
	getCurrentSystemPrompt,
	getCurrentTools,
	parseStreamingJson,
	parseToolCallArguments,
	type AssistantMessage,
	type Api,
	type ImageContent,
	type JsonObject,
	type Model,
	type SimpleStreamOptions,
	type StreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { PATHS } from "../../config.ts";

export const CLAUDE_CODE_PROVIDER = "claude-code";
const MODEL_IDS = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"];
const TOOL_PREFIX = "mcp__lh__";

export interface ClaudeCodeStatus {
	installed: boolean;
	loggedIn: boolean;
	subscriptionType: string | null;
}

/** Discover the user's binary without consulting Claude's credential files. */
export function findClaudeBinary(env: Record<string, string | undefined> = process.env, home = homedir()): string | null {
	const executable = process.platform === "win32" ? "claude.exe" : "claude";
	const candidates = [
		env.LH_CLAUDE_BIN,
		...(env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, executable)),
		path.join(home, ".local", "bin", executable),
		...(process.platform === "win32"
			? [path.join(env.USERPROFILE ?? home, ".local", "bin", "claude.exe")]
			: [path.join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]),
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch { /* Try the next location. */ }
	}
	return null;
}

let statusCache: { until: number; bin: string | null; status: ClaudeCodeStatus } | null = null;

/** A short cache keeps model catalog reads and the send gate cheap. */
export function claudeCodeStatus(refresh = false): ClaudeCodeStatus {
	const bin = findClaudeBinary();
	if (!refresh && statusCache && statusCache.bin === bin && statusCache.until > Date.now()) return statusCache.status;
	let status: ClaudeCodeStatus = { installed: bin !== null, loggedIn: false, subscriptionType: null };
	if (bin) {
		try {
			const result = requireAuthStatus(bin);
			status = {
				installed: true,
				loggedIn: result.loggedIn === true,
				subscriptionType: typeof result.subscriptionType === "string" ? result.subscriptionType : null,
			};
		} catch { /* Missing login and CLI failures both leave the provider unavailable. */ }
	}
	statusCache = { until: Date.now() + 60_000, bin, status };
	return status;
}

function requireAuthStatus(bin: string): { loggedIn?: boolean; subscriptionType?: string } {
	const raw = execFileSync(bin, ["auth", "status"], {
		encoding: "utf8", timeout: 5000, windowsHide: true,
		env: claudeEnvironment(),
	});
	return JSON.parse(raw);
}

/** Only the API credentials are removed; the user's CLI login remains ambient. */
export function claudeEnvironment(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	return env;
}

function escapeMarkup(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

type PromptBlock = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
function imageBlock(image: ImageContent): PromptBlock {
	return { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } };
}

/** One user message avoids Claude Code's unsupported assistant-history input. */
export function renderClaudeHistory(context: TranscriptContext): PromptBlock[] {
	const blocks: PromptBlock[] = [];
	for (const message of context.messages) {
		if (message.role === "system") continue;
		if (message.role === "user") {
			const parts = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
			for (const part of parts) {
				if (part.type === "image") blocks.push(imageBlock(part));
				else blocks.push({ type: "text", text: `<user>${escapeMarkup(part.text)}</user>` });
			}
		} else if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "text") blocks.push({ type: "text", text: `<assistant>${escapeMarkup(part.text)}</assistant>` });
				else if (part.type === "toolCall") blocks.push({ type: "text", text: `<assistant><tool_call id="${escapeMarkup(part.id)}" name="${escapeMarkup(part.name)}">${escapeMarkup(JSON.stringify(part.arguments))}</tool_call></assistant>` });
			}
		} else if (message.role === "toolResult") {
			const attrs = `id="${escapeMarkup(message.toolCallId)}" name="${escapeMarkup(message.toolName)}"${message.isError ? " error" : ""}`;
			for (const part of message.content) {
				if (part.type === "image") blocks.push(imageBlock(part));
				else blocks.push({ type: "text", text: `<tool_result ${attrs}>${escapeMarkup(part.text)}</tool_result>` });
			}
		}
	}
	blocks.push({ type: "text", text: "This is the conversation so far. Continue as the assistant. Call tools natively when needed. Do not write the conversation tags." });
	return blocks;
}

function emptyResponse(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "pending", timestamp: Date.now(),
	};
}

function streamClaude(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	const output = emptyResponse(model);
	void (async () => {
		let child: ReturnType<typeof spawn> | undefined;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			const bin = findClaudeBinary();
			if (!bin) throw new Error("Claude Code isn't installed — install it, then refresh Settings.");
			if (!claudeCodeStatus().loggedIn) throw new Error("Claude Code isn't signed in — run `claude` in a terminal, then /login.");
			const tools = getCurrentTools(context.messages).map((tool) => ({
				name: tool.name, description: tool.description, inputSchema: tool.parameters,
			}));
			const mcpEnv: Record<string, string> = { LH_CLAUDE_TOOLS: JSON.stringify(tools), ELECTRON_RUN_AS_NODE: "1" };
			const mcpConfig = JSON.stringify({ mcpServers: { lh: {
				command: process.execPath, args: [path.join(PATHS.root, "scripts", "claude-code-mcp.mjs")], env: mcpEnv,
			} } });
			const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
				"--include-partial-messages", "--model", model.id, "--system-prompt", getCurrentSystemPrompt(context.messages),
				"--tools", "", "--strict-mcp-config", "--mcp-config", mcpConfig, "--max-turns", "1",
				"--setting-sources", "", "--no-session-persistence", "--disable-slash-commands", "--restricted"];
			const effort = options?.reasoning;
			if (effort) args.push("--effort", effort === "minimal" ? "low" : effort);
			const cwd = path.join(PATHS.data, "claude-code-cwd");
			mkdirSync(cwd, { recursive: true });
			child = spawn(bin, args, { cwd, env: claudeEnvironment(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
			const activeChild = child;
			let spawnError: Error | undefined;
			activeChild.on("error", (error) => { spawnError = error; });
			const exited = new Promise<number | null>((resolve) => activeChild.once("close", resolve));
			activeChild.stdin?.on("error", () => { /* A failed child may close stdin first. */ });
			const abort = () => {
				activeChild.kill("SIGTERM");
				killTimer = setTimeout(() => activeChild.kill("SIGKILL"), 2000);
			};
			options?.signal?.addEventListener("abort", abort, { once: true });
			if (options?.signal?.aborted) abort();
			activeChild.stdin!.end(`${JSON.stringify({ type: "user", message: { role: "user", content: renderClaudeHistory(context) } })}\n`);
			stream.push({ type: "start", partial: output });
			let buffer = "";
			const contentIndexes = new Map<number, number>();
			let sawMessageStart = false;
			let sawMessageStop = false;
			let result: Record<string, unknown> | undefined;
			let stderr = "";
			activeChild.stderr!.setEncoding("utf8");
			activeChild.stderr!.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4096); });
			activeChild.stdout!.setEncoding("utf8");
			for await (const chunk of activeChild.stdout!) {
				buffer += chunk;
				let end: number;
				while ((end = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, end);
					buffer = buffer.slice(end + 1);
					if (!line.trim()) continue;
					const event = JSON.parse(line) as Record<string, unknown>;
					if (event.type === "stream_event") {
						await options?.onProviderStreamEvent?.(event.event, model);
						const raw = event.event as Record<string, unknown>;
						if (raw.type === "message_start") sawMessageStart = true;
						if (raw.type === "message_stop") sawMessageStop = true;
						translateEvent(raw, output, stream, contentIndexes);
					}
					if (event.type === "result") result = event;
				}
			}
			const code = await exited;
			if (spawnError) throw spawnError;
			options?.signal?.removeEventListener("abort", abort);
			if (killTimer) clearTimeout(killTimer);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (result?.usage && typeof result.usage === "object") applyUsage(output, result.usage as Record<string, unknown>);
			const hasTool = output.content.some((part) => part.type === "toolCall");
			const expectedToolLimit = result?.subtype === "error_max_turns" && hasTool && output.rawStopReason === "tool_use";
			if (result?.is_error && !expectedToolLimit) throw new Error(mapCliError(result, stderr));
			if (code !== 0 && !expectedToolLimit) throw new Error(mapCliError(result, stderr));
			if (!result) throw new Error(mapCliError(undefined, stderr));
			if (!sawMessageStart || !sawMessageStop) throw new Error("Claude Code stream ended before the message completed.");
			output.stopReason = hasTool ? "toolUse" : output.stopReason === "length" ? "length" : "stop";
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			if (child && child.exitCode === null) child.kill("SIGTERM");
			if (killTimer) clearTimeout(killTimer);
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : "Claude Code failed.";
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
}

function mapCliError(result?: Record<string, unknown>, stderr = ""): string {
	const detail = `${result?.result ?? ""} ${stderr}`.toLowerCase();
	if (/rate.limit|rate limit|usage limit|hit your limit|limit reached/.test(detail)) return "Claude Code's usage limit was reached. Try again later.";
	if (/not logged in|not authenticated|login required/.test(detail)) return "Claude Code isn't signed in — run `claude` in a terminal, then /login.";
	return result ? "Claude Code could not complete this turn. Check `claude` in a terminal." : "Claude Code exited without a result. Check `claude` in a terminal.";
}

function applyUsage(output: AssistantMessage, usage: Record<string, unknown>) {
	if (usage.input_tokens != null) output.usage.input = Number(usage.input_tokens);
	if (usage.output_tokens != null) output.usage.output = Number(usage.output_tokens);
	if (usage.cache_read_input_tokens != null) output.usage.cacheRead = Number(usage.cache_read_input_tokens);
	if (usage.cache_creation_input_tokens != null) output.usage.cacheWrite = Number(usage.cache_creation_input_tokens);
	const cacheCreation = usage.cache_creation as Record<string, unknown> | undefined;
	if (cacheCreation?.ephemeral_1h_input_tokens != null) output.usage.cacheWrite1h = Number(cacheCreation.ephemeral_1h_input_tokens);
	const outputDetails = usage.output_tokens_details as Record<string, unknown> | undefined;
	if (outputDetails?.thinking_tokens != null) output.usage.reasoning = Number(outputDetails.thinking_tokens);
	output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
}

function translateEvent(event: Record<string, unknown>, output: AssistantMessage, stream: ReturnType<typeof createAssistantMessageEventStream>, indexes: Map<number, number>) {
	const index = Number(event.index ?? 0);
	const contentIndex = indexes.get(index);
	const at = contentIndex === undefined ? undefined : output.content[contentIndex];
	if (event.type === "message_start") {
		const message = event.message as Record<string, unknown>;
		output.responseId = String(message.id ?? "");
		if (typeof message.model === "string" && message.model !== output.model) output.responseModel = message.model;
		if (message.usage && typeof message.usage === "object") applyUsage(output, message.usage as Record<string, unknown>);
	} else if (event.type === "content_block_start") {
		const block = event.content_block as Record<string, unknown>;
		if (block.type === "text") {
			indexes.set(index, output.content.length);
			output.content.push({ type: "text", text: String(block.text ?? "") });
			stream.push({ type: "text_start", contentIndex: indexes.get(index)!, partial: output });
		} else if (block.type === "thinking" || block.type === "redacted_thinking") {
			indexes.set(index, output.content.length);
			output.content.push({ type: "thinking", thinking: block.type === "thinking" ? String(block.thinking ?? "") : "[Reasoning redacted]", thinkingSignature: String(block.signature ?? block.data ?? "") });
			stream.push({ type: "thinking_start", contentIndex: indexes.get(index)!, partial: output });
		} else if (block.type === "tool_use") {
			indexes.set(index, output.content.length);
			const name = String(block.name ?? "");
			output.content.push({ type: "toolCall", id: String(block.id), name: name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name, arguments: (block.input ?? {}) as JsonObject });
			stream.push({ type: "toolcall_start", contentIndex: indexes.get(index)!, partial: output });
		}
	} else if (event.type === "content_block_delta") {
		const delta = event.delta as Record<string, unknown>;
		if (at?.type === "text" && delta.type === "text_delta") {
			at.text += String(delta.text ?? "");
			stream.push({ type: "text_delta", contentIndex: contentIndex!, delta: String(delta.text ?? ""), partial: output });
		} else if (at?.type === "thinking" && delta.type === "thinking_delta") {
			at.thinking += String(delta.thinking ?? "");
			stream.push({ type: "thinking_delta", contentIndex: contentIndex!, delta: String(delta.thinking ?? ""), partial: output });
		} else if (at?.type === "thinking" && delta.type === "signature_delta") {
			at.thinkingSignature = (at.thinkingSignature ?? "") + String(delta.signature ?? "");
		} else if (at?.type === "toolCall" && delta.type === "input_json_delta") {
			const pending = at as typeof at & { partialJson?: string };
			pending.partialJson = (pending.partialJson ?? "") + String(delta.partial_json ?? "");
			pending.arguments = parseStreamingJson(pending.partialJson) as JsonObject;
			stream.push({ type: "toolcall_delta", contentIndex: contentIndex!, delta: String(delta.partial_json ?? ""), partial: output });
		}
	} else if (event.type === "content_block_stop" && at) {
		if (at.type === "text") stream.push({ type: "text_end", contentIndex: contentIndex!, content: at.text, partial: output });
		else if (at.type === "thinking") stream.push({ type: "thinking_end", contentIndex: contentIndex!, content: at.thinking, partial: output });
		else if (at.type === "toolCall") {
			const pending = at as typeof at & { partialJson?: string };
			if (pending.partialJson) Object.assign(at, parseToolCallArguments(pending.partialJson));
			delete pending.partialJson;
			stream.push({ type: "toolcall_end", contentIndex: contentIndex!, toolCall: at, partial: output });
		}
	} else if (event.type === "message_delta") {
		const delta = event.delta as Record<string, unknown>;
		if (typeof delta.stop_reason === "string") output.rawStopReason = delta.stop_reason;
		if (delta.stop_reason === "max_tokens") output.stopReason = "length";
		if (event.usage && typeof event.usage === "object") applyUsage(output, event.usage as Record<string, unknown>);
	}
}

export function claudeCodeProvider() {
	const catalog = anthropicProvider().getModels();
	return createProvider<"claude-code-cli">({
		id: CLAUDE_CODE_PROVIDER,
		name: "Claude (Claude Code)",
		auth: { apiKey: { name: "Claude Code login", resolve: async () => ({ auth: {}, source: "Claude Code" }) } },
		models: MODEL_IDS.map((id) => {
			const model = catalog.find((entry) => entry.id === id);
			if (!model) throw new Error(`pi-ai catalog is missing ${id}`);
			const { compat: _compat, ...metadata } = model;
			return { ...metadata, provider: CLAUDE_CODE_PROVIDER, api: "claude-code-cli" as const,
				baseUrl: "claude-code://local", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
		}),
		api: {
			stream: (model, context, options?: StreamOptions) => streamClaude(model, context, options),
			streamSimple: (model, context, options?: SimpleStreamOptions) => streamClaude(model, context, options),
		},
	});
}
