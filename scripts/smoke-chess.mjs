/** Run only against a disposable LH_DATA_DIR. No model or live account is used. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = process.env.LH_SMOKE_URL || "http://localhost:3000";
const screenshots = process.env.LH_CHESS_SMOKE_SCREENSHOTS;
if (screenshots) await fs.mkdir(screenshots, { recursive: true });
const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const button = (text) => page.locator(`button::-p-text(${text})`).click();
const shot = async (name) => {
	if (screenshots) await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
};
const api = async (input) =>
	page.evaluate(async (body) => {
		const r = await fetch("/api/chess", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = await r.json();
		if (!r.ok) throw new Error(data.error);
		return data;
	}, input);
try {
	await page.setViewport({ width: 1440, height: 1180 });
	await page.goto(`${base}/chess`, { waitUntil: "domcontentloaded" });
	await button("Study");
	await page.waitForSelector("[data-testid=chess-board]");
	await page.waitForFunction(() => !document.querySelector("button[data-square=g2]")?.disabled);
	await page.click("[data-square=g2]");
	await page.click("[data-square=g3]");
	await page.waitForFunction(() =>
		document.querySelector("[aria-label='Move history']")?.textContent?.includes("Kf8"),
	);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForFunction(() =>
		document.querySelector("[aria-label='Move history']")?.textContent?.includes("Kf8"),
	);
	await page.click("[data-square=g1]");
	await page.click("[data-square=f1]");
	await button("Undo");
	assert.match(await page.$eval("[data-square=g1]", (e) => e.getAttribute("aria-label")), /white king/);
	await button("Restart");
	await page.click("[data-square=h2]");
	await page.click("[data-square=h3]");
	await page.click("[data-square=g1]");
	await page.click("[data-square=f1]");
	await page.type(
		"[aria-label='Your thinking']",
		"The pawn move creates an escape square. With no queens, I can consider activating the king after checking threats.",
	);
	await button("Submit answer");
	await page.waitForFunction(() => document.body.textContent.includes("Your moves match the lesson rubric."));
	await shot("02-board-answer");
	await button("Games");
	await page.type("[aria-label='Your name in the PGN']", "Learner");
	const file = await page.$("[aria-label='PGN files']");
	await file.uploadFile(new URL("../tests/fixtures/chess-games.pgn", import.meta.url).pathname);
	await page.waitForFunction(() =>
		document.querySelector("[aria-label='PGN text']")?.value.includes("FixtureThree"),
	);
	await button("Import PGN");
	await page.waitForFunction(() => document.body.textContent.includes("3 games added"));
	await button("Import PGN");
	await page.waitForFunction(() => document.body.textContent.includes("0 games added · 3 duplicates"));
	await shot("03-games-imported");
	await page.locator("button::-p-text(View game)").click();
	await button("Analyze with Stockfish");
	await page.waitForFunction(() => !document.body.textContent.includes("Stockfish is reviewing the game…"), {
		timeout: 120_000,
	});
	let state = await page.evaluate(async () => (await fetch("/api/chess")).json());
	assert.equal(state.games.length, 3);
	assert.equal(state.analyses[0]?.status, "complete", state.analyses[0]?.message);
	assert.match(state.analyses[0]?.engine, /^Stockfish/);
	for (const game of state.games.slice(1)) {
		const result = await api({ action: "analyze", gameId: game.id });
		assert.equal(result.status, "complete", result.message);
	}
	state = await page.evaluate(async () => (await fetch("/api/chess")).json());
	assert.equal(state.weaknesses[0]?.conceptId, "piece-safety");
	assert.equal(state.mistakeFindings.repeated.length > 0, true);
	await page.evaluate(() => {
		const main = document.querySelector("[data-testid=chess-workspace]");
		main.scrollTop = main.scrollHeight;
	});
	await shot("04-stockfish-review");
	const critical = state.analyses[0].positions.find((p) => p.conceptIds.includes("piece-safety"));
	const q = {
		fen: critical.before.fen,
		learnerColor: "white",
		objective: "Address the exposed queen",
		maxLearnerMoves: 1,
		opponent: { mode: "fixed", moves: [] },
		acceptableLines: [[critical.before.bestMove]],
		rubric: "Identify the attacker and explain why the queen needs attention.",
		expectedConceptIds: ["piece-safety"],
		heldOut: false,
	};
	await api({
		action: "exercise",
		question: q,
		answer: {
			uciMoves: [critical.before.bestMove],
			reasoning: "The knight attacks the undefended queen; I must account for that threat.",
		},
	});
	await button("Progress");
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-testid=chess-workspace]");
	await button("Progress");
	await page.waitForFunction(() => document.body.textContent.includes("Evidence, over time."));
	await shot("05-progress");
	await page.setViewport({ width: 390, height: 844 });
	await button("Study");
	await page.evaluate(() => {
		document.querySelector("[data-testid=chess-workspace]").scrollTop = 0;
	});
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
	assert.equal(
		await page.evaluate(
			() =>
				document.querySelector("[data-testid=chess-workspace]").getBoundingClientRect().width >=
				window.innerWidth - 4,
		),
		true,
		"The sidebar must not squeeze the mobile workspace.",
	);
	await shot("06-mobile");
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify(
			{
				board: "legal moves, fixed replies, undo, restart, reload, alternative answer, explanation",
				import: "3 games, repeat adds 0",
				engine: state.analyses.map((a) => ({ name: a.engine, positions: a.positions.length })),
				weakness: state.weaknesses[0],
				mobile: "390px without horizontal overflow",
				browserErrors: errors,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
