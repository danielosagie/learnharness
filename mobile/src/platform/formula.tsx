import React from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
export function Formula({ svg, width, height, descent }: { svg: string; width: number; height: number; descent: number }) {
	// An inline native view sits on the text baseline at its bottom edge.
	return <View style={{ width, height, transform: [{ translateY: descent }] }}><SvgXml xml={svg} width={width} height={height} /></View>;
}
