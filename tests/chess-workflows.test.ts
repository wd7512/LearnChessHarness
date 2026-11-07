import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Chess } from "chess.js";
import { ChessStore } from "../src/store/chess.ts";
import { ChessService } from "../src/server/chess.ts";
import { ChessReviewer } from "../src/server/chess-review.ts";
import {
	StockfishRuntime,
	StockfishUnavailable,
	type ChessEngineProvider,
} from "../src/server/chess-engine.ts";
import { TRANSFER_POSITIONS, evaluationComparison } from "../src/server/chess-mistakes.ts";
import {
	orderedChessGames,
	mistakePracticeStats,
	type StockfishStatus,
} from "../src/core/chess-workflows.ts";
import { chessWeaknesses, chessProgress } from "../src/core/chess.ts";

const pgn = fs.readFileSync(new URL("./fixtures/chess-games.pgn", import.meta.url), "utf8");
const ready: StockfishStatus = {
	state: "ready",
	version: "Stockfish fixture",
	source: "bundled",
	executablePath: "/fixture/stockfish",
	overridePath: "",
	message: "Stockfish ready",
	setupUrl: "/chess/setup",
};
function fixture(provider?: ChessEngineProvider) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chess-workflow-"));
	const store = new ChessStore(path.join(dir, "history.json"));
	let opened = 0;
	let closed = 0;
	const engine: ChessEngineProvider = provider ?? {
		status: async () => ready,
		open: async () => {
			opened++;
			return {
				name: "Stockfish fixture",
				close() {
					closed++;
				},
				async evaluate(fen) {
					const b = new Chess(fen);
					const moves = b.moves({ verbose: true });
					const best =
						moves.find((m) => m.piece === "q" && m.from === "h5" && m.to === "h3") ?? moves[0];
					const cp =
						!b
							.board()
							.flat()
							.some((p) => p?.color === "w" && p.type === "q") ||
						(b.get("h5")?.type === "q" && b.get("f6")?.type === "n" && b.turn() === "b")
							? -900
							: 0;
					return {
						fen,
						cp,
						bestMove: best ? best.from + best.to + (best.promotion ?? "") : "0000",
						depth: 12,
						nodes: 1000,
						pv: best ? [best.from + best.to + (best.promotion ?? "")] : [],
					};
				},
			};
		},
	};
	return {
		dir,
		store,
		engine,
		service: new ChessService(store, fetch, engine),
		opened: () => opened,
		closed: () => closed,
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
}
async function until(done: () => boolean) {
	const deadline = Date.now() + 5000;
	while (!done()) {
		assert.ok(Date.now() < deadline, "Background review did not settle");
		await new Promise((r) => setTimeout(r, 10));
	}
}

test("game selection is newest first by full timestamp, filters speeds, and preserves stored order", async () => {
	const f = fixture();
	try {
		await f.service.mutate({ action: "import", pgn, playerId: "learner" });
		f.store.update((s) => {
			s.games[0]!.playedAt = "2026-10-01T23:59:59Z";
			s.games[1]!.playedAt = "2026-10-01T01:00:00Z";
			s.games[2]!.playedAt = null;
			s.games[1]!.speed = "blitz";
		});
		const original = f.store.read().games;
		const sorted = orderedChessGames(original);
		assert.equal(sorted[0]!.id, original[0]!.id);
		assert.equal(sorted[2]!.playedAt, null);
		assert.deepEqual(
			orderedChessGames(original, "blitz").map((g) => g.id),
			[original[1]!.id],
		);
		assert.equal(orderedChessGames(original).length, 3);
		assert.deepEqual(f.store.read().games, original);
	} finally {
		f.cleanup();
	}
});

test("a scoped review analyzes a group, reports progress, aggregates evidence and reuses saved searches", async () => {
	const f = fixture();
	try {
		await f.service.mutate({ action: "import", pgn, playerId: "learner" });
		const original = f.store.read().games;
		await f.service.mutate({
			action: "reviewStart",
			speed: "rapid",
			limit: 10,
		});
		await until(() => !f.service.reviewer.running);
		const state = f.store.read();
		assert.equal(state.review!.status, "complete");
		assert.equal(state.review!.completed, 3);
		assert.equal(state.analyses.length, 3);
		assert.deepEqual(state.games, original);
		assert.equal(chessWeaknesses(state)[0]!.confidence, "tentative recurring pattern");
		const opened = f.opened();
		await f.service.mutate({
			action: "reviewStart",
			speed: "rapid",
			limit: 10,
		});
		await until(() => !f.service.reviewer.running);
		assert.equal(f.opened(), opened);
		assert.equal(f.store.read().review!.reused, 3);
		assert.equal(f.closed(), f.opened());
	} finally {
		f.cleanup();
	}
});

test("review cannot start without an engine and does not confuse missing analysis with an empty history", async () => {
	const f = fixture({
		status: async () => ({
			...ready,
			state: "unavailable",
			version: null,
			message: "Open engine setup",
		}),
		open: async () => {
			throw new Error("must not start");
		},
	});
	try {
		await f.service.mutate({ action: "import", pgn, playerId: "learner" });
		await assert.rejects(
			() => f.service.mutate({ action: "reviewStart", speed: "all", limit: 10 }),
			StockfishUnavailable,
		);
		assert.equal(f.store.read().games.length, 3);
		assert.equal(f.store.read().analyses.length, 0);
		assert.equal(f.store.read().review, undefined);
	} finally {
		f.cleanup();
	}
});

test("partial review preserves successful game analysis and marks uncovered evidence explicitly", async () => {
	const base = fixture();
	let count = 0;
	const f = fixture({
		status: async () => ready,
		open: async () => {
			if (++count === 1) throw new Error("fixture failure");
			return base.engine.open();
		},
	});
	try {
		await f.service.mutate({ action: "import", pgn, playerId: "learner" });
		await f.service.mutate({ action: "reviewStart", speed: "all", limit: 10 });
		await until(() => !f.service.reviewer.running);
		assert.equal(f.store.read().review!.status, "partial");
		assert.equal(f.store.read().review!.completed, 2);
		assert.equal(f.store.read().review!.failures.length, 1);
		assert.equal(f.store.read().games.length, 3);
	} finally {
		f.cleanup();
		base.cleanup();
	}
});

test("interrupted review recovers with a useful next step instead of claiming completion", () => {
	const f = fixture();
	try {
		f.store.update((s) => {
			s.review = {
				id: "old",
				status: "running",
				scope: { speed: "all", limit: 10 },
				gameIds: [],
				completed: 0,
				reused: 0,
				failures: [],
				startedAt: new Date().toISOString(),
			};
		});
		new ChessReviewer(f.store, f.engine).recover();
		assert.equal(f.store.read().review!.status, "interrupted");
		assert.match(f.store.read().review!.message!, /Start review again/);
	} finally {
		f.cleanup();
	}
});

test("personal mistake practice hides the original move, accepts sound alternatives, and preserves retries", async () => {
	const f = fixture();
	try {
		await f.service.mutate({ action: "import", pgn, playerId: "learner" });
		await f.service.mutate({ action: "reviewStart", speed: "all", limit: 10 });
		await until(() => !f.service.reviewer.running);
		const result = (await f.service.mutate({
			action: "mistakeStart",
			speed: "all",
			limit: 10,
		})) as { sessionId: string };
		const session = f.store.read().mistakeSessions!.find((s) => s.id === result.sessionId)!;
		const item = session.items.find((i) => i.kind === "personal-game")!;
		assert.ok(item.gameId && item.ply);
		assert.equal("originalMove" in item, false);
		assert.equal("bestMove" in item, false);
		assert.equal(session.attempts.length, 0);
		const first = await f.service.mistakes.answer(
			session.id,
			item.id,
			"h5e2",
			"Move the exposed queen.",
		);
		assert.equal(first.accepted, true);
		assert.equal(first.independent, false);
		assert.notEqual(first.originalMove, first.move);
		assert.ok(first.originalSan);
		assert.ok(first.originalAfter);
		assert.equal(first.before.cp, 0);
		assert.match(first.explanation, /Stockfish fixture/);
		const retry = await f.service.mistakes.answer(session.id, item.id, "h5h3");
		assert.equal(retry.accepted, true);
		assert.equal(retry.independent, false);
		assert.equal(f.store.read().mistakeSessions![0]!.attempts.length, 2);
		const restored = new ChessStore(path.join(f.dir, "history.json")).read();
		assert.equal(restored.mistakeSessions![0]!.attempts[0]!.feedback.move, "h5e2");
		assert.ok(chessProgress(restored).some((p) => p.conceptId === "piece-safety"));
	} finally {
		f.cleanup();
	}
});

test("transfer positions are legal, separately sourced and only a first unseen attempt counts", async () => {
	for (const fen of TRANSFER_POSITIONS) assert.doesNotThrow(() => new Chess(fen));
	const f = fixture();
	try {
		await f.service.mutate({ action: "import", pgn, playerId: "learner" });
		await f.service.mutate({ action: "reviewStart", speed: "all", limit: 10 });
		await until(() => !f.service.reviewer.running);
		await f.service.mutate({ action: "mistakeStart", speed: "all", limit: 10 });
		const session = f.store.read().mistakeSessions![0]!;
		const item = session.items.find((i) => i.kind === "unseen")!;
		const move = new Chess(item.fen).moves({ verbose: true })[0]!;
		const uci = move.from + move.to + (move.promotion ?? "");
		assert.equal((await f.service.mistakes.answer(session.id, item.id, uci)).independent, true);
		assert.equal((await f.service.mistakes.answer(session.id, item.id, uci)).independent, false);
		assert.equal(mistakePracticeStats(f.store.read()).unseen, 1);
		assert.equal(mistakePracticeStats(f.store.read()).remembered, 1);
	} finally {
		f.cleanup();
	}
});

test("engine comparison credits equivalent moves, preserves mate distinctions and reports uncertainty", () => {
	const b = new Chess();
	const base = {
		fen: b.fen(),
		bestMove: "e2e4",
		depth: 12,
		nodes: 100,
		pv: [],
	};
	assert.equal(
		evaluationComparison({ ...base, cp: 50 }, { ...base, cp: 10 }, "white", b).accepted,
		true,
	);
	assert.equal(
		evaluationComparison({ ...base, cp: 50 }, { ...base, cp: -100 }, "white", b).accepted,
		false,
	);
	assert.equal(
		evaluationComparison({ ...base, mate: 3 }, { ...base, mate: 4 }, "white", b).accepted,
		true,
	);
	assert.equal(
		evaluationComparison({ ...base, mate: 3 }, { ...base, cp: 500 }, "white", b).comparable,
		false,
	);
});

test("engine status discovers bundled resources on a fresh profile and override changes are durable", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-engine-settings-"));
	const prefs = path.join(dir, "engine.json");
	const calls: string[] = [];
	let closed = 0;
	const runtime = new StockfishRuntime(
		prefs,
		(exe) => {
			calls.push(exe);
			return {
				name: "Stockfish 19 fixture",
				ready: async () => {
					if (exe.includes("missing")) throw new Error("spawn ENOENT");
				},
				evaluate: async (fen) => ({
					fen,
					cp: 0,
					bestMove: "e5d5",
					depth: 1,
					nodes: 100,
					pv: [],
				}),
				close() {
					closed++;
				},
			};
		},
		() => ({
			NODE_ENV: "test",
			LH_STOCKFISH_BUNDLE_DIR: path.join(dir, "bundled"),
			PATH: "",
		}),
	);
	try {
		const status = await runtime.status();
		assert.equal(status.state, "ready");
		assert.equal(status.source, "bundled");
		assert.match(status.executablePath, /bundled/);
		assert.equal(fs.existsSync(prefs), false);
		await runtime.status();
		assert.equal(calls.length, 1);
		const bad = await runtime.saveOverride(path.join(dir, "missing"));
		assert.equal(bad.state, "unavailable");
		assert.match(bad.message, /Settings/);
		assert.doesNotMatch(bad.message, /ENOENT/);
		assert.equal(
			JSON.parse(fs.readFileSync(prefs, "utf8")).executablePath,
			path.join(dir, "missing"),
		);
		const reset = await runtime.saveOverride("");
		assert.equal(reset.source, "bundled");
		assert.equal(reset.state, "ready");
		assert.equal(closed, calls.length);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
