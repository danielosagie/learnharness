import { refreshClaudeCodeStatus } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return Response.json(await refreshClaudeCodeStatus(undefined, new URL(request.url).searchParams.has("refresh")));
}
