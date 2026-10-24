import assert from "node:assert/strict";
import { it } from "node:test";
import { GET } from "../app/api/review/route.ts";

it("keeps the normal review envelope and resolves the ids query to items", async () => {
	const ordinary = await GET(new Request("http://localhost/api/review"));
	assert.equal(ordinary.status, 200);
	const normal = await ordinary.json();
	assert.ok(Array.isArray(normal.due));
	assert.ok("nextDueAt" in normal);
	assert.equal("items" in normal, false);
	const selected = await GET(new Request("http://localhost/api/review?ids=missing-mobile-node"));
	assert.deepEqual(await selected.json(), { items: [] });
});
