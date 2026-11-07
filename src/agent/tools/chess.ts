import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { chessQuestionProblems, chessQuestionSchema } from "../../core/chess.ts";
import { CHESS_CONCEPTS, CHESS_OPENINGS } from "../../core/chess-curriculum.ts";
import { invalidInputResult, questionResult } from "../tool-execute.ts";
import { Chess } from "chess.js";
import { playUci } from "../../core/chess.ts";
import { StockfishEngine } from "../chess-engine.ts";

export const chessboardTool: AgentTool<typeof chessQuestionSchema> = {
	name: "chessboard",
	label: "chessboard",
	parameters: chessQuestionSchema,
	executionMode: "sequential",
	description:
		"Pose one legal chessboard question and pause for a learner answer. Supply a FEN, learner side, 1–8 learner moves and fixed replies between them, acceptable learner-only UCI lines and a separate explanation rubric. Every line is validated by chess.js. Legality and lesson-line matching are deterministic; neither certifies engine quality. Never invent an engine evaluation. A legal deviation ends guided replies and permits exploration. Use chess_reference for source-labelled concepts and opening examples. In a teaching plan include its nodeId; omit during probing.",
	execute: async (_id, input) => {
		const problems = chessQuestionProblems(input);
		return problems.length ? invalidInputResult("chessboard", problems) : questionResult();
	},
};
const referenceSchema = Type.Object({
	query: Type.String({ description: "Concept id, opening name, or empty for the library index." }),
});
export const chessReferenceTool: AgentTool<typeof referenceSchema> = {
	name: "chess_reference",
	label: "chess_reference",
	parameters: referenceSchema,
	description:
		"Read the versioned curated chess concept cards and legal named opening examples, with source authority. This returns principles and rule-checked lines, not engine evaluations or empirical frequencies.",
	execute: async (_id, { query }) => {
		const term = query.trim().toLowerCase();
		const cards = CHESS_CONCEPTS.filter(
			(c) => !term || `${c.concept_id} ${c.title} ${c.principle}`.toLowerCase().includes(term),
		);
		const openings = CHESS_OPENINGS.filter((o) => !term || `${o.eco} ${o.name}`.toLowerCase().includes(term));
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						cards,
						openings,
						authority:
							"Rules: chess.js. Concepts: editorial principles. Opening names: CC0 Lichess examples. Engine analysis must come from recorded Stockfish output.",
					}),
				},
			],
			details: null,
		};
	},
};

const analyzeSchema = Type.Object({
	fen: Type.String(),
	moves: Type.Array(Type.String(), {
		maxItems: 16,
		description: "Optional full alternating UCI continuation to verify, not learner-only moves.",
	}),
});
export const chessAnalyzeTool: AgentTool<typeof analyzeSchema> = {
	name: "chess_analyze",
	label: "chess_analyze",
	parameters: analyzeSchema,
	executionMode: "sequential",
	description:
		"Verify a FEN and optional full legal UCI continuation using installed Stockfish. Returns engine identity, actual depth/nodes and exact bounded evaluations in White's perspective. Missing engine gives an explicit unavailable result, never an invented score. Use this before describing a move as engine-verified. No live-game endpoints are used.",
	execute: async (_id, input) => {
		let board: Chess;
		try {
			board = new Chess(input.fen);
			for (const move of input.moves) playUci(board, move);
		} catch (e) {
			return invalidInputResult("chess_analyze", [e instanceof Error ? e.message : "Invalid continuation"]);
		}
		const engine = new StockfishEngine();
		try {
			await engine.ready();
			board = new Chess(input.fen);
			const evaluations = [await engine.evaluate(board.fen())];
			for (const move of input.moves) {
				playUci(board, move);
				evaluations.push(await engine.evaluate(board.fen()));
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: "verified",
							engine: engine.name,
							settings: { depth: 12, nodes: 100_000 },
							evaluations,
						}),
					},
				],
				details: null,
			};
		} catch (e) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: "unavailable",
							message: e instanceof Error ? e.message : "Stockfish unavailable",
							evaluations: [],
							limitation:
								"No engine evaluation is available. Use legal moves and label lesson rubrics as unverified by an engine.",
						}),
					},
				],
				details: null,
			};
		} finally {
			engine.close();
		}
	},
};
