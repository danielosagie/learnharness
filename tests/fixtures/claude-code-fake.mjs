#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") {
	if (process.env.LH_FAKE_AUTH_COUNT) appendFileSync(process.env.LH_FAKE_AUTH_COUNT, "1\n");
	process.stdout.write(JSON.stringify({ loggedIn: process.env.LH_FAKE_LOGGED_IN !== "0", subscriptionType: "max" }));
	process.exit(0);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (process.env.LH_FAKE_INPUT) writeFileSync(process.env.LH_FAKE_INPUT, JSON.stringify({ args, input: JSON.parse(input) }));
if (process.env.LH_FAKE_MODE === "hang") {
	process.on("SIGTERM", () => {
		if (process.env.LH_FAKE_KILLED) writeFileSync(process.env.LH_FAKE_KILLED, "term");
		process.exit(143);
	});
	setInterval(() => {}, 1000);
} else if (process.env.LH_FAKE_MODE === "tool") {
	process.stdout.write(readFileSync(new URL("./claude-code-tool.jsonl", import.meta.url), "utf8"));
	process.exit(1);
} else if (process.env.LH_FAKE_MODE === "error") {
	process.stdout.write(`${JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "rate limit exceeded" })}\n`);
	process.exit(1);
} else if (process.env.LH_FAKE_MODE === "no-result") {
	process.exit(1);
} else {
	process.stdout.write(readFileSync(new URL("./claude-code-text.jsonl", import.meta.url), "utf8"));
}
