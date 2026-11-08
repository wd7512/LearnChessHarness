import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Chess } from "chess.js";
import {
	chessQuestionProblems,
	chessProgress,
	chessWeaknesses,
	gradeChessAnswer,
	parseChessQuestion,
	playUci,
	replayChessAnswer,
	type ChessQuestion,
	type ChessState,
} from "../src/core/chess.ts";
import {
	CHESS_CONCEPTS,
	CHESS_OPENINGS,
	KING_SAFETY_EXERCISE as question,
} from "../src/core/chess-curriculum.ts";
import { ingestChessGames, parseChessPgn, pgnGames } from "../src/server/chess-import.ts";
import { ChessStore } from "../src/store/chess.ts";
import { ChessService } from "../src/server/chess.ts";
import { fetchChessPlatform } from "../src/server/chess-platforms.ts";
import { analyzeChessGame, type ChessEngine } from "../src/agent/chess-engine.ts";
import { inputAppends } from "../src/core/input-events.ts";
import { newAnswerResult, newThinkingMessage, type LhMessage } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import { findPendingToolCall } from "../src/core/pending.ts";
import { problemTool } from "../src/agent/tools/practice.ts";
import { chessboardTool } from "../src/agent/tools/chess.ts";
import { createProberTools, createTeacherTools } from "../src/agent/tools.ts";
import { newUserMessage } from "../src/core/native-messages.ts";

const sample = fs.readFileSync(new URL("./fixtures/chess-games.pgn", import.meta.url), "utf8");
function fixture() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chess-"));
	const store = new ChessStore(path.join(dir, "history.json"));
	return {
		store,
		service: new ChessService(store),
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
}
function assistant(name: string, input: unknown, id = "board-call"): LhMessage {
	return {
		id: `assistant-${id}`,
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: input as never }],
		stopReason: "toolUse",
		timestamp: 1,
		api: "openai-completions",
		provider: "fixture",
		model: "fixture",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

test("complete scripted lines validate; illegal authored lines and bad FEN are refused", async () => {
	assert.deepEqual(chessQuestionProblems(question), []);
	assert.equal(parseChessQuestion({ ...question, fen: "invented" }), undefined);
	assert.ok(chessQuestionProblems({ ...question, opponent: { mode: "fixed", moves: ["g8g5"] } }).length);
	assert.ok(chessQuestionProblems({ ...question, maxLearnerMoves: 3 }).length);
	const refused = await chessboardTool.execute("q", { ...question, fen: "invented" });
	assert.equal(refused.isError, true);
	assert.deepEqual(gradeChessAnswer(question, { uciMoves: ["g2g3", "g1f1"] }).moveGrade, "matches-lesson");
	assert.deepEqual(gradeChessAnswer(question, { uciMoves: ["h2h3", "g1f1"] }).moveGrade, "matches-lesson");
	assert.throws(() => gradeChessAnswer(question, { uciMoves: ["g1g5"] }));
	assert.equal(gradeChessAnswer(question, { uciMoves: ["f2f3"] }).moveGrade, "outside-lesson");
	assert.equal(replayChessAnswer(question, ["f2f3"]).board.turn(), "b");
});

test("chess.js handles castling, underpromotion, en passant and terminal positions", () => {
	const castles = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
	playUci(castles, "e1g1");
	assert.equal(castles.get("f1")?.type, "r");
	castles.undo();
	assert.equal(castles.get("h1")?.type, "r");
	const promotes = new Chess("7k/P7/8/8/8/8/8/7K w - - 0 1");
	playUci(promotes, "a7a8n");
	assert.equal(promotes.get("a8")?.type, "n");
	const ep = new Chess();
	["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"].forEach((m) => playUci(ep, m));
	assert.equal(ep.get("d5"), undefined);
	assert.equal(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1").isCheckmate(), true);
	assert.equal(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").isStalemate(), true);
	const resumed = replayChessAnswer(question, ["g2g3"]);
	assert.equal(resumed.board.get("f8")?.type, "k");
	assert.equal(resumed.board.turn(), "w");
});

test("manual PGN import is chronological, immutable and idempotent; endings and clocks stay distinct", async () => {
	const f = fixture();
	try {
		const result = await f.service.mutate({ action: "import", pgn: sample, playerId: "learner" });
		assert.equal((result as { added: number }).added, 3);
		const original = structuredClone(f.store.read().games);
		const second = await f.service.mutate({ action: "import", pgn: sample, playerId: "learner" });
		assert.equal((second as { added: number }).added, 0);
		assert.deepEqual(f.store.read().games, original);
		assert.deepEqual(
			original.map((g) => g.termination),
			["resignation", "timeout", "abandonment"],
		);
		assert.equal(original[0]!.clocks[0]!.clock, "0:10:00");
		assert.equal(original[0]!.learnerColor, "white");
		assert.equal(original[0]!.rated, null);
		assert.equal(original[0]!.speed, "rapid");
		assert.throws(() => parseChessPgn(pgnGames(sample)[0]!, "different"));
		assert.throws(() =>
			parseChessPgn('[White "Learner"]\n[Black "X"]\n[Result "1-0"]\n\n1. Ke5 1-0', "Learner"),
		);
		assert.equal(pgnGames(sample).length, 3);
	} finally {
		f.cleanup();
	}
});

test("PGN position checkmate overrides operational labels", () => {
	const game = parseChessPgn(
		'[White "Learner"]\n[Black "X"]\n[Result "0-1"]\n[Termination "Normal"]\n\n1. f3 e5 2. g4 Qh4# 0-1',
		"learner",
	);
	assert.equal(game.termination, "checkmate");
});

test("public Chess.com sync is passwordless, bounded, idempotent and keeps platform ratings separate", async () => {
	const month = "https://api.chess.com/pub/player/learner/games/2026/10";
	const pgn = pgnGames(sample)[0]!.replace(
		'[Site "Local fixture"]',
		'[Site "https://www.chess.com/game/live/1234"]',
	);
	const urls: string[] = [];
	const fetcher = async (url: string | URL | Request, options?: RequestInit) => {
		urls.push(String(url));
		assert.equal(options?.headers && "Authorization" in options.headers, false);
		return Response.json(
			String(url).endsWith("archives")
				? { archives: [month] }
				: { games: [{ pgn, rated: true, time_class: "rapid", white: { result: "resigned" } }] },
		);
	};
	const result = await fetchChessPlatform(
		{ platform: "chesscom", username: "Learner", status: "idle", autoSync: false },
		fetcher as typeof fetch,
	);
	assert.equal(result.games.length, 1);
	assert.equal(result.games[0]!.platformGameId, "1234");
	assert.equal(result.games[0]!.rated, true);
	assert.equal(urls.length, 2);
	const state: ChessState = {
		version: 1,
		games: [],
		analyses: [],
		ratings: [
			{
				platform: "lichess",
				username: "learner",
				speed: "rapid",
				date: "2026-10-01",
				rating: 1500,
				source: "api",
			},
		],
		connections: [],
		exercises: [],
	};
	assert.equal(ingestChessGames(state, result.games), 1);
	assert.equal(ingestChessGames(state, result.games), 0);
	assert.deepEqual(state.ratings.map((r) => r.platform).sort(), ["chesscom", "lichess"]);
	await assert.rejects(() =>
		fetchChessPlatform(
			{ platform: "chesscom", username: "../secret", status: "idle", autoSync: false },
			fetcher as typeof fetch,
		),
	);
	await assert.rejects(() =>
		fetchChessPlatform(
			{ platform: "chesscom", username: "learner", status: "idle", autoSync: false },
			(async () => Response.json({ archives: ["https://evil.test/secret"] })) as typeof fetch,
		),
	);
});

test("Lichess public PGNs and historical ratings need no OAuth and use overlap cursors", async () => {
	const seen: string[] = [];
	const fetcher = async (url: string | URL | Request) => {
		seen.push(String(url));
		return String(url).includes("rating-history")
			? Response.json([{ name: "Rapid", points: [[2026, 9, 1, 1500]] }])
			: new Response(
					pgnGames(sample)[0]!.replace('[Site "Local fixture"]', '[Site "https://lichess.org/abcdefgh"]'),
				);
	};
	const since = Date.parse("2026-10-01T00:00:00Z");
	const result = await fetchChessPlatform(
		{ platform: "lichess", username: "learner", status: "idle", autoSync: false, cursor: since },
		fetcher as typeof fetch,
	);
	assert.equal(result.games[0]!.platformGameId, "abcdefgh");
	assert.equal(result.ratings[0]!.date, "2026-10-01T00:00:00.000Z");
	assert.match(seen[0]!, new RegExp(`since=${since - 2 * 86400_000}`));
	assert.match(seen[0]!, /ongoing=false/);
	await assert.rejects(
		() =>
			fetchChessPlatform(
				{ platform: "lichess", username: "learner", status: "idle", autoSync: false },
				(async () =>
					new Response("outage", { status: 503, headers: { "retry-after": "120" } })) as typeof fetch,
			),
		/later retry/,
	);
});

test("held-out repeats and known curriculum examples cannot establish transfer", () => {
	const f = fixture();
	try {
		assert.equal(
			f.service.recordExercise({ ...question, heldOut: true }, { uciMoves: ["g2g3", "g1f1"] }).independent,
			false,
		);
		const unseen: ChessQuestion = {
			...question,
			fen: "6k1/5ppp/8/8/8/6P1/5P1P/6K1 w - - 0 1",
			maxLearnerMoves: 1,
			opponent: { mode: "fixed", moves: [] },
			acceptableLines: [["g1f1"]],
			heldOut: true,
		};
		assert.equal(f.service.recordExercise(unseen, { uciMoves: ["g1f1"] }).independent, true);
		assert.equal(f.service.recordExercise(unseen, { uciMoves: ["g1f1"] }).independent, false);
		assert.equal(f.store.read().exercises.length, 3);
	} finally {
		f.cleanup();
	}
});

test("engine provenance and rule-detectable opportunities support tentative hypotheses", async () => {
	const game = parseChessPgn(pgnGames(sample)[0]!, "learner");
	const fake: ChessEngine = {
		name: "Stockfish fixture",
		close() {},
		async evaluate(fen) {
			const board = new Chess(fen);
			const cp = board.get("h5")?.type === "q" && board.turn() === "b" ? -900 : 0;
			const m = board.moves({ verbose: true })[0];
			return {
				fen,
				cp,
				depth: 10,
				nodes: 1000,
				pv: [],
				bestMove: m ? m.from + m.to + (m.promotion ?? "") : "0000",
			};
		},
	};
	const analysis = await analyzeChessGame(game, fake);
	assert.equal(analysis.engine, "Stockfish fixture");
	assert.equal(analysis.positions.length, 5);
	const f = fixture();
	try {
		f.store.update((s) => {
			s.games.push(game);
			s.analyses.push(analysis);
		});
		const w = chessWeaknesses(f.store.read());
		assert.ok(w.length > 0);
		assert.equal(w[0]!.confidence, "insufficient evidence");
		assert.equal(w[0]!.examples[0]!.gameId, game.id);
		assert.ok(w[0]!.opportunities >= w[0]!.examples.length);
	} finally {
		f.cleanup();
	}
});

test("the reviewed curriculum has valid positions, prerequisites and legal opening lines", () => {
	assert.ok(CHESS_CONCEPTS.length >= 20 && CHESS_CONCEPTS.length <= 30);
	for (const c of CHESS_CONCEPTS) {
		assert.ok(c.sources.length);
		for (const fen of c.illustrativeFens) assert.doesNotThrow(() => new Chess(fen));
		for (const p of c.prerequisites) assert.ok(CHESS_CONCEPTS.some((c) => c.concept_id === p));
	}
	for (const o of CHESS_OPENINGS) {
		const board = new Chess();
		o.san.forEach((m) => board.move(m));
		assert.equal(board.fen(), o.fen);
	}
});

test("board answers traverse the existing native projection, answer and model-context paths", () => {
	const messages = [assistant("chessboard", question)];
	assert.equal(findPendingToolCall(projectView(messages))?.tool, "chessboard");
	const answer = {
		kind: "chessboard" as const,
		questionText: "spoofed",
		dontKnow: false,
		answers: [],
		chess: { uciMoves: ["g2g3", "g1f1"], reasoning: "Make room for the king." },
		answeredAt: "2026-11-07T12:00:00.000Z",
	};
	const appends = inputAppends({ messages }, { type: "answer", toolCallId: "board-call", answer });
	const result = appends[0]!;
	assert.equal(result.role, "toolResult");
	if (result.role !== "toolResult") throw new Error("Wrong projection");
	assert.equal((result.details as { questionText: string }).questionText, question.objective);
	assert.equal(
		(result.details as { chessGrade: { moveGrade: string } }).chessGrade.moveGrade,
		"matches-lesson",
	);
	assert.match(JSON.stringify(result.content), /g2g3/);
	assert.equal(findPendingToolCall(projectView([...messages, ...appends])), null);
	assert.throws(
		() =>
			inputAppends(
				{ messages },
				{ type: "answer", toolCallId: "board-call", answer: { ...answer, chess: { uciMoves: ["g1g5"] } } },
			),
		/Invalid move/,
	);
	const f = fixture();
	try {
		f.service.projectSession("chat", [...messages, ...appends]);
		f.service.projectSession("chat", [...messages, ...appends]);
		assert.equal(f.store.read().exercises.length, 1);
	} finally {
		f.cleanup();
	}
});

test("practice keeps the existing problem gate and validates submitted board moves server-side", async () => {
	const gate = { problemActive: false };
	const input = {
		statement: "Find a safe king plan",
		mode: "composition" as const,
		modelSolution: "Create room, then bring the king forward",
		chess: question,
	};
	const result = await problemTool(gate).execute("practice-board", input);
	assert.equal(gate.problemActive, true);
	const messages: LhMessage[] = [
		assistant("problem", input, "practice-board"),
		{
			id: "ack",
			role: "toolResult",
			toolCallId: "practice-board",
			toolName: "problem",
			content: result.content,
			details: null,
			isError: false,
			timestamp: 2,
		},
	];
	assert.throws(() =>
		inputAppends(
			{ messages, kind: "practice" },
			{
				type: "thinking",
				problemCallId: "practice-board",
				text: JSON.stringify({ chessAnswer: { uciMoves: ["g1g5"] } }),
			},
		),
	);
	const appends = inputAppends(
		{ messages, kind: "practice" },
		{
			type: "thinking",
			problemCallId: "practice-board",
			text: JSON.stringify({ chessAnswer: { uciMoves: ["g2g3", "g1f1"] } }),
		},
	);
	assert.match(JSON.stringify(appends), /matches-lesson/);
	assert.doesNotThrow(() =>
		inputAppends(
			{ messages, kind: "practice" },
			{ type: "thinking", problemCallId: "practice-board", text: "Can I have a hint?" },
		),
	);
	const f = fixture();
	try {
		f.service.projectSession("practice", [...messages, ...appends]);
		assert.equal(f.store.read().exercises.length, 1);
	} finally {
		f.cleanup();
	}
});

test("preview commits only on confirmation; failures retain games, ratings and sync cursor", async () => {
	const f = fixture();
	let outage = false;
	const month = "https://api.chess.com/pub/player/learner/games/2026/10";
	const fetcher = async (url: string | URL | Request) => {
		if (outage) return new Response("outage", { status: 503, headers: { "retry-after": "120" } });
		return Response.json(
			String(url).endsWith("archives")
				? { archives: [month] }
				: { games: [{ pgn: pgnGames(sample)[0], rated: true, time_class: "rapid" }] },
		);
	};
	const service = new ChessService(f.store, fetcher as typeof fetch);
	try {
		const preview = (await service.mutate({
			action: "preview",
			platform: "chesscom",
			username: "learner",
		})) as { previewId: string };
		assert.equal(f.store.read().games.length, 0);
		await service.mutate({ action: "connect", previewId: preview.previewId });
		assert.equal(f.store.read().connections[0]!.status, "success");
		assert.equal(f.store.read().games.length, 1);
		const resync = (await service.mutate({ action: "sync", platform: "chesscom", username: "learner" })) as {
			added: number;
		};
		assert.equal(resync.added, 0);
		const before = f.store.read();
		outage = true;
		await assert.rejects(() => service.mutate({ action: "sync", platform: "chesscom", username: "learner" }));
		const after = f.store.read();
		assert.deepEqual(after.games, before.games);
		assert.deepEqual(after.ratings, before.ratings);
		assert.equal(after.connections[0]!.cursor, before.connections[0]!.cursor);
		assert.equal(after.connections[0]!.status, "failed");
		await service.mutate({ action: "disconnect", platform: "chesscom", username: "learner" });
		assert.equal(f.store.read().games.length, 1);
		assert.equal(f.store.read().connections.length, 0);
	} finally {
		f.cleanup();
	}
});

test("engine absence degrades explicitly without replacing immutable games", async () => {
	const f = fixture();
	const original = process.env.STOCKFISH_PATH;
	try {
		await f.service.mutate({ action: "import", pgn: sample, playerId: "learner" });
		const before = f.store.read().games;
		process.env.STOCKFISH_PATH = "/no-such-stockfish";
		const analysis = (await f.service.mutate({ action: "analyze", gameId: before[0]!.id })) as {
			status: string;
			positions: unknown[];
			message: string;
		};
		assert.equal(analysis.status, "unavailable");
		assert.equal(analysis.positions.length, 0);
		assert.match(analysis.message, /Settings/);
		assert.doesNotMatch(analysis.message, /ENOENT|spawn /);
		assert.deepEqual(f.store.read().games, before);
	} finally {
		if (original === undefined) delete process.env.STOCKFISH_PATH;
		else process.env.STOCKFISH_PATH = original;
		f.cleanup();
	}
});

test("progress uses game dates and defined opportunities, never treating zero as success", () => {
	const f = fixture();
	try {
		const game = parseChessPgn(pgnGames(sample)[0]!, "learner");
		f.store.update((s) => {
			s.games.push(game);
		});
		f.service.recordExercise(
			question,
			{ uciMoves: ["g2g3", "g1f1"] },
			"practice",
			"2026-10-02T00:00:00.000Z",
		);
		const p = chessProgress(f.store.read())[0]!;
		assert.equal(p.baseline.rate, null);
		assert.equal(p.prospective.rate, null);
	} finally {
		f.cleanup();
	}
});

test("explicit chess lessons mix MCQ, recall and board; ordinary subjects retain their selected mechanic", () => {
	const ctx = {
		chatId: "mixed",
		chatStore: {
			getChat: () => ({
				messages: [newUserMessage("[LearnHarness Chess lesson] Teach king safety")],
				tree: { nodes: [{ id: "king" }] },
			}),
		},
		jobStore: {},
		spawn: () => {},
		deliver: () => {},
	} as never;
	const prober = createProberTools(ctx);
	assert.ok(prober.probe && prober.recall && prober.chessboard);
	const teacher = createTeacherTools(ctx);
	assert.ok(teacher.quiz && teacher.explain && teacher.chessboard);
	const ordinary = {
		chatId: "ordinary",
		chatStore: { getChat: () => ({ messages: [newUserMessage("Teach calculus")] }) },
		jobStore: {},
		spawn: () => {},
		deliver: () => {},
	} as never;
	const choice = createProberTools(ordinary);
	assert.ok(choice.probe);
	assert.equal(choice.recall, undefined);
	const recall = createProberTools(ordinary, { explain: true });
	assert.ok(recall.recall);
	assert.equal(recall.probe, undefined);
});

test("manual platform PGNs preserve platform ratings and canonical game IDs", () => {
	const raw = pgnGames(sample)[0]!
		.replace('[Site "Local fixture"]', '[Site "https://www.chess.com/game/live/9999"]')
		.replace("Synthetic rapid training game", "Rated rapid game");
	const game = parseChessPgn(raw, "learner");
	assert.equal(game.platform, "chesscom");
	assert.equal(game.id, "chesscom:9999");
	assert.equal(game.provenance.source, "PGN upload");
	const f = fixture();
	try {
		f.store.update((s) => ingestChessGames(s, [game]));
		assert.equal(f.store.read().ratings[0]!.platform, "chesscom");
	} finally {
		f.cleanup();
	}
});

test("an older saved practice answer prevents a later held-out attempt being counted on projection", () => {
	const f = fixture();
	const q: ChessQuestion = {
		...question,
		fen: "6k1/5ppp/8/8/8/6P1/5P1P/6K1 w - - 0 1",
		maxLearnerMoves: 1,
		opponent: { mode: "fixed", moves: [] },
		acceptableLines: [["g1f1"]],
		heldOut: true,
	};
	try {
		f.service.recordExercise(q, { uciMoves: ["g1f1"] }, "later", "2026-11-02T00:00:00Z");
		f.service.recordExercise(
			{ ...q, heldOut: false },
			{ uciMoves: ["g1f1"] },
			"earlier",
			"2026-11-01T00:00:00Z",
		);
		assert.equal(f.store.read().exercises.find((e) => e.id === "later")!.independent, false);
	} finally {
		f.cleanup();
	}
});
