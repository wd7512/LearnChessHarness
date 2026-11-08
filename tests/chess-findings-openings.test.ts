import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Chess } from "chess.js";
import { Type } from "typebox";
import {
	chessMistakeFindings,
	categorizeChessMistake,
	isDetectedChessMistake,
} from "../src/core/chess-findings.ts";
import {
	classifyChessOpening,
	matchesChessOpening,
	openingReferenceCard,
	openingScopeFromText,
	selectOpeningSurveyPlies,
	OPENING_SOURCE,
} from "../src/core/chess-openings.ts";
import { chessPositionKey } from "../src/core/chess-workflows.ts";
import type { ChessAnalysis, ChessGame, ChessState } from "../src/core/chess.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-opening-evidence-"));
process.env.LH_DATA_DIR = path.join(scratch, "data");
process.env.LH_AUTH_FILE = path.join(scratch, "auth.json");
process.env.STOCKFISH_PATH = path.join(scratch, "missing-engine");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
const { parseChessPgn } = await import("../src/server/chess-import.ts");
const { ChessStore } = await import("../src/store/chess.ts");
const { ChessService, chessService } = await import("../src/server/chess.ts");
const { readChessHistory, chessContextFor, chessEvidenceGateFor, createChessStudyAccess } =
	await import("../src/server/chess-history.ts");
const { stores } = await import("../src/server/stores.ts");
const { newUserMessage } = await import("../src/core/native-messages.ts");
const { chessReferenceTool, guardChessEvidence } = await import("../src/agent/tools/chess.ts");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
function game(line: string, name: string) {
	return parseChessPgn(
		`[Event "${name}"]\n[Site "Fixture"]\n[Date "2026.11.01"]\n[White "Learner"]\n[Black "${name}"]\n[Result "0-1"]\n[TimeControl "300+0"]\n\n${line} 0-1`,
		"Learner",
	);
}
const unsafe = "1. e4 e5 2. Qh5 Nc6 3. a3 Nf6 4. a4 Nxh5 5. h3";
function analysis(g: ChessGame, ply = 7, loss = 900): ChessAnalysis {
	const b = new Chess(g.initialFen);
	for (const move of g.moves.slice(0, ply - 1))
		b.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
	const before = b.fen();
	const move = g.moves[ply - 1]!;
	b.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
	return {
		gameId: g.id,
		status: "complete",
		engine: "fixture",
		settings: { depth: 12, nodes: 100000 },
		analyzedAt: new Date().toISOString(),
		positions: [
			{
				ply,
				before: { fen: before, cp: 0, bestMove: "h5e2", pv: ["h5e2"], depth: 12, nodes: 100000 },
				after: {
					fen: b.fen(),
					cp: -loss,
					bestMove: "f6h5",
					pv: ["f6h5"],
					depth: 12,
					nodes: 100000,
				},
				lossCp: loss,
				conceptIds: ["piece-safety"],
				opportunityIds: ["piece-safety"],
			},
		],
	};
}
function state(games: ChessGame[], analyses: ChessAnalysis[] = []): ChessState {
	return { version: 1, games, analyses, connections: [], ratings: [], exercises: [] };
}

test("identical repeated mistakes include transpositions and separate occurrences, choices and verified games", () => {
	const a = game(unsafe, "A");
	const b = game("1. e4 e5 2. a3 Nf6 3. Qh5 Nc6 4. a4 Nxh5 5. h3", "B");
	const c = game("1. e4 e5 2. Qh5 Nc6 3. a3 Nf6 4. Qe2 Bc5", "Sound");
	const d = game(unsafe, "Unanalyzed");
	const result = chessMistakeFindings(state([a, b, c, d], [analysis(a), analysis(b)]));
	assert.equal(result.repeated.length, 1);
	const f = result.repeated[0]!;
	assert.equal(f.gamesReached, 4);
	assert.equal(f.gamesPlayed, 3);
	assert.equal(f.verifiedGames, 2);
	assert.equal(f.analyzedOccurrences, 2);
	assert.equal(
		chessPositionKey(result.mistakes[0]!.fen),
		chessPositionKey(result.mistakes[1]!.fen),
	);
	assert.notEqual(result.mistakes[0]!.fen, result.mistakes[1]!.fen);
	assert.ok(
		result.mistakes.every(
			(m) =>
				m.categories.some((c) => c.id === "hanging-material") &&
				m.categories.some((c) => c.id === "unanswered-threat"),
		),
	);
	assert.ok(
		result.categoryPatterns.every((p) => !p.supported),
		"one familiar position is not a broader weakness",
	);
});

test("castling rights, side to move and legal en-passant rights remain part of position identity", () => {
	const fen = new Chess().fen();
	assert.notEqual(chessPositionKey(fen), chessPositionKey(fen.replace("KQkq", "kq")));
	assert.notEqual(chessPositionKey(fen), chessPositionKey(fen.replace(" w ", " b ")));
	assert.notEqual(
		chessPositionKey("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 20"),
		chessPositionKey("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 20"),
	);
	assert.equal(chessPositionKey(fen), chessPositionKey(fen.replace("0 1", "38 20")));
});

test("every loss is categorized or explicitly unresolved and new forced mates are detected without invented cp", () => {
	const g = game("1. e4 e5", "Quiet");
	const a = analysis(g, 1, 200);
	a.positions[0]!.before.bestMove = "d2d4";
	a.positions[0]!.before.pv = ["d2d4"];
	a.positions[0]!.after.pv = ["e7e5"];
	const m = categorizeChessMistake(g, a, a.positions[0]!);
	assert.equal(m.status, "needs-review");
	assert.deepEqual(m.categories, []);
	assert.equal(m.cause, "Needs tutor probe");
	const mate = game("1. f3 e5 2. g4 Qh4#", "Mate");
	const ma = analysis(mate, 3, 0);
	ma.positions[0]!.lossCp = null;
	ma.positions[0]!.before.pv = ["g2g3"];
	ma.positions[0]!.before.bestMove = "g2g3";
	delete ma.positions[0]!.after.cp;
	ma.positions[0]!.after.mate = -1;
	ma.positions[0]!.after.pv = ["d8h4"];
	assert.equal(isDetectedChessMistake(ma.positions[0]!, "white"), true);
	assert.ok(
		categorizeChessMistake(mate, ma, ma.positions[0]!).categories.some(
			(c) => c.id === "mating-net",
		),
	);
});

test("targeted practice queues the repeated position before higher isolated losses and supports a short focused session", async () => {
	const a = game(unsafe, "TargetA");
	const b = game(unsafe, "TargetB");
	const isolated = game("1. e4 e5 2. Qh5 Nc6 3. a4 Nf6 4. b3 Nxh5", "Isolated");
	const store = new ChessStore(path.join(scratch, "target.json"));
	store.update((s) =>
		Object.assign(
			s,
			state([a, b, isolated], [analysis(a), analysis(b), analysis(isolated, 7, 2000)]),
		),
	);
	const engine = {
		status: async () => ({
			state: "ready" as const,
			version: "fixture",
			source: "bundled" as const,
			executablePath: "/fixture",
			overridePath: "",
			message: "ready",
			setupUrl: "/chess/setup" as const,
		}),
		open: async () => {
			throw new Error("not needed until answer");
		},
	};
	const service = new ChessService(store, fetch, engine);
	await service.mutate({ action: "mistakeStart", speed: "all", limit: 10 });
	assert.ok(
		[a.id, b.id].includes(store.read().mistakeSessions!.at(-1)!.items[0]!.gameId!),
		"recurring decisions precede a higher isolated loss",
	);
	const f = chessMistakeFindings(store.read()).repeated[0]!;
	await service.mutate({ action: "mistakeStart", speed: "all", limit: 10, findingId: f.id });
	const session = store.read().mistakeSessions!.at(-1)!;
	assert.equal(session.items.filter((i) => i.kind === "personal-game").length, 1);
	assert.equal(session.items[0]!.findingId, f.id);
	assert.equal("originalMove" in session.items[0]!, false);
});

test("all stored games receive deterministic opening metadata and backfill preserves immutable PGN/moves", () => {
	const accepted = game("1. e4 e5 2. f4 exf4 3. Nf3 g5 4. h4 g4 5. Ne5", "KG");
	assert.ok(accepted.opening?.name.startsWith("King's Gambit"));
	assert.match(accepted.opening!.eco!, /^C3/);
	assert.equal(matchesChessOpening(accepted, "King’s Gambit"), true);
	const reversed = game("1. e4 e5 2. d3 f5", "Reversed");
	assert.equal(matchesChessOpening(reversed, "King's Gambit"), false);
	const raw = structuredClone(accepted);
	delete raw.opening;
	const store = new ChessStore(path.join(scratch, "old.json"));
	store.update((s) => s.games.push(raw));
	store.backfillOpenings();
	const saved = store.read().games[0]!;
	assert.deepEqual(saved.moves, accepted.moves);
	assert.equal(saved.rawPgn, accepted.rawPgn);
	assert.equal(saved.fingerprint, accepted.fingerprint);
	assert.equal(saved.opening!.revision, OPENING_SOURCE.revision);
	assert.equal(
		classifyChessOpening({ initialFen: "8/4k3/8/4K3/4P3/8/8/8 w - - 0 1", moves: [] }).status,
		"nonstandard-start",
	);
});

test("King's Gambit references contain cited, legal branches instead of an empty lookup", async () => {
	const card = openingReferenceCard("King's Gambit")!;
	assert.ok(card.branches.length > 5);
	assert.equal(card.source.licence, "CC0-1.0");
	for (const branch of card.branches) {
		const b = new Chess();
		b.loadPgn(branch.pgn);
		assert.equal(b.fen(), branch.fen);
	}
	assert.equal(openingScopeFromText("Teach me my King's Gambit weaknesses"), "King's Gambit");
	const r = await chessReferenceTool.execute("ref", { query: "King's Gambit" });
	const data = JSON.parse((r.content[0] as { text: string }).text);
	assert.ok(data.openingCard);
	assert.ok(data.openings.length > 0);
});

test("opening shorthand requires chess context and leaves language lessons unscoped", () => {
	assert.equal(openingScopeFromText("Teach me French vocabulary"), undefined);
	assert.equal(openingScopeFromText("Help with my Hungarian pronunciation"), undefined);
	assert.equal(openingScopeFromText("Teach me English grammar"), undefined);
	assert.equal(openingScopeFromText("Teach me the Sicilian opening"), "Sicilian Defense");
	assert.equal(openingScopeFromText("Review my French rapid games"), "French Defense");
	assert.equal(openingScopeFromText("Teach me the French Defense"), "French Defense");
});

test("scoped receipts enumerate all matching games with pagination and measured branch counts before probing", async () => {
	const games = [
		game("1. e4 e5 2. f4 exf4 3. Nf3 g5 4. h4 g4 5. Ne5", "Accepted"),
		game("1. e4 e5 2. f4 d5 3. exd5 e4 4. d3", "Falkbeer"),
		game("1. e4 e5 2. f4 d6 3. Nf3", "Declined"),
		game("1. e4 c5 2. Nf3", "Other"),
	];
	chessService.store.update((s) => Object.assign(s, state(games)));
	const scope = (await readChessHistory({
		view: "scope",
		opening: "King's Gambit",
		pageSize: 2,
	})) as any;
	assert.equal(scope.receipt.matchedGames, 3);
	assert.equal(scope.receipt.analyzedGames, 0);
	assert.equal(scope.games.length, 2);
	assert.equal(scope.pagination.nextPage, 2);
	assert.deepEqual(scope.receipt.branches.map((b: any) => b.branch).sort(), [
		"2...d5",
		"2...d6",
		"2...exf4",
	]);
	assert.ok(scope.referenceCard);
	assert.equal(scope.survey.ready, false);
	const page2 = (await readChessHistory({
		view: "list",
		opening: "King's Gambit",
		pageSize: 2,
		page: 2,
	})) as any;
	assert.equal(page2.games.length, 1);
	assert.ok(!scope.games.some((g: any) => g.id === page2.games[0].id));
	assert.equal(page2.pagination.nextPage, null);
	const chat = stores.chatStore.createChat("King's Gambit from my games");
	stores.chatStore.saveMessages(chat.id, [newUserMessage("Teach me my King's Gambit weaknesses")]);
	assert.match((await chessEvidenceGateFor(chat.id))!, /before probing|Do not pose/);
	const context = await chessContextFor(chat.id);
	assert.match(context, /"matchedGames":3/);
	assert.match(context, /"branches"/);
	assert.match(context, /Opening study artifacts/);
	const access = await createChessStudyAccess(chat.id, stores.chatStore.getChat(chat.id)!.messages);
	let executions = 0;
	const tool = {
		name: "probe",
		label: "probe",
		description: "fixture",
		parameters: Type.Object({}),
		execute: async () => {
			executions++;
			return { content: [], details: null };
		},
	};
	const guarded = guardChessEvidence(
		{ probe: tool, probe_done: { ...tool, name: "probe_done" } },
		() => chessEvidenceGateFor(chat.id),
	);
	assert.equal((await guarded.probe!.execute("q", {})).isError, true);
	assert.equal((await guarded.probe_done!.execute("done", {})).isError, true);
	assert.equal(executions, 0);
	chessService.store.update((s) => {
		s.analyses = games
			.filter((g) => matchesChessOpening(g, "King's Gambit"))
			.map((g) => {
				const plies = selectOpeningSurveyPlies(g, "King's Gambit", 4);
				const b = new Chess(g.initialFen);
				const positions: ChessAnalysis["positions"] = [];
				for (const [i, m] of g.moves.entries()) {
					const before = b.fen();
					b.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
					if (plies.includes(i + 1))
						positions.push({
							ply: i + 1,
							before: { fen: before, cp: 0, bestMove: m, pv: [m], depth: 12, nodes: 100000 },
							after: { fen: b.fen(), cp: 0, bestMove: "", pv: [], depth: 12, nodes: 100000 },
							lossCp: 0,
							conceptIds: [],
							opportunityIds: [],
						});
				}
				return {
					gameId: g.id,
					status: "complete",
					engine: "fixture",
					settings: { depth: 12, nodes: 100000 },
					analyzedAt: new Date().toISOString(),
					coverage: {
						mode: "opening-survey",
						sampledPlies: plies,
						totalLearnerPositions: Math.ceil(g.moves.length / 2),
					},
					positions,
				};
			});
	});
	assert.equal(await chessEvidenceGateFor(chat.id), undefined);
	assert.match((await access.gate())!, /has not received/);
	await access.read({ view: "scope", opening: "King's Gambit" });
	assert.equal(await access.gate(), undefined);
	await guarded.probe!.execute("ready", {});
	assert.equal(executions, 1);
});

test("a pinned geometric attacker is not mislabelled as an existing legal threat", () => {
	const g = {
		...game(unsafe, "Pinned"),
		id: "pinned",
		fingerprint: "pinned",
		initialFen: "5k2/8/5n2/7Q/8/8/8/5R1K w - - 0 1",
		moves: ["f1a1", "f6h5"],
	};
	const a = analysis(g, 1, 900);
	const m = categorizeChessMistake(g, a, a.positions[0]!);
	assert.ok(m.categories.some((c) => c.id === "hanging-material"));
	assert.ok(!m.categories.some((c) => c.id === "unanswered-threat"));
});

test("free-text opening scope honours time-control corrections and distinguishes an empty scope from an empty account", async () => {
	const chat = stores.chatStore.createChat("King's Gambit scope correction");
	stores.chatStore.saveMessages(chat.id, [
		newUserMessage("Teach me my King's Gambit weaknesses from blitz games"),
	]);
	assert.match(await chessContextFor(chat.id), /"timeControl":"blitz"/);
	stores.chatStore.saveMessages(chat.id, [
		...stores.chatStore.getChat(chat.id)!.messages,
		newUserMessage("Only rapid games please"),
	]);
	const context = await chessContextFor(chat.id);
	assert.match(context, /"timeControl":"rapid"/);
	assert.match(context, /"matchedGames":0/);
	assert.match(context, /"importedGames":4/);
});
