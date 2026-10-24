import { removePhoneDevice } from "@/src/server";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
	if (request.headers.has("x-lh-phone")) return Response.json({ message: "Forbidden" }, { status: 403 });
	const { id } = await ctx.params;
	return Response.json({ removed: await removePhoneDevice(id) });
}
