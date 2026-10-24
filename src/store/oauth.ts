import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { AUTH_FILE } from "../../config.ts";

export const OAUTH_FILE = path.join(path.dirname(AUTH_FILE), "oauth.json");

interface OAuthData {
	deviceId?: string;
	credentials: Record<string, Credential>;
}

function readData(): OAuthData {
	try {
		const data = JSON.parse(fs.readFileSync(OAUTH_FILE, "utf8"));
		if (data && typeof data === "object" && !Array.isArray(data)) {
			return {
				deviceId: typeof data.deviceId === "string" ? data.deviceId : undefined,
				credentials: data.credentials && typeof data.credentials === "object" && !Array.isArray(data.credentials)
					? data.credentials : {},
			};
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return { credentials: {} };
}

function writeData(data: OAuthData): void {
	const dir = path.dirname(OAUTH_FILE);
	fs.mkdirSync(dir, { recursive: true });
	const temp = path.join(dir, `.oauth.json.tmp-${process.pid}-${randomUUID()}`);
	try {
		fs.writeFileSync(temp, `${JSON.stringify(data, null, "\t")}\n`, { mode: 0o600 });
		fs.chmodSync(temp, 0o600);
		fs.renameSync(temp, OAUTH_FILE);
	} finally {
		try { fs.unlinkSync(temp); } catch { /* renamed or failed before creation */ }
	}
}

// The file is one JSON object, so writes for different providers must also
// queue behind each other or a refresh could overwrite another login.
let pending: Promise<void> = Promise.resolve();
async function locked<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	const previous = pending;
	let release!: () => void;
	const next = new Promise<void>((resolve) => { release = resolve; });
	pending = previous.then(() => next);
	try {
		await previous;
		signal?.throwIfAborted();
		return await work();
	} finally {
		release();
	}
}

/** The only writer of oauth.json. Pi refreshes through the whole-file lock. */
export const oauthStore: CredentialStore = {
	async read(providerId, options) {
		options?.signal?.throwIfAborted();
		return readData().credentials[providerId];
	},
	async list(options) {
		options?.signal?.throwIfAborted();
		return Object.entries(readData().credentials).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	},
	modify(providerId, fn, options) {
		return locked(async () => {
			const data = readData();
			const updated = await fn(data.credentials[providerId]);
			if (updated !== undefined) {
				const latest = readData();
				latest.credentials[providerId] = updated;
				writeData(latest);
			}
			return updated ?? data.credentials[providerId];
		}, options?.signal);
	},
	delete(providerId, options) {
		return locked(async () => {
			const data = readData();
			if (!(providerId in data.credentials)) return;
			delete data.credentials[providerId];
			writeData(data);
		}, options?.signal);
	},
};

export function hasOAuthCredential(providerId: string): boolean {
	return readData().credentials[providerId]?.type === "oauth";
}

export function oauthDeviceId(): string {
	const data = readData();
	if (data.deviceId) return data.deviceId;
	data.deviceId = randomUUID();
	writeData(data);
	return data.deviceId;
}
