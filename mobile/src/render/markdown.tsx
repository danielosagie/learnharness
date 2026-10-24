import React, { memo, useMemo } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { marked, type Token, type Tokens } from "marked";
import { markdownBlocks, segmentMath } from "./pipeline";
import { mathDimensions, mathSvg } from "./math";
import { Formula } from "../platform/formula";
import { Label } from "../ui/atoms";
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
const MathSvg = memo(function MathSvg({ formula, display, size }: { formula: string; display: boolean; size: number }) {
	const svg = useMemo(() => mathSvg(formula, display), [formula, display]);
	return <Formula svg={svg} {...mathDimensions(svg, size)} />;
});
function Inline({ source, size, serif = false, lineHeight }: { source: Run[]; size: number; serif?: boolean; lineHeight: number }) {
	return <Text style={{ color: C.text, fontFamily: serif ? font.serif : font.prose, fontSize: size, lineHeight }}>{source.flatMap((run, ri) => segmentMath(run.text).map((part, pi) => {
		if (part.kind === "pending") return null;
		if (part.kind === "math") return <MathSvg key={`${ri}-${pi}`} formula={part.value} display={false} size={size * 1.05} />;
		return <Text key={`${ri}-${pi}`} onPress={run.href ? () => void Linking.openURL(run.href!) : undefined} style={{ fontFamily: run.mono ? font.mono : run.bold ? font.proseBold : serif ? font.serif : font.prose, fontStyle: run.italic ? "italic" : "normal", textDecorationLine: run.href ? "underline" : "none", fontSize: run.mono ? size - 3 : size }}>{part.value}</Text>;
	}))}</Text>;
}
const Block = memo(function Block({ block, size, serif, lineHeight, displaySize }: { block: Token; size: number; serif: boolean; lineHeight: number; displaySize: number }) {
	if (block.type === "space") return null;
	if (block.type === "heading") return <Text style={{ color: C.text, fontFamily: font.serif, fontSize: block.depth === 1 ? 30 : 23, marginTop: 12 }}>{block.text}</Text>;
	if (block.type === "paragraph") {
		const segments = segmentMath(block.text);
		if (segments.some((part) => part.display)) return <View style={{ gap: 18 }}>{segments.map((part, i) => part.kind === "pending" ? null : part.kind === "math" ? <View key={i} style={{ alignItems: "center", justifyContent: "center", minHeight: displaySize === 30 ? undefined : 42, paddingTop: displaySize === 30 ? 18 : 6, paddingBottom: displaySize === 30 ? 8 : 6 }}><MathSvg formula={part.value} display size={displaySize} /></View> : part.value.trim() ? <Inline key={i} source={runs(marked.Lexer.lexInline(part.value))} size={size} serif={serif} lineHeight={lineHeight} /> : null)}</View>;
		return <Inline source={runs(block.tokens ?? [])} size={size} serif={serif} lineHeight={lineHeight} />;
	}
	if (block.type === "code") return <ScrollView horizontal style={{ backgroundColor: C.raised, borderRadius: 10, padding: 12 }}><Text style={{ color: C.text, fontFamily: font.mono, fontSize: 13 }}>{block.text}</Text></ScrollView>;
	if (block.type === "blockquote") return <View style={{ borderLeftWidth: 2, borderColor: C.line, paddingLeft: 16 }}><Markdown text={block.text} /></View>;
	if (block.type === "list") return <View style={{ gap: 6 }}>{block.items.map((item: { text: string }, n: number) => <View key={n} style={{ flexDirection: "row", gap: 10 }}><Text style={{ color: C.muted, lineHeight }}>{block.ordered ? `${n + 1}.` : "•"}</Text><View style={{ flex: 1 }}><Markdown text={item.text} size={size} /></View></View>)}</View>;
	if (block.type === "table") return <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 6, overflow: "hidden" }}>{[block.header, ...block.rows].map((row: { text: string; tokens?: Token[] }[], ri: number) => <View key={ri} style={{ flexDirection: "row", paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: ri ? 1 : 0, borderColor: ri === 1 ? C.line : C.hairline }}>{row.map((cell, ci) => <View key={ci} style={{ flex: ci >= 2 ? 1 : undefined, width: ci < 2 ? 96 : undefined }}>{ri ? <Inline source={runs(cell.tokens ?? marked.Lexer.lexInline(cell.text))} size={19} serif lineHeight={24} /> : <Label>{cell.text}</Label>}</View>)}</View>)}</View>;
	if (block.type === "hr") return <View style={{ height: 1, backgroundColor: C.hairline }} />;
	return <Inline source={[{ text: block.raw }]} size={size} serif={serif} lineHeight={lineHeight} />;
}, (previous, next) => previous.block.raw === next.block.raw && previous.size === next.size && previous.serif === next.serif && previous.lineHeight === next.lineHeight && previous.displaySize === next.displaySize);
export function Markdown({ text, size = 17, serif = false, lineHeight = 26, displaySize = 22 }: { text: string; size?: number; serif?: boolean; lineHeight?: number; displaySize?: number }) {
	const blocks = useMemo(() => markdownBlocks(text).filter((block) => block.type !== "space"), [text]);
	return <View style={{ gap: 18 }}>{blocks.map((block, i) => <Block key={i} block={block} size={size} serif={serif} lineHeight={lineHeight} displaySize={displaySize} />)}</View>;
}
