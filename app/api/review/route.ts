import { readReview } from "@/src/server";

export async function GET() {
	const { due, nextDueAt } = readReview();
	return Response.json({ due, nextDueAt });
}
