import { cancelChatGPTLogin, chatGPTStatus } from "@/src/server";

export async function POST() {
	await cancelChatGPTLogin();
	return Response.json(chatGPTStatus());
}
