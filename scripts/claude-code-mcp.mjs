import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Claude Code discovers tool schemas here. LearnHarness executes tool calls
// from the assistant stream itself, so this server must never run a tool.
const tools = JSON.parse(readFileSync(process.argv[2], "utf8"));
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return;
	}
	if (request.id === undefined) return;
	if (request.method === "initialize") {
		send({ jsonrpc: "2.0", id: request.id, result: {
			protocolVersion: request.params.protocolVersion,
			capabilities: { tools: {} },
			serverInfo: { name: "lh", version: "1" },
		} });
	} else if (request.method === "tools/list") {
		send({ jsonrpc: "2.0", id: request.id, result: { tools } });
	} else if (request.method === "tools/call") {
		send({ jsonrpc: "2.0", id: request.id, result: {
			content: [{ type: "text", text: "LearnHarness handles this tool call." }], isError: true,
		} });
	} else {
		send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method" } });
	}
});
