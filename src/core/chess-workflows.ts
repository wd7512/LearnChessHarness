import type { ChessEvaluation, ChessGame, ChessState } from "./chess.ts";

export interface StockfishStatus {
	state: "ready" | "unavailable";
	version: string | null;
	source: "override" | "environment" | "bundled" | "path";
	executablePath: string;
	overridePath: string;
	message: string;
	setupUrl: "/chess/setup";
}
export interface ChessHistoryQuery {
	view: "summary" | "game" | "position" | "practice";
	gameId?: string;
	ply?: number;
}
export type ChessHistoryReader = (query: ChessHistoryQuery) => Promise<unknown>;
export interface ChessReviewScope {
	speed: string;
	limit: number;
	reanalyze?: boolean;
}
export interface ChessReviewProgress {
	id: string;
	status: "running" | "complete" | "partial" | "failed" | "cancelled" | "interrupted";
	scope: ChessReviewScope;
	gameIds: string[];
	completed: number;
	reused: number;
	startedAt: string;
	finishedAt?: string;
	currentGameId?: string;
	failures: { gameId: string; message: string }[];
	message?: string;
}
export interface ChessPracticeItem {
	id: string;
	fen: string;
	learnerColor: "white" | "black";
	conceptId: string;
	kind: "personal-game" | "unseen";
	gameId?: string;
	ply?: number;
}
export interface ChessPracticeFeedback {
	move: string;
	moveSan: string;
	originalMove?: string;
	originalSan?: string;
	accepted: boolean;
	comparable: boolean;
	lossCp: number | null;
	originalLossCp?: number | null;
	before: ChessEvaluation;
	after: ChessEvaluation;
	originalAfter?: ChessEvaluation;
	engine: string;
	explanation: string;
	candidateFen: string;
	originalFen?: string;
	independent: boolean;
	answeredAt: string;
	reasoning?: string;
}
export interface ChessMistakeSession {
	id: string;
	createdAt: string;
	updatedAt: string;
	items: ChessPracticeItem[];
	/** Each entry preserves an attempt; retry never overwrites an older answer. */
	attempts: { itemId: string; feedback: ChessPracticeFeedback }[];
}
export function chessPositionKey(fen: string) {
	return fen.split(" ").slice(0, 4).join(" ");
}
export function orderedChessGames(
	games: readonly ChessGame[],
	speed = "all",
	limit = Number.MAX_SAFE_INTEGER,
) {
	const date = (g: ChessGame) => {
		const n = Date.parse(g.playedAt ?? "");
		return Number.isFinite(n) ? n : -Infinity;
	};
	return games
		.filter(
			(g) =>
				speed === "all" || g.speed === speed || (speed === "daily" && g.speed === "correspondence"),
		)
		.sort((a, b) => date(b) - date(a) || a.id.localeCompare(b.id))
		.slice(0, limit);
}
export function reviewChessState(state: ChessState) {
	const ids = new Set(state.review?.gameIds ?? []);
	return {
		...state,
		games: state.games.filter((g) => ids.has(g.id)),
		analyses: state.analyses.filter((a) => ids.has(a.gameId)),
	};
}
export function mistakePracticeStats(state: ChessState) {
	const attempts = (state.mistakeSessions ?? []).flatMap((s) => s.attempts.map((a) => a.feedback));
	return {
		attempts: attempts.length,
		remembered: attempts.filter((a) => !a.independent).length,
		unseen: attempts.filter((a) => a.independent && a.comparable).length,
		unseenAccepted: attempts.filter((a) => a.independent && a.comparable && a.accepted).length,
		uncertain: attempts.filter((a) => !a.comparable).length,
	};
}
