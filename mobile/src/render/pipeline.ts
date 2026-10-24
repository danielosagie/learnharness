import { marked, type Token } from "marked";
import { transformMathDelimiters, repairMathForDisplay } from "../../../src/core/math-delims.ts";

export type Segment = { kind: "text" | "math" | "pending"; value: string; display?: boolean };
/** A partial math delimiter remains hidden until a closing delimiter arrives. */
export function segmentMath(raw: string): Segment[] {
	const source = transformMathDelimiters(repairMathForDisplay(raw));
	const out: Segment[] = [];
	let cursor = 0;
	while (cursor < source.length) {
		const start = source.indexOf("$", cursor);
		if (start < 0) { out.push({ kind: "text", value: source.slice(cursor) }); break; }
		if (start > cursor) out.push({ kind: "text", value: source.slice(cursor, start) });
		const display = source[start + 1] === "$";
		const delimiter = display ? "$$" : "$";
		let end = start + delimiter.length;
		while (end < source.length) {
			const candidate = source.indexOf(delimiter, end);
			if (candidate < 0) { end = -1; break; }
			if (source[candidate - 1] !== "\\") { end = candidate; break; }
			end = candidate + delimiter.length;
		}
		if (end < 0 || end >= source.length) { out.push({ kind: "pending", value: "" }); break; }
		out.push({ kind: "math", value: source.slice(start + delimiter.length, end), display });
		cursor = end + delimiter.length;
	}
	return out;
}
export function markdownBlocks(text: string): Token[] { return marked.lexer(text); }
