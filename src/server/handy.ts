/** Handy is controlled through its documented command-line flags. All host
 * effects are injected below so lookup and command behavior can be tested. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

type FileOps = Pick<typeof fs, "existsSync" | "readdirSync">;
export type HandyHost = {
	platform: NodeJS.Platform;
	home: string;
	env: Record<string, string | undefined>;
	files: FileOps;
};

const realHost = (): HandyHost => ({ platform: process.platform, home: os.homedir(), env: process.env, files: fs });

function appBinary(dir: string, files: FileOps): string | null {
	if (!files.existsSync(dir)) return null;
	try {
		const name = files.readdirSync(dir).find((entry) => String(entry).toLowerCase() === "handy");
		return name ? path.join(dir, String(name)) : null;
	} catch {
		return null;
	}
}

export function findHandy(host: HandyHost = realHost()): string | null {
	const { platform, home, env, files } = host;
	if (platform === "darwin") {
		for (const base of ["/Applications", path.join(home, "Applications")]) {
			const found = appBinary(path.join(base, "Handy.app", "Contents", "MacOS"), files);
			if (found) return found;
		}
	}
	if (platform === "win32") {
		for (const base of [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs", "handy"), env.ProgramFiles, env["ProgramFiles(x86)"]]) {
			if (!base) continue;
			for (const candidate of [path.win32.join(base, "handy.exe"), path.win32.join(base, "Handy", "handy.exe")]) {
				if (files.existsSync(candidate)) return candidate;
			}
		}
	}
	if (platform === "linux") {
		for (const dir of (env.PATH ?? "").split(path.delimiter)) {
			if (!dir) continue;
			const found = appBinary(dir, files);
			if (found) return found;
		}
		for (const dir of [path.join(home, "Applications"), path.join(home, ".local", "bin"), path.join(home, "Downloads")]) {
			if (!files.existsSync(dir)) continue;
			try {
				const name = files.readdirSync(dir).find((entry) => /^handy.*\.appimage$/i.test(String(entry)));
				if (name) return path.join(dir, String(name));
			} catch {}
		}
	}
	return null;
}

export type HandyExec = (file: string, args: string[]) => Promise<{ stdout: string }>;
const realExec: HandyExec = async (file, args) => promisify(nodeExecFile)(file, args, { timeout: 10_000, windowsHide: true });

export async function handyStatus(host: HandyHost = realHost(), exec: HandyExec = realExec) {
	const binary = findHandy(host);
	if (!binary) return { installed: false, running: false, path: null };
	try {
		if (host.platform === "win32") {
			const result = await exec("tasklist", ["/FI", "IMAGENAME eq handy.exe", "/FO", "CSV", "/NH"]);
			return { installed: true, running: /"handy\.exe"/i.test(result.stdout), path: binary };
		}
		await exec("pgrep", ["-ix", "handy"]);
		return { installed: true, running: true, path: binary };
	} catch {
		return { installed: true, running: false, path: binary };
	}
}

export async function commandHandy(command: "toggle" | "cancel", host: HandyHost = realHost(), exec: HandyExec = realExec) {
	const status = await handyStatus(host, exec);
	if (!status.installed || !status.path) return { ok: false, error: "Handy is not installed" } as const;
	if (!status.running) return { ok: false, error: "Open Handy first" } as const;
	try {
		await exec(status.path, [command === "toggle" ? "--toggle-transcription" : "--cancel"]);
		return { ok: true } as const;
	} catch {
		return { ok: false, error: "Handy command failed" } as const;
	}
}
