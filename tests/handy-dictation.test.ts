import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { joinDictation } from "../components/dictation.tsx";
import { appendToDictationTarget, claimPrimaryDictationTarget, routeDictationPaste, setComposerDictationTarget } from "../components/dictation-paste.tsx";
import { createHandyController, HANDY_STOP_TRIPWIRE_MS, HANDY_TRIPWIRE_MS } from "../components/handy-control.ts";
import { POST as handyPost } from "../app/api/stt/handy/route.ts";
import { resolveDictationEngine, sanitizeUserSettings } from "../src/core/settings.ts";
import { parseDictationSettingsBody } from "../src/server/settings-body.ts";
import { commandHandy, findHandy, handyStatus, type HandyHost } from "../src/server/handy.ts";

describe("Handy paste routing", () => {
	const dom = parseHTML("<html><body><textarea></textarea><input><input type='search'><input type='checkbox'><div contenteditable='true'><b>text</b></div><button>Mic</button></body></html>");
	(globalThis as { window?: unknown }).window = dom.window;
	(globalThis as { CustomEvent?: unknown }).CustomEvent = dom.window.CustomEvent;
	const { document } = dom;
	const paste = (text: string) => {
		let prevented = false;
		const event = { clipboardData: { getData: (type: string) => type === "text/plain" ? text : "" }, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
		return { event, prevented: () => prevented };
	};
	it("routes plain text from a non-editable focus to the primary target with Deepgram joining", () => {
		let composer = "Draft";
		let answer = "Answer  ";
		setComposerDictationTarget((text) => { composer = joinDictation(composer, text); });
		claimPrimaryDictationTarget((text) => { answer = joinDictation(answer, text); });
		const { event, prevented } = paste("spoken words");
		assert.equal(routeDictationPaste(event, document.querySelector("button")), true);
		assert.equal(answer, "Answer spoken words");
		assert.equal(composer, "Draft");
		assert.equal(prevented(), true);
		claimPrimaryDictationTarget(null);
		assert.equal(appendToDictationTarget("more"), true);
		assert.equal(composer, "Draft more");
		setComposerDictationTarget(null);
	});
	it("keeps native pastes in inputs, textareas and contenteditable descendants", () => {
		let calls = 0;
		let notifications = 0;
		const onPaste = () => { notifications++; };
		window.addEventListener("lh:dictation-paste", onPaste);
		setComposerDictationTarget(() => { calls++; });
		for (const selector of ["input:not([type])", "input[type='search']", "textarea", "b"]) {
			const { event, prevented } = paste("native");
			assert.equal(routeDictationPaste(event, document.querySelector(selector)), false);
			assert.equal(prevented(), false);
		}
		assert.equal(calls, 0);
		assert.equal(notifications, 4);
		setComposerDictationTarget(null);
		window.removeEventListener("lh:dictation-paste", onPaste);
	});
	it("routes pastes when a non-text input has focus and notifies Handy", () => {
		let received = "";
		let notifications = 0;
		const onPaste = () => { notifications++; };
		window.addEventListener("lh:dictation-paste", onPaste);
		setComposerDictationTarget((text) => { received = text; });
		const { event, prevented } = paste("spoken");
		assert.equal(routeDictationPaste(event, document.querySelector("input[type='checkbox']")), true);
		assert.equal(received, "spoken");
		assert.equal(prevented(), true);
		assert.equal(notifications, 1);
		setComposerDictationTarget(null);
		window.removeEventListener("lh:dictation-paste", onPaste);
	});
	it("native and routed text pastes each end an active Handy run", async () => {
		setComposerDictationTarget(() => {});
		const controller = createHandyController(async () => ({ ok: true }), () => {});
		const onPaste = () => controller.onPaste();
		window.addEventListener("lh:dictation-paste", onPaste);
		for (const selector of ["textarea", "button"]) {
			await controller.toggle();
			assert.equal(controller.phase, "recording");
			routeDictationPaste(paste("spoken").event, document.querySelector(selector));
			assert.equal(controller.phase, "idle");
		}
		window.removeEventListener("lh:dictation-paste", onPaste);
		setComposerDictationTarget(null);
	});
	it("does nothing without a target or text/plain", () => {
		const { event, prevented } = paste("orphan");
		assert.equal(routeDictationPaste(event, document.body), false);
		assert.equal(prevented(), false);
		setComposerDictationTarget(() => assert.fail("no text should route"));
		assert.equal(routeDictationPaste(paste("").event, document.body), false);
		setComposerDictationTarget(null);
	});
});

describe("Handy route", () => {
	it("rejects simple cross-origin content types before executing a command", async () => {
		for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""]) {
			const response = await handyPost(new Request("http://test/api/stt/handy", {
				method: "POST", body: JSON.stringify({ command: "toggle" }),
				headers: contentType ? { "content-type": contentType } : {},
			}));
			assert.equal(response.status, 415);
		}
	});
});

describe("Handy setting and host adapter", () => {
	it("resolves explicit choice, key, installation, then keyless Deepgram", () => {
		assert.equal(resolveDictationEngine(undefined, true, true), "deepgram");
		assert.equal(resolveDictationEngine(undefined, false, true), "handy");
		assert.equal(resolveDictationEngine(undefined, false, false), "deepgram");
		assert.equal(resolveDictationEngine({ engine: "handy" }, true, false), "handy");
		assert.equal(resolveDictationEngine({ engine: "deepgram" }, false, true), "deepgram");
		assert.deepEqual(sanitizeUserSettings({ version: 1, dictation: { engine: "handy" } })?.dictation, { engine: "handy" });
		assert.equal(parseDictationSettingsBody({ engine: "wrong" }).ok, false);
	});
	const host = (platform: NodeJS.Platform, dirs: Record<string, string[]>, env: Record<string, string | undefined> = {}): HandyHost => ({
		platform, home: "/home/person", env,
		files: { existsSync: (p: string) => Object.hasOwn(dirs, p) || Object.entries(dirs).some(([dir, entries]) => entries.some((entry) => (platform === "win32" ? path.win32 : path).join(dir, entry) === p)), readdirSync: (p: string) => dirs[p] ?? [] } as unknown as HandyHost["files"],
	});
	it("finds case-insensitive Mac binary, Linux PATH/AppImage and Windows installs", () => {
		const mac = host("darwin", { "/Applications/Handy.app/Contents/MacOS": ["handy"] });
		assert.equal(findHandy(mac), "/Applications/Handy.app/Contents/MacOS/handy");
		assert.equal(findHandy(host("linux", { "/usr/bin": ["Handy"] }, { PATH: "/usr/bin" })), "/usr/bin/Handy");
		assert.equal(findHandy(host("linux", { "/home/person/Applications": ["Handy-0.9.AppImage"] })), "/home/person/Applications/Handy-0.9.AppImage");
		assert.equal(findHandy(host("win32", { "C:\\Users\\person\\AppData\\Local\\Programs\\handy": ["handy.exe"] }, { LOCALAPPDATA: "C:\\Users\\person\\AppData\\Local" })), "C:\\Users\\person\\AppData\\Local\\Programs\\handy\\handy.exe");
	});
	it("checks running state and executes an absolute path with fixed flags", async () => {
		const mac = host("darwin", { "/Applications/Handy.app/Contents/MacOS": ["handy"] });
		const calls: Array<[string, string[]]> = [];
		const exec = async (file: string, args: string[]) => { calls.push([file, args]); return { stdout: "123" }; };
		assert.deepEqual(await handyStatus(mac, exec), { installed: true, running: true, path: "/Applications/Handy.app/Contents/MacOS/handy" });
		assert.deepEqual(await commandHandy("toggle", mac, exec), { ok: true });
		assert.deepEqual(await commandHandy("cancel", mac, exec), { ok: true });
		assert.deepEqual(calls.at(-1), ["/Applications/Handy.app/Contents/MacOS/handy", ["--cancel"]]);
		assert.deepEqual(calls.at(-3), ["/Applications/Handy.app/Contents/MacOS/handy", ["--toggle-transcription"]]);
		assert.deepEqual(await commandHandy("toggle", mac, async () => { throw Error("not running"); }), { ok: false, error: "Open Handy first" });
	});
});

describe("Handy button controller", () => {
	it("click, stop, paste and Esc follow the command state machine", async () => {
		const commands: string[] = [];
		const states: string[] = [];
		const timeouts = new Map<number, { run: () => void; ms: number }>();
		let nextTimer = 0;
		const controller = createHandyController(async (command) => { commands.push(command); return { ok: true }; }, (phase) => states.push(phase), {
			setTimeout: ((fn: () => void, ms: number) => { timeouts.set(++nextTimer, { run: fn, ms }); return nextTimer; }) as typeof setTimeout,
			clearTimeout: ((id: number) => { timeouts.delete(id); }) as typeof clearTimeout,
		});
		await controller.toggle();
		assert.equal(controller.phase, "recording");
		assert.deepEqual([...timeouts.values()].map((timer) => timer.ms), [HANDY_TRIPWIRE_MS]);
		const finished = controller.finish();
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(controller.phase, "stopping");
		assert.deepEqual([...timeouts.values()].map((timer) => timer.ms), [HANDY_STOP_TRIPWIRE_MS]);
		controller.onPaste();
		await finished;
		assert.equal(controller.phase, "idle");
		await controller.toggle();
		controller.cancel();
		assert.equal(controller.phase, "idle");
		assert.deepEqual(commands, ["toggle", "toggle", "toggle", "cancel"]);
		assert.deepEqual(states, ["connecting", "recording", "stopping", "idle", "connecting", "recording", "idle"]);
		assert.equal(timeouts.size, 0);
	});
	it("resolves finish after the stop tripwire without an error", async () => {
		const timeouts = new Map<number, { run: () => void; ms: number }>();
		let nextTimer = 0;
		let error: string | null = null;
		const controller = createHandyController(async () => ({ ok: true }), (_, message) => { error = message; }, {
			setTimeout: ((fn: () => void, ms: number) => { timeouts.set(++nextTimer, { run: fn, ms }); return nextTimer; }) as typeof setTimeout,
			clearTimeout: ((id: number) => { timeouts.delete(id); }) as typeof clearTimeout,
		});
		await controller.toggle();
		const finished = controller.finish();
		await new Promise<void>((resolve) => setImmediate(resolve));
		const [stopTimer] = [...timeouts.values()];
		assert.ok(stopTimer);
		assert.equal(stopTimer.ms, HANDY_STOP_TRIPWIRE_MS);
		stopTimer.run();
		await finished;
		assert.equal(controller.phase, "idle");
		assert.equal(error, null);
		assert.equal(timeouts.size, 0);
	});
	it("a second click while stopping sends cancel and resets", async () => {
		const commands: string[] = [];
		const controller = createHandyController(async (command) => { commands.push(command); return { ok: true }; }, () => {});
		await controller.toggle();
		await controller.toggle();
		assert.equal(controller.phase, "stopping");
		await controller.toggle();
		assert.equal(controller.phase, "idle");
		assert.deepEqual(commands, ["toggle", "toggle", "cancel"]);
	});
	it("resets on a failed command or missing paste tripwire", async () => {
		let fail = true;
		let timeout: (() => void) = () => {};
		let error: string | null = null;
		const controller = createHandyController(async () => fail ? { ok: false, error: "Open Handy first" } : { ok: true }, (_, message) => { error = message; }, {
			setTimeout: ((fn: () => void) => { timeout = fn; return 1; }) as typeof setTimeout,
			clearTimeout: (() => {}) as typeof clearTimeout,
		});
		await controller.toggle();
		assert.equal(error, "Open Handy first");
		fail = false;
		await controller.toggle();
		timeout();
		assert.equal(controller.phase, "idle");
		assert.equal(error, "Handy did not paste");
	});
});
