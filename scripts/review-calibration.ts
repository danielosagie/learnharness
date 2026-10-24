/** Run with `npx tsx scripts/review-calibration.ts [fixture.json]`.
 * Without a fixture, the configured LH_DATA_DIR (or app data dir) is read. */
import fs from "node:fs";
import { reviewCalibration } from "../src/core/review.ts";
import type { GraphNode } from "../src/core/contracts/graph.ts";
import type { PracticeRecord } from "../src/core/contracts/review.ts";
import { readPracticeHistory } from "../src/server/review.ts";
import { stores } from "../src/server/stores.ts";

const fixturePath = process.argv[2];
let records: readonly PracticeRecord[];
let nodes: readonly GraphNode[];
if (fixturePath) {
	const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as { records: PracticeRecord[]; nodes: GraphNode[] };
	records = fixture.records;
	nodes = fixture.nodes;
} else {
	records = readPracticeHistory().records;
	nodes = stores.graphStore.readNodes();
}
const score = reviewCalibration(records, nodes);
console.log(`review calibration: n=${score.n} brier=${score.brier?.toFixed(6) ?? "n/a"} logLoss=${score.logLoss?.toFixed(6) ?? "n/a"}`);
