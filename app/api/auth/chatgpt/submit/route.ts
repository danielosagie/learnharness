import { submitChatGPTCallback } from "@/src/server";

export async function POST(request: Request) {
	const body = await request.json().catch(() => null) as { url?: unknown } | null;
	if (typeof body?.url !== "string" || !submitChatGPTCallback(body.url)) {
		return Response.json({ error: "No sign-in is waiting for a callback URL." }, { status: 400 });
	}
	return Response.json({ ok: true });
}
