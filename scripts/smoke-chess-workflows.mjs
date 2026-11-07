/** Mutates a disposable local profile with synthetic games. No model or account is used. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
if (process.env.LH_CHESS_SMOKE_DISPOSABLE !== "1")
	throw new Error("Use a disposable LH_DATA_DIR and set LH_CHESS_SMOKE_DISPOSABLE=1.");
const base = process.env.LH_SMOKE_URL || "http://localhost:3012";
const out =
	process.env.LH_CHESS_SMOKE_SCREENSHOTS || path.resolve("work/chess-workflow-screenshots");
await fs.mkdir(out, { recursive: true });
const osName =
	process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
const engine =
	process.env.LH_CHESS_SMOKE_ENGINE ||
	path.resolve(
		"build",
		"stockfish",
		`${osName}-${process.arch}`,
		process.platform === "win32" ? "stockfish.exe" : "stockfish",
	);
const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(90_000);
const tab = (name) =>
	page.locator(`nav[aria-label="Chess sections"] button::-p-text(${name})`).click();
const button = (name) => page.locator(`button::-p-text(${name})`).click();
const snapshot = () => page.evaluate(async () => (await fetch("/api/chess")).json());
const api = (input, route = "/api/chess", method = "POST") =>
	page.evaluate(
		async ({ input, route, method }) => {
			const r = await fetch(route, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(input),
			});
			const data = await r.json();
			if (!r.ok) throw new Error(data.error);
			return data;
		},
		{ input, route, method },
	);
const shot = (name) => page.screenshot({ path: path.join(out, name + ".png"), fullPage: true });
try {
	await page.setViewport({ width: 1440, height: 1120 });
	await page.goto(`${base}/chess?tab=games`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-testid=chess-review-workflow]");
	await api({ executablePath: "" }, "/api/chess/engine", "PUT");
	await page.evaluate(() => window.dispatchEvent(new Event("lh:stockfish-changed")));
	await page.waitForFunction(() =>
		document
			.querySelector("[data-testid=chess-engine-status]")
			?.textContent.includes("Analysis needs an available engine"),
	);
	assert.equal(await page.$eval("button::-p-text(Review my games)", (b) => b.disabled), true);
	assert.ok(await page.$('a[href="/chess/setup"]'));
	assert.doesNotMatch(
		await page.$eval("[data-testid=chess-engine-status]", (e) => e.textContent),
		/ENOENT/,
	);
	await shot("01-engine-preflight");
	const sample = (
		await fs.readFile(new URL("../tests/fixtures/chess-games.pgn", import.meta.url), "utf8")
	).split(/\n\s*\n(?=\[Event)/)[0];
	const pg = Array.from({ length: 120 }, (_, i) =>
		sample
			.replace("Synthetic rapid training game", "Rated synthetic smoke game")
			.replace('"FixtureOne"', `"Synthetic${String(i).padStart(3, "0")}"`)
			.replace('"2026.10.01"', '"2026.10.03"')
			.replace(
				'"12:00:00"',
				`"${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00"`,
			)
			.replace('"600+5"', i % 2 ? '"300+0"' : '"600+5"'),
	).join("\n\n");
	const upload = path.join(out, "synthetic-120-games.pgn");
	await fs.writeFile(upload, pg);
	await page.type('[aria-label="Your name in the PGN"]', "Learner");
	await (await page.$('[aria-label="PGN files"]')).uploadFile(upload);
	await page.waitForFunction(() =>
		document.querySelector('[aria-label="PGN text"]').value.includes("Synthetic119"),
	);
	await button("Import PGN");
	await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 120);
	const dates = await page.$$eval("tbody time", (es) => es.map((e) => Date.parse(e.dateTime)));
	assert.equal(dates.length, 120);
	assert.equal(
		dates.every((n, i) => i === 0 || dates[i - 1] >= n),
		true,
	);
	await page.select('[aria-label="Game type"]', "blitz");
	assert.equal(await page.$$eval("tbody tr", (rows) => rows.length), 60);
	await page.select('[aria-label="Game type"]', "all");
	assert.equal(await page.$$eval("tbody tr", (rows) => rows.length), 120);
	const views = await page.$$("tbody button");
	await views[100].click();
	await page.waitForFunction(() => {
		const e = document.querySelector('[data-testid="selected-game-review"]');
		const r = e?.getBoundingClientRect();
		return r && r.top >= -2 && r.top < 150;
	});
	assert.equal(
		await page.$eval('[data-testid="selected-game-review"] button', (b) => b.disabled),
		true,
	);
	assert.match(
		await page.$eval('[data-testid="selected-game-review"]', (e) => e.textContent),
		/Stockfish setup/,
	);
	await shot("02-selected-game-visible");
	await button("Engine settings");
	await page.waitForSelector('[data-testid="chess-engine-settings"]');
	const field = await page.$('[aria-label="Stockfish executable override"]');
	await field.click({ clickCount: 3 });
	await page.keyboard.press("Backspace");
	await field.type(engine);
	await button("Save and check");
	await page.waitForFunction(() =>
		document
			.querySelector('[data-testid="chess-engine-settings"]')
			.textContent.includes("Stockfish 19 is ready"),
	);
	await shot("03-engine-settings");
	await page.keyboard.press("Escape");
	await page.select('[aria-label="Game type"]', "blitz");
	await page.select('[aria-label="Review recent games"]', "10");
	await button("Review my games");
	await page.waitForFunction(() =>
		document.querySelector('progress[aria-label="Game review progress"]'),
	);
	await shot("04-batch-review-progress");
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="chess-review-workflow"]')
				.textContent.includes("Review complete"),
		{ timeout: 180_000 },
	);
	await page.waitForFunction(() =>
		document
			.querySelector('[data-testid="chess-review-workflow"]')
			.textContent.includes("tentative recurring pattern"),
	);
	await page.$eval('[data-testid="chess-review-workflow"]', (e) =>
		e.scrollIntoView({ block: "start" }),
	);
	await shot("05-evidence-summary");
	const reviewed = await snapshot();
	assert.equal(reviewed.review.completed, 10);
	assert.equal(reviewed.review.scope.speed, "blitz");
	assert.equal(reviewed.analyses.filter((a) => a.status === "complete").length, 10);
	await button("Practise my mistakes");
	await page.waitForSelector('[data-testid="mistake-practice"] [data-testid="chess-board"]');
	let state = await snapshot();
	const session = state.mistakeSessions.at(-1);
	const item = session.items[0];
	const analysis = state.analyses
		.find((a) => a.gameId === item.gameId)
		.positions.find((p) => p.ply === item.ply);
	assert.equal(await page.$('[data-testid="mistake-feedback"]'), null);
	assert.doesNotMatch(
		await page.$eval('[data-testid="mistake-practice"]', (e) => e.textContent),
		/In the game, you played/,
	);
	await shot("06-personal-position-hidden-answer");
	const move = analysis.before.bestMove;
	await page.click(`[data-square="${move.slice(0, 2)}"]`);
	await page.click(`[data-square="${move.slice(2, 4)}"]`);
	if (move[4]) await button({ q: "queen", r: "rook", b: "bishop", n: "knight" }[move[4]]);
	await page.type(
		'[aria-label="Your explanation"]',
		"I checked the forcing reply and chose a continuation that accounts for the threat.",
	);
	await button("Check continuation");
	await page.waitForSelector('[data-testid="mistake-feedback"]');
	assert.match(
		await page.$eval('[data-testid="mistake-feedback"]', (e) => e.textContent),
		/In the game, you played/,
	);
	await page.$eval('[data-testid="mistake-feedback"]', e => e.scrollIntoView({ block: "start" }));
	await shot("07-verified-practice-feedback");
	await button("Retry position");
	assert.equal(await page.$('[data-testid="mistake-feedback"]'), null);
	await tab("Learn");
	await page.waitForFunction(() =>
		document
			.querySelector('[data-testid="chess-history-start"]')
			.textContent.includes("120 imported games"),
	);
	assert.match(
		await page.$eval('[data-testid="chess-history-start"]', (e) => e.textContent),
		/10 completed analyses/,
	);
	await shot("08-history-aware-start");
	await page.setViewport({ width: 390, height: 844 });
	await tab("Games");
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="chess-workspace"]').getBoundingClientRect().width >=
			386,
	);
	await page.select('[aria-label="Game type"]', "all");
	const mobileViews = await page.$$("tbody button");
	await mobileViews.at(-1).click();
	await page.waitForFunction(() => {
		const r = document
			.querySelector('[data-testid="selected-game-review"]')
			.getBoundingClientRect();
		return r.top >= -2 && r.top < 150;
	});
	await shot("09-mobile-game-review");
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify(
			{
				imported: 120,
				sorting: "full timestamp, newest first",
				filtering: "60 blitz / 120 all",
				selectedReview: "visible on desktop and mobile",
				engine: "unavailable before setup, enabled after Settings check",
				batch: "10 games reviewed without opening each",
				practice:
					"original hidden until submission; actual move, verified engine comparison and retry checked",
				tutorHistory: "120 imported, 10 analyzed, supported pattern visible",
				browserErrors: errors,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
