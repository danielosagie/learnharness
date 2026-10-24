import { readReview, readReviewItems } from "@/src/server";

export async function GET(request?: Request) {
	const ids = request ? new URL(request.url).searchParams.get("ids") : null;
	if (ids !== null) return Response.json({ items: readReviewItems(ids.split(",").filter(Boolean)) });
	const { due, nextDueAt } = readReview();
	return Response.json({ due, nextDueAt });
}
