import { logoutChatGPT, chatGPTStatus } from "@/src/server";

export async function POST() {
	await logoutChatGPT();
	return Response.json(chatGPTStatus());
}
