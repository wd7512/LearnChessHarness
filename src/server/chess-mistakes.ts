import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { playUci, type ChessEvaluation } from "../core/chess.ts";
import {
	chessPositionKey,
	orderedChessGames,
	type ChessMistakeSession,
	type ChessPracticeFeedback,
	type ChessReviewScope,
} from "../core/chess-workflows.ts";
import { ChessStore } from "../store/chess.ts";
import { type ChessEngineProvider, StockfishUnavailable } from "./chess-engine.ts";

/** Authored transfer positions, separate from lesson examples and personal games. All are verified on use. */
export const TRANSFER_POSITIONS = [
	"6k1/5ppp/8/8/1b6/2Q5/5PPP/6K1 w - - 0 1",
	"6k1/5ppp/8/8/8/2n5/5PPP/1R4K1 w - - 0 1",
	"6k1/5ppp/8/8/8/3b4/4RPPP/6K1 w - - 0 1",
	"1r4k1/5ppp/2N5/8/8/8/5PPP/6K1 b - - 0 1",
];
export function evaluationComparison(
	before: ChessEvaluation,
	after: ChessEvaluation,
	color: "white" | "black",
	afterBoard: Chess,
) {
	const sign = color === "white" ? 1 : -1;
	if (afterBoard.isCheckmate())
		return {
			accepted: afterBoard.turn() !== color[0],
			comparable: true,
			lossCp: null,
		};
	if (before.cp !== undefined && after.cp !== undefined) {
		const lossCp = Math.max(0, Math.round((before.cp - after.cp) * sign));
		return { accepted: lossCp <= 80, comparable: true, lossCp };
	}
	if (before.mate !== undefined && after.mate !== undefined)
		return {
			accepted: before.mate * sign > 0 && after.mate * sign > 0,
			comparable: true,
			lossCp: null,
		};
	if (before.mate !== undefined && before.mate * sign < 0 && after.cp !== undefined)
		return { accepted: true, comparable: true, lossCp: null };
	return { accepted: false, comparable: false, lossCp: null };
}
function describe(e: ChessEvaluation) {
	return e.cp !== undefined
		? `${e.cp > 0 ? "+" : ""}${(e.cp / 100).toFixed(2)} pawns for White`
		: e.mate !== undefined
			? `mate score ${e.mate} from White's perspective`
			: "no exact score";
}
function sanLine(fen: string, moves: string[]) {
	const board = new Chess(fen);
	return moves
		.slice(0, 5)
		.map((m) => playUci(board, m).san)
		.join(" ");
}
export class ChessMistakes {
	private busy = new Set<string>();
	constructor(
		private store: ChessStore,
		private runtime: ChessEngineProvider,
	) {}
	async start(scope: ChessReviewScope) {
		const status = await this.runtime.status();
		if (status.state !== "ready") throw new StockfishUnavailable(status);
		const state = this.store.read();
		const allowed = new Set(
			orderedChessGames(state.games, scope.speed, scope.limit).map((g) => g.id),
		);
		const candidates = state.analyses
			.filter((a) => a.status === "complete" && allowed.has(a.gameId))
			.flatMap((a) =>
				a.positions
					.filter((p) => (p.lossCp ?? 0) >= 150)
					.map((p) => ({ analysis: a, position: p })),
			)
			.sort((a, b) => (b.position.lossCp ?? 0) - (a.position.lossCp ?? 0));
		if (!candidates.length)
			throw new Error(
				"No verified critical positions are available in this scope yet. Review your games first, or choose a broader game type. A lack of detected mistakes is not a complete assessment.",
			);
		const known = new Set(
			(state.mistakeSessions ?? []).flatMap((s) => s.items.map((i) => chessPositionKey(i.fen))),
		);
		for (const e of state.exercises) known.add(chessPositionKey(e.question.fen));
		// A personal-game position is never labelled unseen merely because it wasn't practised.
		for (const g of state.games) {
			const b = new Chess(g.initialFen);
			known.add(chessPositionKey(b.fen()));
			for (const move of g.moves) {
				playUci(b, move);
				known.add(chessPositionKey(b.fen()));
			}
		}
		const transfer = TRANSFER_POSITIONS.filter((f) => !known.has(chessPositionKey(f)));
		const now = new Date().toISOString();
		const session: ChessMistakeSession = {
			id: randomUUID(),
			createdAt: now,
			updatedAt: now,
			items: [],
			attempts: [],
		};
		const used = new Set<string>();
		for (const c of candidates) {
			const key = chessPositionKey(c.position.before.fen);
			if (used.has(key)) continue;
			used.add(key);
			const game = state.games.find((g) => g.id === c.analysis.gameId)!;
			const conceptId = c.position.conceptIds[0] ?? "calculation";
			session.items.push({
				id: randomUUID(),
				fen: c.position.before.fen,
				learnerColor: game.learnerColor,
				conceptId,
				kind: "personal-game",
				gameId: game.id,
				ply: c.position.ply,
			});
			const unseen = transfer.shift();
			if (unseen)
				session.items.push({
					id: randomUUID(),
					fen: unseen,
					learnerColor: new Chess(unseen).turn() === "w" ? "white" : "black",
					conceptId,
					kind: "unseen",
				});
			if (session.items.filter((i) => i.kind === "personal-game").length === 4) break;
		}
		this.store.update((s) => {
			s.mistakeSessions ??= [];
			s.mistakeSessions.push(session);
		});
		return {
			sessionId: session.id,
			items: session.items.length,
			unseen: session.items.filter((i) => i.kind === "unseen").length,
			message:
				transfer.length || session.items.some((i) => i.kind === "unseen")
					? "Personal positions are paired with separate, previously unused transfer positions."
					: "All available transfer positions have been seen in this app. This session practises remembered game positions only.",
		};
	}
	async answer(sessionId: string, itemId: string, move: string, reasoning?: string) {
		if (this.busy.has(sessionId)) throw new Error("This answer is already being checked.");
		this.busy.add(sessionId);
		try {
			const session = this.store.read().mistakeSessions?.find((s) => s.id === sessionId);
			const item = session?.items.find((i) => i.id === itemId);
			if (!item) throw new Error("This practice position no longer exists.");
			const candidate = new Chess(item.fen);
			const chosen = playUci(candidate, move);
			const engine = await this.runtime.open();
			try {
				const before = await engine.evaluate(item.fen);
				const after = await engine.evaluate(candidate.fen());
				const comparison = evaluationComparison(before, after, item.learnerColor, candidate);
				let originalMove: string | undefined;
				let originalSan: string | undefined;
				let originalAfter: ChessEvaluation | undefined;
				let originalFen: string | undefined;
				let originalLossCp: number | null | undefined;
				if (item.gameId && item.ply) {
					const game = this.store.read().games.find((g) => g.id === item.gameId);
					if (!game) throw new Error("The original game was cleared.");
					originalMove = game.moves[item.ply - 1]!;
					const original = new Chess(item.fen);
					originalSan = playUci(original, originalMove).san;
					originalFen = original.fen();
					originalAfter = await engine.evaluate(originalFen);
					originalLossCp = evaluationComparison(
						before,
						originalAfter,
						item.learnerColor,
						original,
					).lossCp;
				}
				const explanation = `${engine.name}, bounded to depth 12 or 100,000 nodes per position. Before: ${describe(before)}. Your ${chosen.san}: ${describe(after)}.${after.pv.length ? ` Verified reply line: ${sanLine(candidate.fen(), after.pv)}.` : ""}${originalSan && originalAfter ? ` In the game, ${originalSan} led to ${describe(originalAfter)}${originalLossCp !== null && originalLossCp !== undefined ? ` (estimated loss ${originalLossCp} cp)` : ""}.${originalAfter.pv.length ? ` Verified reply after the game move: ${sanLine(originalFen!, originalAfter.pv)}.` : ""}` : ""} ${comparison.comparable ? (comparison.accepted ? "Your move preserves the engine's bounded assessment within an 80 cp tolerance, or retains a verified mating result; alternative sound moves receive credit." : "This search finds a materially stronger continuation. Compare the forcing reply and explain what changed.") : "The search returned different evaluation types, so a reliable numeric comparison is unavailable. This attempt is not counted as an unseen success."} A verified reference continuation is ${sanLine(item.fen, before.pv.length ? before.pv : [before.bestMove])}.`;
				let independent = false;
				const feedback: ChessPracticeFeedback = {
					move,
					moveSan: chosen.san,
					originalMove,
					originalSan,
					originalAfter,
					originalFen,
					originalLossCp,
					before,
					after,
					...comparison,
					candidateFen: candidate.fen(),
					engine: engine.name,
					explanation,
					independent: false,
					answeredAt: new Date().toISOString(),
					reasoning,
				};
				this.store.update((s) => {
					const saved = s.mistakeSessions?.find((v) => v.id === sessionId);
					if (!saved) throw new Error("This practice session was cleared.");
					const prior = (s.mistakeSessions ?? []).some((v) =>
						v.attempts.some(
							(a) =>
								chessPositionKey(v.items.find((i) => i.id === a.itemId)!.fen) ===
								chessPositionKey(item.fen),
						),
					);
					independent = item.kind === "unseen" && !prior;
					feedback.independent = independent;
					saved.attempts.push({ itemId, feedback });
					saved.updatedAt = feedback.answeredAt;
				});
				return feedback;
			} finally {
				engine.close();
			}
		} finally {
			this.busy.delete(sessionId);
		}
	}
}
