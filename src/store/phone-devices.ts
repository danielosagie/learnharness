/** The sole writer of phone-devices.json. Tokens never leave this adapter. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";

export interface PhoneDevice {
	id: string;
	name: string;
	tokenHash: string;
	createdAt: string;
	lastSeenAt: string;
}

const FILE = path.join(PATHS.data, "phone-devices.json");
let pending: Promise<void> = Promise.resolve();

function read(): PhoneDevice[] {
	try {
		const value: unknown = JSON.parse(fs.readFileSync(FILE, "utf8"));
		return Array.isArray(value) ? value.filter((item): item is PhoneDevice =>
			item !== null && typeof item === "object" &&
			typeof item.id === "string" && typeof item.name === "string" &&
			typeof item.tokenHash === "string" && typeof item.createdAt === "string" &&
			typeof item.lastSeenAt === "string") : [];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function write(devices: PhoneDevice[]): void {
	fs.mkdirSync(path.dirname(FILE), { recursive: true });
	const temp = `${FILE}.tmp-${process.pid}-${randomUUID()}`;
	try {
		fs.writeFileSync(temp, `${JSON.stringify(devices, null, "\t")}\n`, { mode: 0o600 });
		fs.chmodSync(temp, 0o600);
		fs.renameSync(temp, FILE);
	} finally {
		try { fs.unlinkSync(temp); } catch { /* rename completed */ }
	}
}

function locked<T>(work: () => T | Promise<T>): Promise<T> {
	const previous = pending;
	let release!: () => void;
	pending = new Promise<void>((resolve) => { release = resolve; });
	return previous.then(work).finally(release);
}

export const phoneDevices = {
	list: read,
	add(device: PhoneDevice) { return locked(() => { const devices = read(); devices.push(device); write(devices); }); },
	remove(id: string) { return locked(() => {
		const devices = read();
		const next = devices.filter((item) => item.id !== id);
		if (next.length === devices.length) return false;
		write(next);
		return true;
	}); },
	seen(id: string, at: string) { return locked(() => {
		const devices = read();
		const device = devices.find((item) => item.id === id);
		if (!device || Date.parse(at) - Date.parse(device.lastSeenAt) < 60_000) return false;
		device.lastSeenAt = at;
		write(devices);
		return true;
	}); },
};
