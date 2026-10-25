// Strip model-private thinking and bookkeeping; retain the recorded lesson and checks.
import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync(new URL('../fixtures/teach-final.json', import.meta.url), 'utf8'));
function compact(message) {
	const result = { ...message };
	for (const key of ['usage', 'provider', 'model', 'api', 'stopReason', 'thinkingSignature']) delete result[key];
	if (Array.isArray(result.content)) result.content = result.content.filter((part) => part.type !== 'thinking').map((part) => {
		const copy = { ...part }; delete copy.signature; delete copy.thinkingSignature; return copy;
	});
	return result;
}
const record = { id: 'sample-chain-rule', title: 'The chain rule', kind: 'teach', createdAt: source.createdAt, updatedAt: source.updatedAt, tree: source.tree, messages: source.messages.slice(35, 45).map(compact), turnInFlight: false };
const data = { record, nextTurn: source.messages.slice(46).map(compact) };
const text = JSON.stringify(data);
fs.writeFileSync(new URL('../src/sample/lesson.json', import.meta.url), text + '\n');
console.log(`Sample fixture: ${Buffer.byteLength(text + '\n')} bytes`);
