import { mintPairing } from "@/src/server";

export async function POST(request: Request) {
	if (request.headers.has("x-lh-phone")) return Response.json({ message: "Forbidden" }, { status: 403 });
	const pairing = mintPairing();
	return pairing ? Response.json(pairing) : Response.json({ message: "Phone access is not listening" }, { status: 409 });
}
