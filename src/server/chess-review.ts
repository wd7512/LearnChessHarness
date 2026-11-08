import { matchesChessOpening, selectOpeningSurveyPlies } from "../core/chess-openings.ts";
import { randomUUID } from "node:crypto";
import { orderedChessGames, type ChessReviewScope } from "../core/chess-workflows.ts";
import { analyzeChessGame } from "../agent/chess-engine.ts";
import { ChessStore } from "../store/chess.ts";
import { type ChessEngineProvider, StockfishUnavailable } from "./chess-engine.ts";

export async function analyzeStoredChessGame(
	store: ChessStore,
	runtime: ChessEngineProvider,
	gameId: string,
	scope?: import("../core/chess-workflows.ts").ChessReviewScope,
) {
	const game = store.read().games.find((g) => g.id === gameId);
	if (!game) throw new Error("This imported game no longer exists.");
	if (game.moves.length > 600) throw new Error("This game exceeds the 600-ply analysis limit.");
	const engine = await runtime.open();
	try {
		const sampled = scope?.mode === "opening-survey" ? selectOpeningSurveyPlies(game, scope.opening ?? "", scope.positionsPerGame ?? 4) : undefined;
		const analysis = await analyzeChessGame(game, engine, { depth: 12, nodes: 100_000 }, sampled);
		store.update((s) => {
			if (!s.games.some((g) => g.id === gameId))
				throw new Error("The game was cleared during analysis.");
			const saved = s.analyses.find((a) => a.gameId === gameId && a.status === "complete");
			if (sampled && saved) {
				// A bounded survey refreshes its positions without discarding earlier evidence.
				const positions = new Map(saved.positions.map((p) => [p.ply, p]));
				for (const position of analysis.positions) positions.set(position.ply, position);
				analysis.positions = [...positions.values()].sort((a, b) => a.ply - b.ply);
				if (!saved.coverage) delete analysis.coverage;
				else analysis.coverage!.sampledPlies = analysis.positions.map((p) => p.ply);
			}
			s.analyses = [...s.analyses.filter((a) => a.gameId !== gameId), analysis];
		});
		return analysis;
	} finally {
		engine.close();
	}
}

/** A durable progress record with an in-process worker, matching the app's single server owner. */
export class ChessReviewer {
	private active = false;
	constructor(
		private store: ChessStore,
		private runtime: ChessEngineProvider,
	) {}
	get running() {
		return this.active;
	}
	recover() {
		if (!this.active && this.store.read().review?.status === "running")
			this.store.update((s) => {
				if (s.review?.status === "running") {
					s.review.status = "interrupted";
					s.review.finishedAt = new Date().toISOString();
					s.review.message =
						"The previous review stopped when the app closed. Start review again; completed analyses will be reused.";
				}
			});
	}
	async start(scope: ChessReviewScope) {
		if (this.active) throw new Error("A game review is already running.");
		this.active = true;
		try {
			const status = await this.runtime.status();
			if (status.state !== "ready") throw new StockfishUnavailable(status);
			const games = orderedChessGames(this.store.read().games.filter(g => matchesChessOpening(g, scope.opening) && (!scope.learnerColor || scope.learnerColor === g.learnerColor)), scope.speed, scope.limit);
			if (!games.length)
				throw new Error(
					"No imported games match this scope. Choose another game type or import games first.",
				);
			const id = randomUUID();
			this.store.update((s) => {
				s.review = {
					id,
					status: "running",
					scope,
					gameIds: games.map((g) => g.id),
					completed: 0,
					reused: 0,
					failures: [],
					startedAt: new Date().toISOString(),
				};
			});
			void this.run(id).catch(() => {
				/* run persists a readable failure before settling */
			});
			return { reviewId: id, games: games.length };
		} catch (e) {
			this.active = false;
			throw e;
		}
	}
	cancel() {
		this.store.update((s) => {
			if (s.review?.status === "running") {
				s.review.status = "cancelled";
				s.review.message = "Review cancelled. Completed game analyses are saved.";
				s.review.finishedAt = new Date().toISOString();
			}
		});
	}
	private async run(id: string) {
		try {
			const job = this.store.read().review!;
			for (const gameId of job.gameIds) {
				const current = this.store.read().review;
				if (current?.id !== id || current.status !== "running") return;
				this.store.update((s) => {
					if (s.review?.id === id) s.review.currentGameId = gameId;
				});
				const saved = this.store
					.read()
					.analyses.find((a) => a.gameId === gameId && a.status === "complete");
				try {
					const game = this.store.read().games.find(g=>g.id===gameId)!;
					const reused = !!saved && !job.scope.reanalyze && (job.scope.mode === "opening-survey" ? selectOpeningSurveyPlies(game, job.scope.opening ?? "", job.scope.positionsPerGame ?? 4).every(ply=>saved.positions.some(p=>p.ply===ply)) : !saved.coverage);
					if (!reused) await analyzeStoredChessGame(this.store, this.runtime, gameId, job.scope);
					this.store.update((s) => {
						if (s.review?.id === id) {
							s.review.completed++;
							if (reused) s.review.reused++;
						}
					});
				} catch (e) {
					const message =
						e instanceof StockfishUnavailable
							? e.message
							: "This game could not be analyzed. Completed analyses are preserved; retry the review or inspect this game.";
					this.store.update((s) => {
						if (s.review?.id === id) s.review.failures.push({ gameId, message });
					});
					if (e instanceof StockfishUnavailable) break;
				}
			}
			this.store.update((s) => {
				if (s.review?.id === id && s.review.status === "running") {
					const r = s.review;
					r.status = r.failures.length ? (r.completed ? "partial" : "failed") : "complete";
					r.finishedAt = new Date().toISOString();
					delete r.currentGameId;
					r.message = r.failures.length
						? `${r.completed} of ${r.gameIds.length} games reviewed. ${r.failures[0]!.message}`
						: `${r.completed} games reviewed, including ${r.reused} saved analyses. Repeated-position fixes come first; other categories are shown only where board evidence supports them.`;
				}
			});
		} catch (e) {
			this.store.update((s) => {
				if (s.review?.id === id && s.review.status === "running") {
					s.review.status = "failed";
					s.review.message =
						"Review stopped before completion. Existing games and completed analyses are intact. Try again.";
				}
			});
			throw e;
		} finally {
			this.active = false;
		}
	}
}
