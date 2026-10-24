import { commandHandy, handyStatus } from "@/src/server";

export const runtime = "nodejs";

export async function GET() {
	return Response.json(await handyStatus());
}

export async function POST(request: Request) {
	const body = await request.json().catch(() => null) as { command?: unknown } | null;
	if (body?.command !== "toggle" && body?.command !== "cancel") {
		return Response.json({ error: "command must be toggle or cancel" }, { status: 400 });
	}
	const result = await commandHandy(body.command);
	return Response.json(result, { status: result.ok ? 200 : 503 });
}
