import {
	matchesChessOpening,
	openingBranch,
	openingReferenceCard,
	openingReferences,
} from "../core/chess-openings.ts";
import { orderedChessGames, type ChessHistoryQuery } from "../core/chess-workflows.ts";
import { chessMistakeFindings } from "../core/chess-findings.ts";
import { chessService } from "./chess.ts";
import { stockfishRuntime } from "./chess-engine.ts";
import { selectOpeningSurveyPlies } from "../core/chess-openings.ts";

export async function readChessScope(query: ChessHistoryQuery) {
	chessService.store.backfillOpenings();
	let state = chessService.store.read();
	const opening = query.opening?.trim() ?? "";
	const reference = opening ? openingReferenceCard(opening) : null;
	const games = orderedChessGames(state.games, query.speed ?? "all").filter(
		(g) =>
			(!query.learnerColor || g.learnerColor === query.learnerColor) &&
			matchesChessOpening(g, opening),
	);
	for (const value of [query.page, query.pageSize, query.limit])
		if (value !== undefined && (!Number.isInteger(value) || value < 1))
			throw new Error("Scope pagination requires positive integers.");
	const pageSize = Math.max(1, Math.min(100, Math.floor(query.pageSize ?? 20)));
	const page = Math.max(1, Math.floor(query.page ?? 1));
	const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 10)));
	const surveyGames = games.slice(0, limit);
	const covered = () =>
		surveyGames.filter((g) => {
			const a = state.analyses.find((a) => a.gameId === g.id && a.status === "complete");
			return (
				a &&
				selectOpeningSurveyPlies(g, opening, 4).every((ply) =>
					a.positions.some((p) => p.ply === ply),
				)
			);
		});
	let message = "";
	if (
		query.survey &&
		opening &&
		reference &&
		surveyGames.length &&
		covered().length < surveyGames.length
	) {
		const engine = await stockfishRuntime.status();
		if (engine.state !== "ready") message = engine.message;
		else if (!chessService.reviewer.running) {
			try {
				await chessService.reviewer.start({
					opening,
					speed: query.speed ?? "all",
					learnerColor: query.learnerColor,
					limit,
					mode: "opening-survey",
					positionsPerGame: 4,
				});
			} catch (error) {
				message = error instanceof Error ? error.message : "The survey could not start.";
			}
		} else
			message =
				"A review is already running. Wait for it to finish before starting another survey.";
		state = chessService.store.read();
	}
	const branchPaths = new Map<string, number>();
	const branches = new Map<
		string,
		{ branch: string; games: number; analyzedGames: number; gameIds: string[] }
	>();
	for (const game of games) {
		const branch = opening ? openingBranch(game, opening) : undefined;
		if (branch?.path) branchPaths.set(branch.path, (branchPaths.get(branch.path) ?? 0) + 1);
		const name = branch ? branch.name : (game.opening?.name ?? "Unclassified");
		const b = branches.get(name) ?? { branch: name, games: 0, analyzedGames: 0, gameIds: [] };
		b.games++;
		if (state.analyses.some((a) => a.gameId === game.id && a.status === "complete"))
			b.analyzedGames++;
		b.gameIds.push(game.id);
		branches.set(name, b);
	}
	if (reference) {
		const relevant = games.flatMap((g) =>
			g.opening?.status === "matched" ? openingReferences(g.opening.name).slice(0, 1) : [],
		);
		const seen = new Set<string>();
		reference.branches = [
			...relevant.map((o) => ({
				name: o.name,
				eco: o.eco,
				pgn: o.pgn,
				fen: o.fen,
				moves: o.moves,
			})),
			...reference.branches,
		]
			.filter((o) => {
				if (seen.has(o.pgn)) return false;
				seen.add(o.pgn);
				return true;
			})
			.slice(0, 16);
	}
	const coveredGames = covered();
	const ready =
		(!opening || !!reference) &&
		(!surveyGames.length || coveredGames.length === surveyGames.length);
	return {
		status: "available",
		receipt: {
			openingRequested: opening || "All openings",
			recognisedOpening: !opening || !!reference,
			timeControl: query.speed ?? "all",
			learnerSide: query.learnerColor ?? "both",
			matchedGames: games.length,
			analyzedGames: games.filter((g) =>
				state.analyses.some((a) => a.gameId === g.id && a.status === "complete"),
			).length,
			branchPaths: [...branchPaths]
				.map(([line, games]) => ({ line, games }))
				.sort((a, b) => b.games - a.games),
			branches: [...branches.values()]
				.sort((a, b) => b.games - a.games)
				.map((b) => ({ ...b, gameIds: b.gameIds.slice(0, 3) })),
			classification:
				"Deterministic matching of validated moves and resulting positions against the vendored CC0 Lichess opening catalogue. Unclassified is explicit; scope membership can be corrected by choosing another opening.",
		},
		pagination: {
			page,
			pageSize,
			total: games.length,
			nextPage: page * pageSize < games.length ? page + 1 : null,
		},
		games: games
			.slice((page - 1) * pageSize, page * pageSize)
			.map((g) => ({
				id: g.id,
				playedAt: g.playedAt,
				white: g.white.name,
				black: g.black.name,
				learnerColor: g.learnerColor,
				speed: g.speed,
				opening: g.opening,
				analysis: state.analyses.find((a) => a.gameId === g.id)?.status ?? "not_analyzed",
				reviewUrl: `/chess?tab=games&gameId=${encodeURIComponent(g.id)}`,
			})),
		referenceCard: reference,
		survey: {
			ready,
			status: ready ? "ready" : state.review?.status === "running" ? "running" : "needs_analysis",
			selectedGames: surveyGames.length,
			coveredGames: coveredGames.length,
			positionBudget: 4,
			requestedLimit: limit,
			actualVerifiedPositions: coveredGames.reduce(
				(n, g) => n + selectOpeningSurveyPlies(g, opening, 4).length,
				0,
			),
			message:
				message ||
				(ready
					? "The scoped sample has verified analysis. Probe into the branches where findings cluster; do not generalise beyond the sampled coverage."
					: "Classify and survey this scope before probing or concluding the probe. Open the scoped game review to run or retry the bounded survey."),
			reviewUrl: `/chess?tab=games&opening=${encodeURIComponent(opening)}&speed=${encodeURIComponent(query.speed ?? "all")}&limit=${limit}`,
			findings: chessMistakeFindings({
				...state,
				games: surveyGames,
				analyses: state.analyses
					.filter((a) => surveyGames.some((g) => g.id === a.gameId))
					.map((a) => ({
						...a,
						positions: a.positions.filter((p) =>
							selectOpeningSurveyPlies(
								surveyGames.find((g) => g.id === a.gameId)!,
								opening,
								4,
							).includes(p.ply),
						),
					})),
			}),
			limits:
				"At most four branch-entry/forcing-risk learner positions per game, depth 12 or 100,000 nodes per search. This is a sampled survey, not full-game coverage. Branch counts include all matching imported games; evidence claims use actually analyzed positions only.",
		},
	};
}
