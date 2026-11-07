import React from "react";
globalThis.React = React;
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChessDiagram } from "../components/chess-diagram.tsx";
import { chessDiagramProblems, parseChessDiagram } from "../src/core/chess-diagram.ts";
import { quizInputProblems } from "../src/core/question-core.ts";
import { parseQuizInput, parseAskInput, parseExplainInput } from "../src/core/tool-parts.ts";
import { AnsweredCard } from "../components/answered-card.tsx";

const position = {
	fen: "8/3k4/8/3K4/4P3/8/8/8 w - - 1 2",
	orientation: "white" as const,
	highlightSquares: ["c6", "d6", "e6"],
	description:
		"After Black Kd7, White has a king on d5 and pawn on e4; Black has a king on d7. Candidate squares: c6, d6 and e6.",
};
const question =
	"After Black Kd7, with White's king on d5 and pawn on e4, can the king move to c6, d6 or e6?";
test("a position diagram shows the decision-point pieces, coordinates and identical neutral candidate highlights", () => {
	assert.ok(parseChessDiagram(position));
	assert.equal(parseChessDiagram({ ...position, fen: "invented" }), undefined);
	const html = renderToStaticMarkup(<ChessDiagram position={position} />);
	assert.equal((html.match(/data-square=/g) ?? []).length, 64);
	assert.equal((html.match(/data-candidate="true"/g) ?? []).length, 3);
	assert.match(html, /d5 White king/);
	assert.match(html, /e4 White pawn/);
	assert.match(html, /d7 Black king/);
	assert.match(html, /After Black Kd7/);
	assert.doesNotMatch(html, /data-legal|data-correct|aria-disabled/);
	for (const square of position.highlightSquares)
		assert.match(html, new RegExp(`data-square="${square}" data-candidate="true"`));
});
test("position-dependent MCQ and recall contracts preserve diagrams and refuse missing or invalid FENs", () => {
	assert.ok(chessDiagramProblems({ question }).length);
	assert.deepEqual(chessDiagramProblems({ question, position }), []);
	const input = {
		question,
		options: [
			{ label: "None", value: "none" },
			{ label: "All", value: "all" },
		],
		correctAnswer: "none",
		explanation: "The opposing king controls all three squares.",
		position,
	};
	assert.deepEqual(quizInputProblems(input), []);
	assert.ok(parseQuizInput(input)?.position);
	assert.equal(parseQuizInput({ ...input, position: { ...position, fen: "wrong" } }), undefined);
	assert.ok(parseAskInput({ question, position }));
	assert.ok(
		parseExplainInput({
			question,
			position,
			correctAnswer: "None of these squares is available.",
		}),
	);
	assert.equal(parseExplainInput({ question, correctAnswer: "None" }), undefined);
	assert.deepEqual(chessDiagramProblems({ question: "What is a derivative?" }), []);
});
test("an answered text question retains its original diagram and written question", () => {
	const input = {
		question,
		position,
		correctAnswer: "No squares are available.",
	};
	const html = renderToStaticMarkup(
		<AnsweredCard
			input={input}
			answer={{
				kind: "explain",
				questionText: question,
				dontKnow: false,
				answers: [],
				text: "I need to consider the opposing king",
				answeredAt: new Date().toISOString(),
			}}
		/>,
	);
	assert.match(html, /data-testid="chess-diagram"/);
	assert.match(html, /Black Kd7/);
	assert.match(html, /d7 Black king/);
});

// Give the real server composition its own isolated profile before importing it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chess-history-"));
process.env.LH_DATA_DIR = path.join(scratch, "data");
process.env.LH_AUTH_FILE = path.join(scratch, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
const { readChessHistory, chessContextFor } = await import("../src/server/chess-history.ts");
const { chessService } = await import("../src/server/chess.ts");
const { stores } = await import("../src/server/stores.ts");
const { createChessHistoryTool } = await import("../src/agent/tools/chess.ts");
const { newUserMessage } = await import("../src/core/native-messages.ts");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
test("the tutor's compact chess history distinguishes connected/imported, unanalyzed and analyzed data from an empty learning graph", async () => {
	const empty = (await readChessHistory({ view: "summary" })) as {
		importedGames: number;
		historyState: string;
	};
	assert.equal(empty.importedGames, 0);
	assert.equal(empty.historyState, "no_imported_games");
	await chessService.mutate({
		action: "import",
		playerId: "learner",
		pgn: fs.readFileSync(new URL("./fixtures/chess-games.pgn", import.meta.url), "utf8"),
	});
	chessService.store.update((s) => {
		s.connections.push({
			platform: "chesscom",
			username: "learner",
			status: "success",
			autoSync: false,
		});
	});
	const imported = (await readChessHistory({ view: "summary" })) as any;
	assert.equal(imported.importedGames, 3);
	assert.equal(imported.completedAnalyses, 0);
	assert.equal(imported.gamesAwaitingAnalysis, 3);
	assert.equal(imported.historyState, "games_await_analysis");
	assert.equal(imported.connectedAccounts[0].username, "learner");
	assert.match(imported.actions.review, /tab=games/);
	assert.match(imported.learningGraph, /separate/);
	const chat = stores.chatStore.createChat("King safety follow-up");
	stores.chatStore.saveMessages(chat.id, [newUserMessage("Teach me my common weaknesses")]);
	const context = await chessContextFor(chat.id);
	assert.match(context, /"importedGames":3/);
	assert.match(context, /do not ask the learner to select Mathematics/);
	const game = chessService.store.read().games[0]!;
	const fen = game.initialFen;
	chessService.store.update((s) => {
		s.analyses.push({
			gameId: game.id,
			status: "complete",
			engine: "Stockfish fixture",
			settings: { depth: 12, nodes: 100000 },
			analyzedAt: new Date().toISOString(),
			positions: [],
		});
	});
	const analyzed = (await readChessHistory({ view: "summary" })) as any;
	assert.equal(analyzed.completedAnalyses, 1);
	assert.equal(analyzed.gamesAwaitingAnalysis, 2);
	assert.equal(analyzed.historyState, "analyzed_without_supported_patterns");
	assert.ok(analyzed.recentTopics.some((c: any) => c.chatId === chat.id));
	const details = (await readChessHistory({
		view: "game",
		gameId: game.id,
	})) as any;
	assert.equal(details.game.id, game.id);
	assert.equal(details.analysis.engine, "Stockfish fixture");
	const point = (await readChessHistory({
		view: "position",
		gameId: game.id,
		ply: 1,
	})) as any;
	assert.equal(point.fen, fen);
	assert.equal(point.ply, 1);
	const tool = createChessHistoryTool((q) => readChessHistory(q, "existing-session"));
	const result = await tool.execute("history", { view: "summary" });
	assert.match(JSON.stringify(result.content), /completedAnalyses/);
	assert.equal(result.isError, undefined);
});
test("history retrieval failures are unavailable access, never fabricated zero counts or no connected account", async () => {
	const tool = createChessHistoryTool(async () => {
		throw new Error("fixture read failed");
	});
	const result = await tool.execute("history", { view: "summary" });
	assert.equal(result.isError, true);
	const output = JSON.parse((result.content[0] as { text: string }).text);
	assert.equal(output.status, "unavailable");
	assert.equal(output.importedGames, undefined);
	assert.match(output.message, /data-access failure/);
	const file = path.join(scratch, "data", "chess", "history.json");
	const original = fs.readFileSync(file, "utf8");
	try {
		fs.writeFileSync(file, "invalid JSON");
		await assert.rejects(() => readChessHistory({ view: "summary" }));
		const context = await chessContextFor("old-session");
		assert.match(context, /retrieval failed/);
		assert.doesNotMatch(context, /"importedGames":0/);
	} finally {
		fs.writeFileSync(file, original);
	}
});

test("history reads recover native chess practice before opening the workspace", async () => {
	const { KING_SAFETY_EXERCISE } = await import("../src/core/chess-curriculum.ts");
	const { newThinkingMessage } = await import("../src/core/native-messages.ts");
	const chat = stores.chatStore.createChat("Saved chess practice", "practice");
	const assistant = {
		id: "saved-chess-problem", role: "assistant" as const,
		content: [{ type: "toolCall" as const, id: "saved-position", name: "problem", arguments: { chess: KING_SAFETY_EXERCISE } }],
		stopReason: "toolUse" as const, timestamp: Date.now(), api: "openai-completions" as const,
		provider: "fixture", model: "fixture", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	const thinking = newThinkingMessage("saved-position", JSON.stringify({ chessAnswer: { uciMoves: ["g2g3", "g1f1"] } }));
	stores.chatStore.saveMessages(chat.id, [assistant, thinking]);
	const before = chessService.store.read().exercises.length;
	const summary = await readChessHistory({ view: "summary" }) as any;
	assert.equal(summary.previousChessPractice.lessonAttempts, before + 1);
	await readChessHistory({ view: "summary" });
	assert.equal(chessService.store.read().exercises.length, before + 1, "reconciliation is idempotent");
});
