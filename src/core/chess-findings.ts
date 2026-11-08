import { Chess, type Color, type Square } from "chess.js";
import {
	playUci,
	type ChessAnalysis,
	type ChessEvaluation,
	type ChessGame,
	type ChessState,
} from "./chess.ts";
import { chessPositionKey } from "./chess-workflows.ts";

type Position = ChessAnalysis["positions"][number];
export interface MistakeCategory {
	id: string;
	label: string;
	evidence: string;
}
export interface ChessMistake {
	id: string;
	gameId: string;
	ply: number;
	fen: string;
	positionKey: string;
	move: string;
	moveSan: string;
	phase: "opening" | "middlegame" | "endgame";
	lossCp: number | null;
	forcedMate: boolean;
	categories: MistakeCategory[];
	status: "categorized" | "needs-review";
	cause: "Needs tutor probe";
	consequence: string;
	reply: string;
	alternative: string;
	alternativeSan: string;
	engine: string;
}
export interface RepeatedChessMistake {
	id: string;
	fen: string;
	move: string;
	moveSan: string;
	learnerColor: "white" | "black";
	occurrences: number;
	gamesReached: number;
	timesPlayed: number;
	gamesPlayed: number;
	verifiedMistakes: number;
	verifiedGames: number;
	analyzedOccurrences: number;
	medianLossCp: number | null;
	examples: ChessMistake[];
	categories: string[];
	recommendation: string;
}
const values: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const opposite = (side: Color): Color => (side === "w" ? "b" : "w");
function material(board: Chess, side: Color) {
	return board
		.board()
		.flat()
		.reduce((sum, p) => sum + (p ? values[p.type]! * (p.color === side ? 1 : -1) : 0), 0);
}
function line(fen: string, pv: string[]) {
	const board = new Chess(fen);
	const san: string[] = [];
	for (const move of pv.slice(0, 6)) {
		try {
			san.push(playUci(board, move).san);
		} catch {
			return null;
		}
	}
	return { board, san: san.join(" ") };
}
export function isDetectedChessMistake(p: Position, color: "white" | "black") {
	const sign = color === "white" ? 1 : -1;
	return (
		(p.lossCp ?? 0) >= 150 ||
		(p.after.mate !== undefined &&
			p.after.mate * sign < 0 &&
			(p.before.cp !== undefined || (p.before.mate !== undefined && p.before.mate * sign > 0)))
	);
}
function score(e: ChessEvaluation) {
	return e.cp !== undefined
		? `${(e.cp / 100).toFixed(2)} pawns for White`
		: e.mate !== undefined
			? `mate score ${e.mate} from White’s perspective`
			: "an unavailable score";
}
export function categorizeChessMistake(
	game: ChessGame,
	analysis: ChessAnalysis,
	p: Position,
): ChessMistake {
	const before = new Chess(p.before.fen);
	const after = new Chess(p.before.fen);
	const move = game.moves[p.ply - 1]!;
	const played = playUci(after, move);
	const side = game.learnerColor[0] as Color;
	const reply = line(after.fen(), p.after.pv);
	const alternative = line(before.fen(), p.before.pv.length ? p.before.pv : [p.before.bestMove]);
	const categories: MistakeCategory[] = [];
	const forcedMate = p.after.mate !== undefined && p.after.mate * (side === "w" ? 1 : -1) < 0;
	if (forcedMate)
		categories.push({
			id: "mating-net",
			label: "Allows a forced mate",
			evidence: `The verified search after ${played.san} reports ${score(p.after)}.`,
		});
	if (reply && material(reply.board, side) <= material(after, side) - 150)
		categories.push({
			id: "material-loss",
			label: "Material loss in the verified line",
			evidence: `After ${played.san}, ${reply.san} reduces your material balance by ${material(after, side) - material(reply.board, side)} material points (pawn = 100) within this bounded line.`,
		});
	if (p.after.pv.length) {
		try {
			const b = new Chess(after.fen());
			const capture = playUci(b, p.after.pv[0]!);
			const victim = after.get(capture.to);
			if (
				capture.captured &&
				capture.captured !== "p" &&
				victim?.color === side &&
				!after.isAttacked(capture.to, side)
			) {
				categories.push({
					id: "hanging-material",
					label: "Leaves material undefended",
					evidence: `${capture.san} legally captures your undefended ${capture.captured === "q" ? "queen" : capture.captured === "r" ? "rook" : "minor piece"}.`,
				});
				let existingLegalThreat = false;
				const threatFen = before.fen().split(" ");
				threatFen[1] = opposite(side);
				threatFen[3] = "-";
				try {
					playUci(
						new Chess(threatFen.join(" ")),
						capture.from + capture.to + (capture.promotion ?? ""),
					);
					existingLegalThreat = true;
				} catch {
					/* Geometric attacks by pinned pieces do not establish an existing legal threat. */
				}
				if (
					existingLegalThreat &&
					before.get(capture.to)?.type === victim.type &&
					before.isAttacked(capture.to, opposite(side))
				)
					categories.push({
						id: "unanswered-threat",
						label: "Leaves an existing threat unanswered",
						evidence: `The piece on ${capture.to} was already attacked before ${played.san}; the verified reply captures it. This does not establish whether you noticed the threat.`,
					});
			}
			const forkTargets = b
				.board()
				.flat()
				.filter(
					(piece) =>
						piece?.color === side &&
						["k", "q", "r"].includes(piece.type) &&
						b.attackers(piece.square, opposite(side)).includes(capture.to),
				);
			if (forkTargets.length >= 2)
				categories.push({
					id: "fork",
					label: "Allows a fork",
					evidence: `After the legal reply ${capture.san}, the piece on ${capture.to} attacks ${forkTargets.map((piece) => piece!.square).join(" and ")}.`,
				});
		} catch {
			/* Invalid or absent PV is not classification evidence. */
		}
	}
	if (
		alternative &&
		alternative.san &&
		material(alternative.board, side) >= material(before, side) + 150 &&
		p.before.bestMove !== move
	)
		categories.push({
			id: "missed-material",
			label: "Misses a material-winning continuation",
			evidence: `The legal reference line ${alternative.san} gains material in the bounded search. The reason for choosing another move needs a tutor probe.`,
		});
	const pieceCount = before.board().flat().filter(Boolean).length;
	return {
		id: `${game.id}:${p.ply}`,
		gameId: game.id,
		ply: p.ply,
		fen: before.fen(),
		positionKey: chessPositionKey(before.fen()),
		move,
		moveSan: played.san,
		phase: pieceCount <= 8 ? "endgame" : p.ply <= 20 ? "opening" : "middlegame",
		lossCp: p.lossCp,
		forcedMate,
		categories,
		status: categories.length ? "categorized" : "needs-review",
		cause: "Needs tutor probe",
		consequence: `${analysis.engine}: ${played.san} changes the bounded assessment from ${score(p.before)} to ${score(p.after)}.${reply?.san ? ` Verified reply: ${reply.san}.` : " No usable reply line was recorded; review is needed."}`,
		reply: reply?.san ?? "",
		alternative: p.before.bestMove,
		alternativeSan: alternative?.san ?? "",
		engine: analysis.engine,
	};
}
// Immutable imported game records let summaries reuse their position indexes between reads.
const indexes = new Map<string, { key: string; ply: number; move: string }[]>();
function gamePositions(game: ChessGame) {
	const cacheKey = `${game.id}:${game.fingerprint}:${game.learnerColor}:${game.initialFen}:${game.moves.join(" ")}`;
	const existing = indexes.get(cacheKey);
	if (existing) return existing;
	const board = new Chess(game.initialFen);
	const positions: { key: string; ply: number; move: string }[] = [];
	for (const [i, move] of game.moves.entries()) {
		if (board.turn() === game.learnerColor[0])
			positions.push({ key: chessPositionKey(board.fen()), ply: i + 1, move });
		playUci(board, move);
	}
	if (indexes.size >= 1000) indexes.delete(indexes.keys().next().value!);
	indexes.set(cacheKey, positions);
	return positions;
}
export function chessMistakeFindings(state: ChessState) {
	const games = new Map(state.games.map((g) => [g.id, g]));
	const mistakes: ChessMistake[] = [];
	for (const a of state.analyses.filter((a) => a.status === "complete")) {
		const game = games.get(a.gameId);
		if (!game) continue;
		for (const p of a.positions)
			if (isDetectedChessMistake(p, game.learnerColor))
				mistakes.push(categorizeChessMistake(game, a, p));
	}
	const groups = new Map<string, ChessMistake[]>();
	for (const mistake of mistakes) {
		const id = `${games.get(mistake.gameId)!.learnerColor}:${mistake.positionKey}:${mistake.move}`;
		groups.set(id, [...(groups.get(id) ?? []), mistake]);
	}
	const repeated: RepeatedChessMistake[] = [];
	for (const [id, examples] of groups) {
		const verifiedGames = new Set(examples.map((e) => e.gameId)).size;
		if (verifiedGames < 2) continue;
		const first = examples[0]!;
		const color = games.get(first.gameId)!.learnerColor;
		let occurrences = 0;
		let timesPlayed = 0;
		let analyzedOccurrences = 0;
		const reached = new Set<string>();
		const played = new Set<string>();
		for (const game of state.games) {
			if (game.learnerColor !== color) continue;
			for (const p of gamePositions(game))
				if (p.key === first.positionKey) {
					occurrences++;
					reached.add(game.id);
					if (p.move === first.move) {
						timesPlayed++;
						played.add(game.id);
					}
					if (
						state.analyses.some(
							(a) =>
								a.gameId === game.id &&
								a.status === "complete" &&
								a.positions.some((point) => point.ply === p.ply),
						)
					)
						analyzedOccurrences++;
				}
		}
		const losses = examples
			.flatMap((e) => (e.lossCp === null ? [] : [e.lossCp]))
			.sort((a, b) => a - b);
		const medianLossCp = losses.length ? losses[Math.floor(losses.length / 2)]! : null;
		repeated.push({
			id,
			fen: first.fen,
			move: first.move,
			moveSan: first.moveSan,
			learnerColor: color,
			occurrences,
			gamesReached: reached.size,
			timesPlayed,
			gamesPlayed: played.size,
			verifiedMistakes: examples.length,
			verifiedGames,
			analyzedOccurrences,
			medianLossCp,
			examples,
			categories: [...new Set(examples.flatMap((e) => e.categories.map((c) => c.label)))],
			recommendation: `You reached this position in ${reached.size} games and played ${first.moveSan} in ${played.size}. Analysis verifies a costly error in ${verifiedGames} games. Learning one sound response could prevent a recurring loss.`,
		});
	}
	repeated.sort(
		(a, b) =>
			b.verifiedGames - a.verifiedGames ||
			Number(b.examples.some((e) => e.forcedMate)) - Number(a.examples.some((e) => e.forcedMate)) ||
			(b.medianLossCp ?? 0) - (a.medianLossCp ?? 0) ||
			a.id.localeCompare(b.id),
	);
	const categoryGroups = new Map<
		string,
		{ categoryId: string; label: string; examples: ChessMistake[] }
	>();
	for (const mistake of mistakes)
		for (const category of mistake.categories) {
			const group = categoryGroups.get(category.id) ?? {
				categoryId: category.id,
				label: category.label,
				examples: [],
			};
			group.examples.push(mistake);
			categoryGroups.set(category.id, group);
		}
	const categoryPatterns = [...categoryGroups.values()]
		.map((group) => ({
			...group,
			games: new Set(group.examples.map((e) => e.gameId)).size,
			positions: new Set(group.examples.map((e) => e.positionKey)).size,
		}))
		.map((group) => ({
			...group,
			supported: group.games >= 3 && group.positions >= 2,
			conceptId:
				group.categoryId === "fork"
					? "knight-forks"
					: group.categoryId === "mating-net"
						? "king-safety"
						: "piece-safety",
		}));
	return {
		mistakes,
		repeated,
		categoryPatterns,
		unresolved: mistakes.filter((m) => m.status === "needs-review").length,
		limitations:
			"Categories describe verified board events, not why you played a move. Only bounded engine losses and supported rules are detected; unclassified mistakes need review. Repeated positions are matched by pieces, side to move, castling and legal en-passant rights; move counters are not used. Frequencies distinguish game counts from repeated visits within one game.",
	};
}
