import { startChatGPTLogin } from "@/src/server";

export async function POST() {
	try {
		return Response.json(await startChatGPTLogin());
	} catch {
		return Response.json({ error: "Sign-in could not start. Check the status and try again." }, { status: 503 });
	}
}
