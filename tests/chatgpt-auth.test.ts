import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { Models } from "@earendil-works/pi-ai";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chatgpt-auth-"));
process.env.LH_AUTH_FILE = path.join(dir, "auth.json");
delete process.env.OPENAI_API_KEY;

const { OAUTH_FILE, oauthStore, hasOAuthCredential, oauthDeviceId } = await import("../src/store/oauth.ts");
const { providerKeyPresent, keyStatuses } = await import("../src/server/keys.ts");
const { startChatGPTLogin, chatGPTStatus, logoutChatGPT } = await import("../src/server/chatgpt-auth.ts");
const { hasProviderKey } = await import("../components/setup-cta.tsx");
const { keyStatusLine } = await import("../components/settings/keys-section.tsx");
const { setupStage } = await import("../components/setup-dialog.tsx");
const { callCost, turnCost, jobCost } = await import("../src/core/prices.ts");
const { graphCostSummary } = await import("../src/core/cost-summary.ts");
const { persistTurn } = await import("../src/server/turn-service.ts");
const { piModels, piEngineForSpec } = await import("../src/agent/models.ts");
const { modelCatalog } = await import("../src/server/model-catalog.ts");
const startRoute = await import("../app/api/auth/chatgpt/start/route.ts");
const statusRoute = await import("../app/api/auth/chatgpt/status/route.ts");
const cancelRoute = await import("../app/api/auth/chatgpt/cancel/route.ts");
const submitRoute = await import("../app/api/auth/chatgpt/submit/route.ts");
const logoutRoute = await import("../app/api/auth/chatgpt/logout/route.ts");

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const credential = { type: "oauth" as const, access: "fake-access", refresh: "fake-refresh", expires: Date.now() + 3600_000 };

describe("OAuth credential adapter", () => {
	it("round-trips, deletes, and keeps the file private after rewrites", async () => {
		assert.equal(await oauthStore.read("openai"), undefined);
		await oauthStore.modify("openai", async () => credential);
		assert.deepEqual(await oauthStore.read("openai"), credential);
		assert.deepEqual(await oauthStore.list(), [{ providerId: "openai", type: "oauth" }]);
		assert.equal(fs.statSync(OAUTH_FILE).mode & 0o777, 0o600);
		assert.equal(oauthDeviceId(), oauthDeviceId());
		assert.equal(fs.statSync(OAUTH_FILE).mode & 0o777, 0o600);
		assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes(".tmp-")), []);
		await oauthStore.delete("openai");
		assert.equal(await oauthStore.read("openai"), undefined);
	});

	it("serializes modify and delete per provider", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const seen: string[] = [];
		const first = oauthStore.modify("openai", async (current) => {
			assert.equal(current, undefined);
			seen.push("first-start");
			await gate;
			seen.push("first-end");
			return credential;
		});
		const second = oauthStore.modify("openai", async (current) => {
			assert.deepEqual(current, credential);
			seen.push("second");
			return { ...credential, access: "renewed" };
		});
		await Promise.resolve();
		assert.deepEqual(seen, ["first-start"]);
		release();
		await Promise.all([first, second]);
		assert.deepEqual(seen, ["first-start", "first-end", "second"]);
		assert.equal((await oauthStore.read("openai"))?.type, "oauth");
		await oauthStore.delete("openai");
	});
});

describe("ChatGPT login", () => {
	it("starts once, waits, accepts a manual callback, and unlocks setup", async () => {
		let calls = 0;
		const models = {
			login: async (_provider: string, _type: string, interaction: Parameters<Models["login"]>[2]) => {
				calls++;
				interaction.notify({ type: "auth_url", url: "https://auth.openai.com/fake" });
				const pasted = await interaction.prompt({ type: "manual_code", message: "Callback" });
				assert.equal(pasted, "http://127.0.0.1:1455/auth/callback?code=fake");
				await oauthStore.modify("openai", async () => credential);
				return credential;
			},
		} as Pick<Models, "login">;
		assert.deepEqual(await startChatGPTLogin(models), { url: "https://auth.openai.com/fake" });
		assert.deepEqual(await (await startRoute.POST()).json(), { url: "https://auth.openai.com/fake" });
		assert.equal(calls, 1);
		assert.deepEqual(chatGPTStatus(), { state: "waiting" });
		assert.deepEqual(await (await statusRoute.GET()).json(), { state: "waiting" });
		assert.equal((await submitRoute.POST(new Request("http://localhost/api/auth/chatgpt/submit", { method: "POST", body: JSON.stringify({ url: "http://127.0.0.1:1455/auth/callback?code=fake" }) }))).status, 200);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(chatGPTStatus(), { state: "signed_in" });
		assert.equal(hasOAuthCredential("openai"), true);
		assert.equal(providerKeyPresent("openai"), true);
		for (const id of ["gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra"]) {
			assert.ok(modelCatalog().models.some((model) => model.provider === "openai" && model.id === id), `${id} is available without an API key`);
		}
		process.env.OPENAI_API_KEY = "fake-api-key";
		assert.equal((await piModels().getAuth("openai"))?.auth.apiKey, credential.access, "stored OAuth wins over ambient API key");
		assert.equal(piEngineForSpec({ provider: "openai", id: "gpt-6-sol" }).subscription, true);
		delete process.env.OPENAI_API_KEY;
		assert.equal(keyStatuses().find((row) => row.id === "OPENAI_API_KEY")?.subscription, "chatgpt");
		assert.equal(keyStatusLine(keyStatuses().find((row) => row.id === "OPENAI_API_KEY")!), "ChatGPT subscription");
		assert.equal(hasProviderKey(keyStatuses(), [{ id: "openai", envVar: "OPENAI_API_KEY", label: "OpenAI" }]), true);
		assert.equal(setupStage([{ id: "openai", keyPresent: providerKeyPresent("openai") }]), "pickers");
		await logoutChatGPT({ logout: async () => oauthStore.delete("openai") } as Pick<Models, "logout">);
		assert.deepEqual(chatGPTStatus(), { state: "idle" });
		assert.equal(piEngineForSpec({ provider: "openai", id: "gpt-6-sol" }).subscription, false);
		assert.deepEqual(await (await logoutRoute.POST()).json(), { state: "idle" });
	});

	it("cancel aborts the in-flight login and restores idle", async () => {
		const models = { login: async (_provider: string, _type: string, interaction: Parameters<Models["login"]>[2]) => {
			interaction.notify({ type: "auth_url", url: "https://auth.openai.com/fake" });
			await new Promise<never>((_, reject) => interaction.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
			return credential;
		} } as Pick<Models, "login">;
		await startChatGPTLogin(models);
		assert.deepEqual(chatGPTStatus(), { state: "waiting" });
		assert.deepEqual(await (await cancelRoute.POST()).json(), { state: "idle" });
		assert.deepEqual(chatGPTStatus(), { state: "idle" });
	});

	it("reports a short error after failed login", async () => {
		const models = { login: async () => { throw new Error("fake secret error"); } } as unknown as Pick<Models, "login">;
		await assert.rejects(startChatGPTLogin(models));
		assert.deepEqual(chatGPTStatus(), { state: "error", message: "Sign-in failed. Try again." });
		assert.deepEqual(await (await statusRoute.GET()).json(), { state: "error", message: "Sign-in failed. Try again." });
	});
});

describe("subscription accounting", () => {
	it("retains token counts and reports zero dollars on captured subscription calls", () => {
		const step = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, billing: "subscription" as const };
		assert.equal(callCost(step, "openai:gpt-6-sol"), 0);
		assert.equal(turnCost({ id: "t", messageId: "m", at: "", model: "openai:gpt-6-sol", steps: [step] }), 0);
		assert.equal(jobCost({ usage: { model: "openai:gpt-6-sol", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, steps: 1, billing: "subscription" } }), 0);
		const graph = graphCostSummary({ chats: [{ title: "Example", extractions: [{ startedAt: 1, at: "", durationMs: 1, stages: { extractor: { model: "openai:gpt-6-sol", steps: [step] }, auditor: { model: "openai:gpt-6-sol", steps: [step] } } }] }], sources: [] });
		assert.equal(graph.totalDollars, 0);
		assert.equal(graph.stages.extraction.tokens.inputTokens, 1000);
		assert.equal(step.inputTokens, 1000);
		assert.ok((callCost({ ...step, billing: undefined }, "openai:gpt-6-sol") ?? 0) > 0);
	});

	it("stores zero native pi cost while preserving tokens and the original message", () => {
		const message = {
			id: "native", role: "assistant", content: [{ type: "text", text: "ok" }],
			api: "openai-responses", provider: "openai", model: "gpt-6-sol", stopReason: "stop", timestamp: 1,
			usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 1500,
				cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } },
		};
		let saved: unknown[] = [];
		const store = {
			getChat: () => ({ id: "chat", title: "Test", createdAt: "", updatedAt: "", messages: [] }),
			saveMessages: (_id: string, messages: unknown[]) => { saved = messages; },
		} as unknown as Parameters<typeof persistTurn>[0];
		const stamped = persistTurn(store, "chat", 0, [message as never], false, "subscription");
		assert.equal((stamped[0] as typeof message).usage.cost.total, 0);
		assert.equal((stamped[0] as typeof message).usage.input, 1000);
		assert.equal((saved[0] as typeof message).usage.cost.total, 0);
		assert.equal(message.usage.cost.total, 2);
	});
});
