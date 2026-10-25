/** Tailscale's edge configuration is separate from the paired HTTP door. */
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export type FunnelStatus =
	| { state: "no-tailscale" }
	| { state: "needs-approval"; approveUrl: string }
	| { state: "listening"; address: string; mode: "public" }
	| { state: "error"; message: string };
export type CliRunner = (file: string, args: string[], timeout: number) => Promise<string>;
export class CliFailure extends Error {
	constructor(public readonly code: "timeout" | "failed") { super(code); }
}
export const runPhoneCli: CliRunner = (file, args, timeout) => new Promise((resolve, reject) => {
	execFile(file, args, { timeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
		if (error) reject(new CliFailure(error.killed ? "timeout" : "failed"));
		else resolve(stdout);
	});
});
export async function findPhoneCli(): Promise<string | undefined> {
	const candidates = [
		...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, process.platform === "win32" ? "tailscale.exe" : "tailscale")),
		"/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe",
	];
	for (const file of candidates) {
		try { await access(file, constants.X_OK); return file; } catch { /* Try the next installation. */ }
	}
}
const TARGET = "http://127.0.0.1:4791";
type Config = {
	TCP?: Record<string, { HTTPS?: boolean }>;
	Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
	AllowFunnel?: Record<string, boolean>;
	Foreground?: Record<string, Config>;
};
function configJson(raw: string): Config {
	const value = JSON.parse(raw);
	if (value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) throw new CliFailure("failed");
	return value;
}
/** Claim the whole 8443 mapping only when it contains exactly our root proxy.
 *  Foreground listeners and extra mounts belong to someone else. */
function mapping(config: Config, host?: string): "empty" | "ours" | string {
	for (const foreground of Object.values(config.Foreground ?? {})) {
		if (mapping(foreground) !== "empty") return "a foreground Tailscale service";
	}
	const entries = Object.entries(config.Web ?? {}).filter(([key]) => key.endsWith(":8443"));
	if (!entries.length && !config.TCP?.["8443"] && !Object.keys(config.AllowFunnel ?? {}).some((key) => key.endsWith(":8443"))) return "empty";
	if (entries.length === 1) {
		const [key, web] = entries[0]!;
		const handlers = Object.entries(web.Handlers ?? {});
		const foreignFunnel = Object.keys(config.AllowFunnel ?? {}).some((funnelKey) => funnelKey.endsWith(":8443") && funnelKey !== key);
		if (!foreignFunnel && (!host || key === `${host}:8443`) && config.TCP?.["8443"]?.HTTPS === true && Object.keys(config.TCP["8443"]).length === 1 && handlers.length === 1 && handlers[0]![0] === "/" && handlers[0]![1].Proxy === TARGET && Object.keys(handlers[0]![1]).length === 1) return "ours";
		const proxy = handlers.find(([, handler]) => handler.Proxy)?.[1].Proxy;
		if (proxy) {
			try { const url = new URL(proxy); return `${url.protocol}//${url.host}${url.pathname}`; } catch { /* Never display untrusted CLI output. */ }
		}
	}
	return "another Tailscale service";
}
export class PhoneFunnel {
	constructor(private readonly run: CliRunner = runPhoneCli, private readonly find = findPhoneCli) {}
	async enable(): Promise<FunnelStatus> {
		const file = await this.find();
		if (!file) return { state: "no-tailscale" };
		let approveUrl: string | undefined;
		try {
			const info = JSON.parse(await this.run(file, ["status", "--json"], 3500));
			if (info.BackendState !== "Running") return { state: "no-tailscale" };
			const id = info.Self?.ID;
			if (typeof id !== "string" || !id) throw new CliFailure("failed");
			approveUrl = `https://login.tailscale.com/f/funnel?node=${encodeURIComponent(id)}`;
			const caps = info.Self?.CapMap ?? info.CapMap ?? {};
			if (!("funnel" in caps) || !("https" in caps)) return { state: "needs-approval", approveUrl };
			const host = String(info.Self?.DNSName ?? "").replace(/\.$/, "");
			if (!/^[a-z0-9.-]+\.ts\.net$/i.test(host)) throw new CliFailure("failed");
			const config = configJson(await this.run(file, ["serve", "status", "--json"], 3500));
			const owner = mapping(config, host);
			if (owner !== "empty" && owner !== "ours") return { state: "error", message: `Tailscale port 8443 is used by ${owner}` };
			if (owner !== "ours" || config.AllowFunnel?.[`${host}:8443`] !== true) {
				await this.run(file, ["funnel", "--bg", "--https=8443", TARGET], 10_000);
				const confirmed = configJson(await this.run(file, ["serve", "status", "--json"], 3500));
				if (mapping(confirmed, host) !== "ours" || confirmed.AllowFunnel?.[`${host}:8443`] !== true) throw new CliFailure("failed");
			}
			return { state: "listening", address: `https://${host}:8443`, mode: "public" };
		} catch (error) {
			const code = error instanceof CliFailure ? error.code : "invalid-response";
			console.warn(`[phone] tailscale-${code}`);
			if (code === "timeout") return approveUrl ? { state: "needs-approval", approveUrl } : { state: "no-tailscale" };
			return { state: "error", message: "Tailscale phone setup failed. Check Tailscale and try again." };
		}
	}
	async disable(): Promise<void> {
		const file = await this.find();
		if (!file) return;
		const config = configJson(await this.run(file, ["serve", "status", "--json"], 3500));
		if (mapping(config) === "ours") await this.run(file, ["funnel", "--https=8443", "off"], 10_000);
	}
}
