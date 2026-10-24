import React from "react";
export function WebView({ source }: { source: { html: string; baseUrl?: string }; originWhitelist?: string[]; onShouldStartLoadWithRequest?: (request: { url: string }) => boolean; setSupportMultipleWindows?: boolean; javaScriptCanOpenWindowsAutomatically?: boolean; mixedContentMode?: string }) {
	return <iframe title="Lesson demo" srcDoc={source.html} sandbox="allow-scripts" style={{ flex: 1, border: 0, background: "#141414" }} />;
}
