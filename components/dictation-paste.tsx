"use client";

import { useEffect } from "react";

let composerTarget: ((text: string) => void) | null = null;
let primaryTarget: ((text: string) => void) | null = null;

export function setComposerDictationTarget(target: ((text: string) => void) | null) {
	composerTarget = target;
}

export function releaseComposerDictationTarget(target: (text: string) => void) {
	if (composerTarget === target) composerTarget = null;
}

export function claimPrimaryDictationTarget(target: ((text: string) => void) | null) {
	primaryTarget = target;
}

export function releasePrimaryDictationTarget(target: (text: string) => void) {
	if (primaryTarget === target) primaryTarget = null;
}

export function appendToDictationTarget(text: string): boolean {
	const target = primaryTarget ?? composerTarget;
	if (!target) return false;
	target(text);
	return true;
}

function editable(element: Element | null): boolean {
	for (let node = element; node; node = node.parentElement) {
		if (node.matches("input, textarea")) return true;
		if (node.hasAttribute("contenteditable")) return node.getAttribute("contenteditable") !== "false";
	}
	return false;
}

/** Returns whether the paste was routed, for the browser listener and tests. */
export function routeDictationPaste(event: ClipboardEvent, active: Element | null, append = appendToDictationTarget): boolean {
	if (editable(active)) return false;
	const text = event.clipboardData?.getData("text/plain");
	if (!text || !append(text)) return false;
	event.preventDefault();
	window.dispatchEvent(new CustomEvent("lh:dictation-paste"));
	return true;
}

/** Mounted once in AppShell: Handy's own hotkey lands on body under the
 * arrows-always focus rule, while a focused editor keeps its native paste. */
export function DictationPasteRouter() {
	useEffect(() => {
		const onPaste = (event: ClipboardEvent) => routeDictationPaste(event, document.activeElement);
		document.addEventListener("paste", onPaste);
		return () => document.removeEventListener("paste", onPaste);
	}, []);
	return null;
}
