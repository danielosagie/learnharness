import React from "react";
export function Formula({ svg, width, height, descent }: { svg: string; width: number; height: number; descent: number }) {
	return <span style={{ display: "inline-block", width, height, verticalAlign: -descent }} dangerouslySetInnerHTML={{ __html: svg.replace(/width="[^"]+"/, `width="${width}"`).replace(/height="[^"]+"/, `height="${height}"`) }} />;
}
