import React, { useMemo } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import type { Token, Tokens } from "marked";
import { markdownBlocks, segmentMath } from "./pipeline";
import { mathSvg } from "./math";
import { C, font } from "../ui/theme";

type Run = { text: string; bold?: boolean; italic?: boolean; mono?: boolean; href?: string };
function runs(tokens: Token[], style: Partial<Run> = {}): Run[] {
	const out: Run[] = [];
	for (const token of tokens) {
		if (token.type === "strong") out.push(...runs((token as Tokens.Strong).tokens ?? [], { ...style, bold: true }));
		else if (token.type === "em") out.push(...runs((token as Tokens.Em).tokens ?? [], { ...style, italic: true }));
		else if (token.type === "link") out.push(...runs((token as Tokens.Link).tokens ?? [], { ...style, href: (token as Tokens.Link).href }));
		else if (token.type === "codespan") out.push({ text: (token as Tokens.Codespan).text, ...style, mono: true });
		else out.push({ text: "text" in token ? String(token.text) : token.raw, ...style });
	}
	return out;
}
function MathSvg({ formula, display }: { formula: string; display: boolean }) {
	const svg = useMemo(() => mathSvg(formula, display), [formula, display]);
	const widthEx = Number(/\bwidth="([\d.]+)ex"/.exec(svg)?.[1] ?? 8);
	const heightEx = Number(/\bheight="([\d.]+)ex"/.exec(svg)?.[1] ?? 3);
	const width = Math.min(display ? 340 : 270, Math.max(12, widthEx * 11));
	const height = Math.max(16, heightEx * 11 * (width / Math.max(12, widthEx * 11)));
	return <SvgXml xml={svg} width={width} height={height} />;
}
function Inline({ source, size = 17 }: { source: Run[]; size?: number }) {
	return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>{source.flatMap((run, ri) => segmentMath(run.text).map((part, pi) => {
		if (part.kind === "pending") return null;
		if (part.kind === "math") return <View key={`${ri}-${pi}`} style={{ width: part.display ? "100%" : undefined, alignItems: part.display ? "center" : undefined, marginVertical: part.display ? 12 : 0 }}><MathSvg formula={part.value} display={!!part.display} /></View>;
		return <Text key={`${ri}-${pi}`} onPress={run.href ? () => void Linking.openURL(run.href!) : undefined} style={{ color: C.text, fontFamily: run.mono ? font.mono : run.bold ? font.proseBold : font.prose, fontStyle: run.italic ? "italic" : "normal", textDecorationLine: run.href ? "underline" : "none", fontSize: run.mono ? size - 3 : size, lineHeight: size * 1.53 }}>{part.value}</Text>;
	}))}</View>;
}
export function Markdown({ text }: { text: string }) {
	const blocks = useMemo(() => markdownBlocks(text), [text]);
	return <View style={{ gap: 16 }}>{blocks.map((block, i) => {
		if (block.type === "space") return null;
		if (block.type === "heading") return <Text key={i} style={{ color: C.text, fontFamily: font.serif, fontSize: block.depth === 1 ? 30 : 23, marginTop: 12 }}>{block.text}</Text>;
		if (block.type === "paragraph") return <Inline key={i} source={runs(block.tokens ?? [])} />;
		if (block.type === "code") return <ScrollView key={i} horizontal style={{ backgroundColor: C.raised, borderRadius: 10, padding: 12 }}><Text style={{ color: C.text, fontFamily: font.mono, fontSize: 13 }}>{block.text}</Text></ScrollView>;
		if (block.type === "blockquote") return <View key={i} style={{ borderLeftWidth: 2, borderColor: C.line, paddingLeft: 16 }}><Markdown text={block.text} /></View>;
		if (block.type === "list") return <View key={i} style={{ gap: 6 }}>{block.items.map((item: { text: string }, n: number) => <View key={n} style={{ flexDirection: "row", gap: 10 }}><Text style={{ color: C.muted }}>{block.ordered ? `${n + 1}.` : "•"}</Text><View style={{ flex: 1 }}><Markdown text={item.text} /></View></View>)}</View>;
		if (block.type === "table") return <View key={i} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 6 }}>{[block.header, ...block.rows].map((row: { text: string }[], ri: number) => <View key={ri} style={{ flexDirection: "row", borderTopWidth: ri ? 1 : 0, borderColor: C.hairline }}>{row.map((cell: { text: string }, ci: number) => <View key={ci} style={{ flex: 1, padding: 8 }}><Inline source={[{ text: cell.text }]} size={ri ? 16 : 12} /></View>)}</View>)}</View>;
		return <Inline key={i} source={[{ text: block.raw }]} />;
	})}</View>;
}
