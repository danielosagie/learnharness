import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document("", { InputJax: new TeX({ packages: ["base", "ams", "newcommand"] }), OutputJax: new SVG({ fontCache: "none" }) });
const cache = new Map<string, string>();
export function mathSvg(formula: string, display = false): string {
	const key = `${display ? "D" : "I"}:${formula}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const markup = adaptor.outerHTML(document.convert(formula, { display }));
	const svg = (/<svg\b[\s\S]*?<\/svg>/.exec(markup)?.[0] ?? markup)
		.replace(/\sstyle="vertical-align:[^"]*"/, "")
		.replaceAll("currentColor", "#E6E6E6")
		.replace(/\sdata-[\w-]+="[^"]*"/g, "");
	cache.set(key, svg);
	return svg;
}
export function mathCacheSize(): number { return cache.size; }

/** MathJax uses ex units. Its TeX x-height is 0.442 em; retain the viewBox
 *  descent so inline fractions and powers share the prose baseline. */
export function mathDimensions(svg: string, size: number, maxWidth = 340) {
	const widthEx = Number(/\bwidth="([\d.]+)ex"/.exec(svg)?.[1] ?? 8);
	const heightEx = Number(/\bheight="([\d.]+)ex"/.exec(svg)?.[1] ?? 3);
	const scale = Math.min(size * 0.442, maxWidth / widthEx);
	const box = /viewBox="([^"]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number) ?? [0, 0, 1, 1];
	const height = heightEx * scale;
	return { width: widthEx * scale, height, descent: Math.max(0, (box[1]! + box[3]!) / box[3]! * height) };
}
