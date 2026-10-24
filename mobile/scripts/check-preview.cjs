const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
	const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
	const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, colorScheme: 'dark' });
	const base = process.env.PREVIEW_URL ?? 'http://localhost:8084';
	const receipts = [], errors = []; page.on('pageerror', (e) => errors.push(e.message));
	async function check(name, action) { const start = performance.now(); const data = await action(); receipts.push({ name, ms: +(performance.now() - start).toFixed(1), ...data }); }
	await check('not paired and manual Crockford normalization', async () => {
		await page.goto(base + '/'); await page.getByText('ENTER CODE INSTEAD', { exact: true }).waitFor();
		await page.getByText('ENTER CODE INSTEAD', { exact: true }).click();
		const code = page.getByPlaceholder('CODE1234'); await code.fill('abodl234'); assert.equal(await code.inputValue(), 'AB0D1234');
		await page.getByPlaceholder('100.x.y.z or computer.tailnet').fill('127.0.0.1'); await code.fill('ABCD1234');
		await page.getByText('PAIR PHONE', { exact: true }).click(); await page.getByText('DUE FOR REVIEW', { exact: true }).waitFor();
		await page.reload(); await page.getByText('The chain rule', { exact: true }).waitFor();
		const statusVisible = await page.getByText('9:41', { exact: true }).isVisible();
		const modeTarget = await page.getByLabel('teach mode', { exact: true }).boundingBox();
		const hostTarget = await page.getByText('MacBook', { exact: true }).locator('..').boundingBox();
		assert.ok(modeTarget.height >= 44); assert.ok(hostTarget.height >= 44);
		return { paired: true, statusVisible, modeTargetHeight: modeTarget.height, hostTargetHeight: hostTarget.height };
	});
	await check('nothing due and empty sessions', async () => {
		await page.route('**/api/review', (r) => r.fulfill({ json: { due: [], nextDueAt: new Date(Date.now() + 2 * 86400000 - 1000).toISOString() } }));
		await page.route('**/api/chats', (r) => r.fulfill({ json: { chats: [] } }));
		await page.goto(base + '/'); await page.getByText('Nothing due', { exact: true }).waitFor(); await page.getByText('next in 2 days', { exact: true }).waitFor(); await page.getByText('No sessions yet', { exact: true }).waitFor();
		assert.equal(await page.getByText("PRACTICE WHAT'S DUE", { exact: true }).count(), 0);
		return { due: 0, sessions: 0, nextDays: 2 };
	});
	await check('503 keeps the new-session draft', async () => {
		await page.route('**/api/models', (r) => r.fulfill({ status: 503, json: { message: 'Models unavailable' } }));
		const draft = page.getByPlaceholder('What do you want to learn?'); await draft.fill('Learn algebra'); await page.getByLabel('Start session', { exact: true }).click();
		await page.getByText('No models set up on your computer.', { exact: true }).waitFor(); assert.equal(await draft.inputValue(), 'Learn algebra');
		return { status: 503, draftRetained: true };
	});
	await page.unrouteAll({ behavior: 'wait' });
	await check('computer unreachable', async () => {
		await page.route('**/api/phone/hello', (r) => r.abort('failed'));
		await page.goto(base + '/'); await page.getByText('Can’t reach MacBook. Is LearnHarness open and Tailscale on?', { exact: true }).waitFor();
		return { messageShown: true };
	});
	await page.unrouteAll({ behavior: 'wait' });
	await check('long titles and check questions truncate at two lines', async () => {
		const title = 'A long title about derivatives and compositions repeated across many layers of reasoning '.repeat(4);
		await page.route('**/api/chats/preview-lesson', async (r) => { const response = await r.fetch(); const body = await response.json(); body.title = title; for (const m of body.messages) if (m.role === 'assistant') for (const part of m.content) if (part.type === 'toolCall' && part.name === 'quiz') part.arguments.question = 'This question asks about a long sequence of amplifiers and how their stretch factors combine. '.repeat(8); await r.fulfill({ json: body }); });
		await page.goto(base + '/session/preview-lesson');
		const heading = page.getByText(title, { exact: true }); await heading.waitFor(); await page.getByText('ANSWER', { exact: true }).waitFor();
		const titleBox = await heading.boundingBox();
		const question = page.getByText(/^This question asks/); const questionBox = await question.boundingBox();
		assert.ok(titleBox.height <= 72.5); assert.ok(questionBox.height <= 40.5);
		const back = await page.getByLabel('Back', { exact: true }).boundingBox(); assert.ok(back.width >= 44 && back.height >= 44);
		return { titleHeight: titleBox.height, titleLines: 2, questionHeight: questionBox.height, questionLines: 2, backTarget: { width: back.width, height: back.height } };
	});
	await page.unrouteAll({ behavior: 'wait' });
	await check('check controls have actual 44 pt targets', async () => {
		await page.goto(base + '/session/preview-lesson'); await page.getByText('ANSWER', { exact: true }).click();
		const slider = await page.getByLabel('Confidence', { exact: true }).boundingBox();
		const dismiss = await page.getByLabel('Dismiss check', { exact: true }).boundingBox();
		const handle = await page.getByLabel('Close check sheet', { exact: true }).last().boundingBox();
		assert.ok(slider.height >= 44 && dismiss.width >= 44 && dismiss.height >= 44 && handle.height >= 44);
		return { sliderHeight: slider.height, dismiss: { width: dismiss.width, height: dismiss.height }, handleHeight: handle.height };
	});
	await check('revocation clears credentials and explains pairing again', async () => {
		await page.route('**/api/chats', (r) => r.fulfill({ status: 401, json: { message: 'Not paired' } }));
		await page.goto(base + '/'); await page.getByText('This phone was removed from MacBook. Pair again.', { exact: true }).waitFor();
		assert.equal(await page.evaluate(() => localStorage.getItem('learnharness-phone-preview')), null);
		return { status: 401, credentialsCleared: true };
	});
	assert.deepEqual(errors, []);
	fs.writeFileSync(path.resolve(__dirname, '../.preview/manual-browser.json'), JSON.stringify({ receipts, errors }, null, 2));
	console.log(JSON.stringify({ receipts, errors }, null, 2)); await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
