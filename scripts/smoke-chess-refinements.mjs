/** Disposable profile only: board accessibility, native controls, repeated fixes and opening scope artifacts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
if (process.env.LH_CHESS_SMOKE_DISPOSABLE !== "1")
	throw new Error("Use a disposable profile and LH_CHESS_SMOKE_DISPOSABLE=1.");
const base = process.env.LH_SMOKE_URL || "http://localhost:3014";
const out = process.env.LH_CHESS_SMOKE_SCREENSHOTS || path.resolve("work/chess-refinements");
await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const tab = (name) =>
	page.locator(`nav[aria-label="Chess sections"] button::-p-text(${name})`).click();
const button = (name) => page.locator(`button::-p-text(${name})`).click();
const shot = (name) => page.screenshot({ path: path.join(out, name + ".png") });
const api = (body, route = "/api/chess") =>
	page.evaluate(
		async ({ body, route }) => {
			const r = await fetch(route, {
				method: body ? "POST" : "GET",
				headers: { "Content-Type": "application/json" },
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			const data = await r.json();
			if (!r.ok) throw new Error(data.error);
			return data;
		},
		{ body, route },
	);
try {
	await page.setViewport({ width: 1365, height: 960 });
	await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
	await page.waitForSelector('[data-testid="recommended-next-step"]');
	assert.equal(await page.$('[data-testid="chess-board"]'), null);
	await shot("01-focused-home");
	await tab("Study");
	await page.waitForSelector('[data-testid="chess-board"] [data-square="g2"]');
	const initial = await page.$eval('[aria-label="Move history"]', (e) => e.textContent);
	await page.click('[data-square="g2"]');
	assert.ok(await page.$('[data-marker="legal-move"]'));
	await page.click('[data-square="g2"]');
	assert.equal(await page.$('[data-marker="legal-move"]'), null);
	assert.equal(await page.$eval('[aria-label="Move history"]', (e) => e.textContent), initial);
	await page.click('[data-square="g2"]');
	await page.$eval('[data-testid="chess-board"]', (e) => e.scrollIntoView({ block: "start" }));
	await shot("02-board-selection-and-coordinates");
	await page.click('[data-square="g3"]');
	await page.click('[data-square="g1"]');
	await page.click('[data-square="f1"]');
	await page.type(
		'[aria-label="Your thinking"]',
		"I checked the threats and the resulting position.",
	);
	await page.focus('[data-testid="confidence-slider"]');
	await page.keyboard.press("ArrowRight");
	assert.equal(await page.$eval('[data-testid="confidence-slider"]', (e) => Number(e.value)), 70);
	assert.ok(await page.$('[data-testid="dictation-toggle"]'));
	await button("Submit answer");
	await page.waitForFunction(() =>
		document.body.textContent.includes("Your moves match the lesson rubric."),
	);
	const sample = await fs.readFile(
		new URL("../tests/fixtures/chess-games.pgn", import.meta.url),
		"utf8",
	);
	const kg = (name, moves) =>
		`[Event "${name}"]\n[Site "Local fixture"]\n[Date "2026.11.01"]\n[White "Learner"]\n[Black "${name}"]\n[Result "0-1"]\n[TimeControl "300+0"]\n\n${moves} 0-1`;
	const pgn =
		sample +
		"\n\n" +
		[
			kg("KG Accepted", "1. e4 e5 2. f4 exf4 3. Nf3 g5 4. h4 g4 5. Ne5"),
			kg("KG Falkbeer", "1. e4 e5 2. f4 d5 3. exd5 e4 4. d3"),
			kg("KG Declined", "1. e4 e5 2. f4 d6 3. Nf3"),
		].join("\n\n");
	await api({ action: "import", pgn, playerId: "Learner" });
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector('[data-testid="recommended-next-step"]');
	await tab("Games");
	await page.waitForFunction(() => {
		const b = [...document.querySelectorAll("button")].find(
			(b) => b.textContent === "Review my games",
		);
		return b && !b.disabled;
	});
	await button("Review my games");
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="chess-review-workflow"]')
				?.textContent.includes("Review complete"),
		{ timeout: 180000 },
	);
	await page.waitForSelector('[data-testid="repeated-position-finding"]');
	await page.$eval('[data-testid="chess-mistake-findings"]', (e) =>
		e.scrollIntoView({ block: "start" }),
	);
	await shot("03-repeated-position-first-fixes");
	let state = await api();
	assert.equal(state.games.length, 6);
	assert.ok(state.games.every((g) => g.opening?.status));
	assert.ok(state.mistakeFindings.repeated.length > 0);
	assert.ok(
		state.mistakeFindings.mistakes.every((m) => m.status === "needs-review" || m.categories.length),
	);
	const repeated = state.mistakeFindings.repeated[0];
	assert.ok(repeated.verifiedGames >= 3);
	await tab("Home");
	await page.waitForFunction(() =>
		document
			.querySelector('[data-testid="recommended-next-step"]')
			?.textContent.includes("Fix a recurring move"),
	);
	await page.$eval('[data-testid="recommended-next-step"]', (e) =>
		e.scrollIntoView({ block: "start" }),
	);
	await shot("04-history-prioritized-home");
	await button("Practise this position");
	await page.waitForSelector('[data-testid="mistake-practice"] [data-testid="chess-board"]');
	assert.equal(await page.$('[data-testid="mistake-feedback"]'), null);
	await shot("05-targeted-practice-before-answer");
	state = await api();
	const session = state.mistakeSessions.at(-1);
	assert.equal(session.items.filter((i) => i.kind === "personal-game").length, 1);
	const item = session.items[0];
	const position = state.analyses
		.find((a) => a.gameId === item.gameId)
		.positions.find((p) => p.ply === item.ply);
	const move = position.before.bestMove;
	await page.click(`[data-square="${move.slice(0, 2)}"]`);
	await page.click(`[data-square="${move.slice(2, 4)}"]`);
	await page.type(
		'[aria-label="Your thinking"]',
		"I compared the forcing reply before choosing this move.",
	);
	await button("Check continuation");
	await page.waitForSelector('[data-testid="mistake-feedback"]');
	await page.$eval('[data-testid="mistake-feedback"]', (e) => e.scrollIntoView({ block: "start" }));
	await shot("06-verified-mistake-feedback");
	await tab("Games");
	await page.type('[aria-label="Opening scope"]', "King's Gambit");
	await page.waitForFunction(() =>
		document
			.querySelector('[data-testid="opening-scope-receipt"]')
			?.textContent.includes("3 matching games"),
	);
	const scope = await api(
		undefined,
		"/api/chess/history?view=scope&opening=" + encodeURIComponent("King's Gambit") + "&pageSize=2",
	);
	assert.equal(scope.receipt.matchedGames, 3);
	assert.equal(scope.games.length, 2);
	assert.equal(scope.pagination.nextPage, 2);
	assert.ok(scope.referenceCard.branches.length > 0);
	await page.$eval('[data-testid="opening-scope-receipt"]', (e) =>
		e.scrollIntoView({ block: "start" }),
	);
	await shot("07-opening-scope-receipt");
	await api({
		action: "reviewStart",
		opening: "King's Gambit",
		speed: "all",
		limit: 10,
		mode: "opening-survey",
		positionsPerGame: 4,
		reanalyze: true,
	});
	await page.waitForFunction(
		async () => {
			const s = await (await fetch("/api/chess")).json();
			return s.review.status === "complete";
		},
		{ timeout: 180000 },
	);
	const surveyed = await api(
		undefined,
		"/api/chess/history?view=scope&opening=" + encodeURIComponent("King's Gambit"),
	);
	assert.equal(surveyed.survey.ready, true);
	assert.ok(surveyed.survey.actualVerifiedPositions <= 12);
	state = await api();
	assert.ok(
		state.analyses
			.filter((a) =>
				state.games.find((g) => g.id === a.gameId).opening.name.startsWith("King's Gambit"),
			)
			.every((a) => a.coverage?.mode === "opening-survey" && a.positions.length <= 4),
	);
	if (process.env.LH_CHESS_VISUAL_CHAT) {
		await page.goto(base + "/chat/" + process.env.LH_CHESS_VISUAL_CHAT, {
			waitUntil: "domcontentloaded",
			timeout: 120000,
		});
		await page.waitForSelector('[data-testid="chess-question-layout"]');
		await shot("08-prediction-desktop");
		await page.setViewport({ width: 390, height: 844 });
		await page.waitForFunction(() =>
			[...document.querySelectorAll("aside")].every((e) => e.getBoundingClientRect().width === 0),
		);
		await page.waitForFunction(() => {
			const d = [...document.querySelectorAll('[data-testid="chess-diagram"]')].find(
				(e) => e.getBoundingClientRect().width > 100,
			);
			if (!d) return false;
			const root = d.closest("[data-dock-scroll-area]");
			const answers = [...root.querySelectorAll('[role="radio"]')];
			return (
				answers.length >= 4 &&
				answers.every((e) => {
					const r = e.getBoundingClientRect();
					return (
						r.top >= root.getBoundingClientRect().top &&
						r.bottom <= root.getBoundingClientRect().bottom + 2
					);
				})
			);
		});
		await shot("09-prediction-mobile-all-choices");
		const full = await page.$eval('[role="img"]', (e) => e.getAttribute("aria-label"));
		assert.ok(full.includes("White"));
		assert.equal(await page.$eval('[data-testid="chess-diagram"] details', (e) => e.open), false);
	}
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify(
			{
				games: 6,
				repeatFirst: true,
				coordinates: "outside squares",
				deselect: "no move/history change",
				nativeControls: "dictation + six-stop confidence + reasoning + submission",
				openingScope: "3 KG games, 3 measured branches, paginated enumeration and source card",
				survey: "at most four positions per game",
				prediction: "desktop and mobile question/board/choices visible together",
				errors,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
