import { Chess, type Square } from "chess.js";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const uci = Type.String({ pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$" });
/** Scripted replies are the MVP. Legal moves outside the lesson stay playable. */
export const chessQuestionSchema = Type.Object({
	fen: Type.String(),
	learnerColor: Type.Union([Type.Literal("white"), Type.Literal("black")]),
	objective: Type.String({ minLength: 1 }),
	maxLearnerMoves: Type.Integer({ minimum: 1, maximum: 8 }),
	opponent: Type.Object({ mode: Type.Literal("fixed"), moves: Type.Array(uci, { maxItems: 8 }) }),
	acceptableLines: Type.Array(Type.Array(uci, { minItems: 1, maxItems: 8 }), {
		minItems: 1,
		maxItems: 12,
		description:
			"Acceptable LEARNER moves only, in UCI. Each complete line is checked with the fixed replies. This is a lesson rubric, never an engine evaluation.",
	}),
	rubric: Type.String({
		minLength: 1,
		description: "Conceptual explanation criteria, graded separately from the moves.",
	}),
	expectedConceptIds: Type.Optional(Type.Array(Type.String())),
	sourcePositionId: Type.Optional(Type.String()),
	heldOut: Type.Optional(Type.Boolean()),
	nodeId: Type.Optional(Type.String()),
});
export type ChessQuestion = Static<typeof chessQuestionSchema>;
export interface ChessAnswer {
	uciMoves: string[];
	reasoning?: string;
	confidence?: number;
}

export function playUci(board: Chess, move: string) {
	if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error(`Invalid UCI: ${move}`);
	return board.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
}

export function chessQuestionProblems(q: ChessQuestion): string[] {
	try {
		const initial = new Chess(q.fen);
		if (initial.turn() !== q.learnerColor[0]) throw new Error("The learner must be on move.");
		for (const line of q.acceptableLines) {
			if (line.length !== q.maxLearnerMoves)
				throw new Error("Every acceptable line must contain maxLearnerMoves learner moves.");
			const board = new Chess(q.fen);
			for (let i = 0; i < line.length; i++) {
				playUci(board, line[i]!);
				if (i < line.length - 1) {
					if (!q.opponent.moves[i]) throw new Error("A fixed reply is missing.");
					playUci(board, q.opponent.moves[i]!);
				}
			}
		}
		if (q.opponent.moves.length !== q.maxLearnerMoves - 1)
			throw new Error("Provide exactly one fixed reply between learner moves.");
		return [];
	} catch (e) {
		return [e instanceof Error ? e.message : "Invalid chess question"];
	}
}

export function parseChessQuestion(input: unknown): ChessQuestion | undefined {
	if (!Value.Check(chessQuestionSchema, input)) return undefined;
	return chessQuestionProblems(input).length ? undefined : input;
}

/** Rebuild from learner moves. No client-supplied FEN or opponent move is trusted. */
export function replayChessAnswer(q: ChessQuestion, moves: string[]) {
	const board = new Chess(q.fen);
	let guided = true;
	let learnerMoves = 0;
	for (const move of moves) {
		if (guided && learnerMoves >= q.maxLearnerMoves) throw new Error("Too many learner moves.");
		playUci(board, move);
		learnerMoves++;
		guided =
			guided && q.acceptableLines.some((line) => moves.slice(0, learnerMoves).every((m, i) => line[i] === m));
		if (guided && learnerMoves < q.maxLearnerMoves && !board.isGameOver())
			playUci(board, q.opponent.moves[learnerMoves - 1]!);
	}
	return { board, guided, complete: guided && learnerMoves === q.maxLearnerMoves };
}

export function gradeChessAnswer(q: ChessQuestion, answer: ChessAnswer) {
	if (!answer || typeof answer !== "object") throw new Error("A structured chess answer is required.");
	if (
		answer.reasoning !== undefined &&
		(typeof answer.reasoning !== "string" || answer.reasoning.length > 20_000)
	)
		throw new Error("Explanation must be text under 20,000 characters.");
	if (!Array.isArray(answer.uciMoves) || answer.uciMoves.length === 0 || answer.uciMoves.length > 64)
		throw new Error("Submit 1–64 legal moves.");
	if (
		answer.confidence !== undefined &&
		(!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 100)
	)
		throw new Error("Confidence must be between 0 and 100.");
	const state = replayChessAnswer(q, answer.uciMoves);
	return {
		moveGrade: state.complete ? ("matches-lesson" as const) : ("outside-lesson" as const),
		explanationGrade: "awaiting-tutor" as const,
		rubric: q.rubric,
		verification: "rules-and-lesson-rubric" as const,
		finalFen: state.board.fen(),
	};
}

export function chessProgress(state: ChessState) {
	const personalPractice = (state.mistakeSessions ?? []).flatMap((s) =>
		s.attempts.map((a) => ({
			conceptId: s.items.find((i) => i.id === a.itemId)?.conceptId,
			answeredAt: a.feedback.answeredAt,
		})),
	);
	const concepts = [...new Set([
			...state.exercises.flatMap((e) => e.conceptIds),
			...personalPractice.flatMap((p) => (p.conceptId ? [p.conceptId] : [])),
		])];
	return concepts.map((conceptId) => {
		const firstPractice = [
			...state.exercises
			.filter((e) => e.conceptIds.includes(conceptId))
			.map((e) => e.answeredAt),
			...personalPractice.filter((p) => p.conceptId === conceptId).map((p) => p.answeredAt),
		].sort()[0]!;
		const period = (prospective: boolean) => {
			let errors = 0;
			let opportunities = 0;
			let games = 0;
			for (const game of state.games) {
				if (!game.playedAt || game.playedAt > firstPractice !== prospective) continue;
				const analysis = state.analyses.find((a) => a.gameId === game.id && a.status === "complete");
				if (!analysis) continue;
				games++;
				for (const p of analysis.positions) {
					if (p.opportunityIds.includes(conceptId)) opportunities++;
					if (p.conceptIds.includes(conceptId)) errors++;
				}
			}
			return { errors, opportunities, games, rate: opportunities ? errors / opportunities : null };
		};
		return { conceptId, firstPractice, baseline: period(false), prospective: period(true) };
	});
}

export function chessSquares(color: "white" | "black"): Square[] {
	const files = color === "white" ? "abcdefgh" : "hgfedcba";
	const ranks = color === "white" ? "87654321" : "12345678";
	return [...ranks].flatMap((rank) => [...files].map((file) => `${file}${rank}` as Square));
}

export type ChessPlatform = "manual" | "chesscom" | "lichess";
export interface ChessGame {
	id: string;
	fingerprint: string;
	platform: ChessPlatform;
	platformGameId?: string;
	playerId: string;
	learnerColor: "white" | "black";
	playedAt: string | null;
	timeControl: string;
	speed: string;
	rated: boolean | null;
	white: { name: string; rating?: number };
	black: { name: string; rating?: number };
	result: string;
	termination:
		| "checkmate" | "stalemate" | "resignation" | "timeout" | "abandonment" | "draw" | "unknown";
	moves: string[];
	initialFen: string;
	clocks: { ply: number; clock: string }[];
	rawPgn: string;
	provenance: { source: string; importedAt: string };
}
export interface ChessEvaluation {
	fen: string;
	bestMove: string;
	cp?: number;
	mate?: number;
	depth: number;
	nodes: number;
	pv: string[];
}
export interface ChessAnalysis {
	gameId: string;
	status: "complete" | "unavailable" | "failed";
	message?: string;
	engine: string;
	settings: { depth: number; nodes: number };
	analyzedAt: string;
	positions: {
		ply: number;
		before: ChessEvaluation;
		after: ChessEvaluation;
		lossCp: number | null;
		conceptIds: string[];
		opportunityIds: string[];
	}[];
}
export interface ChessConnection {
	platform: "chesscom" | "lichess";
	username: string;
	status: "idle" | "syncing" | "success" | "partial" | "failed";
	lastSync?: string;
	cursor?: number;
	archiveMonths?: string[];
	message?: string;
	autoSync: boolean;
}
export interface ChessRating {
	platform: "chesscom" | "lichess";
	username: string;
	speed: string;
	date: string;
	rating: number;
	source: "api" | "game";
	gameId?: string;
}
export interface ChessExerciseEvent {
	id: string;
	positionKey: string;
	conceptIds: string[];
	answeredAt: string;
	moveGrade: string;
	explanationGrade: "awaiting-tutor";
	heldOut: boolean;
	independent: boolean;
	question: ChessQuestion;
	answer: ChessAnswer;
}
export interface ChessState {
	version: 1;
	games: ChessGame[];
	analyses: ChessAnalysis[];
	connections: ChessConnection[];
	ratings: ChessRating[];
	exercises: ChessExerciseEvent[];
	review?: import("./chess-workflows.ts").ChessReviewProgress;
	mistakeSessions?: import("./chess-workflows.ts").ChessMistakeSession[];
}

/** Only include detectable opportunities. CP loss alone never assigns a concept. */
export function chessWeaknesses(state: ChessState) {
	const groups = new Map<
		string,
		{
			conceptId: string;
			opportunities: number;
			examples: { gameId: string; ply: number; fen: string; lossCp: number }[];
		}
	>();
	for (const a of state.analyses.filter((a) => a.status === "complete")) {
		for (const p of a.positions) {
			for (const conceptId of p.opportunityIds) {
				const g = groups.get(conceptId) ?? { conceptId, opportunities: 0, examples: [] };
				g.opportunities++;
				if (p.conceptIds.includes(conceptId) && p.lossCp !== null)
					g.examples.push({ gameId: a.gameId, ply: p.ply, fen: p.before.fen, lossCp: p.lossCp });
				groups.set(conceptId, g);
			}
		}
	}
	return [...groups.values()]
		.filter((g) => g.examples.length)
		.map((g) => ({
			...g,
			confidence:
				new Set(g.examples.map((e) => e.gameId)).size >= 3
					? "tentative recurring pattern"
					: "insufficient evidence",
			limitations:
				"Bounded engine analysis and a rules-based motif detector. Test this hypothesis with unseen exercises; this is not a diagnosis of understanding.",
		}));
}
