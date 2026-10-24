import { phoneStatus, setPhoneEnabled } from "@/src/server";

export const dynamic = "force-dynamic";
const forbidden = (request: Request) => request.headers.has("x-lh-phone");
export function GET(request: Request) {
	if (forbidden(request)) return Response.json({ message: "Forbidden" }, { status: 403 });
	return Response.json(phoneStatus());
}
export async function PUT(request: Request) {
	if (forbidden(request)) return Response.json({ message: "Forbidden" }, { status: 403 });
	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).enabled !== "boolean") return Response.json({ message: "enabled must be a boolean" }, { status: 400 });
	await setPhoneEnabled((body as { enabled: boolean }).enabled);
	return Response.json(phoneStatus());
}
