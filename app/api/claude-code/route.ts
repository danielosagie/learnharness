import { claudeCodeStatus } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json(claudeCodeStatus(true));
}
