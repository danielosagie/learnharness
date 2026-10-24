/** Start the second listener in each Node server process, including standalone. */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const { startPhoneServer } = await import("./src/server/phone.ts");
	startPhoneServer();
}
