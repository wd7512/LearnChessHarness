import { Chess } from "chess.js";
import data from "./chess-openings-data.json" with { type: "json" };
import type { ChessGame } from "./chess.ts";

export const OPENING_SOURCE = data.source;
export interface OpeningClassification {
	status: "matched" | "unclassified" | "nonstandard-start";
	eco: string | null;
	name: string;
	matchedPly: number;
	revision: string;
}
export const OPENING_CATALOG = data.rows.map(([eco, name, pgn, fen, uci]) => ({
	eco: eco!,
	name: name!,
	pgn: pgn!,
	fen: fen!,
	key: fen!.split(" ").slice(0, 4).join(" "),
	moves: uci!.split(" "),
}));
const byPosition = new Map<string, (typeof OPENING_CATALOG)[number][]>();
for (const opening of OPENING_CATALOG)
	byPosition.set(opening.key, [...(byPosition.get(opening.key) ?? []), opening]);
const MAX_OPENING_PLIES = Math.max(...OPENING_CATALOG.map((o) => o.moves.length));
const normalized = (text: string) =>
	text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const keyOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
const trails = new Map<
	string,
	{ ply: number; key: string; fen: string; move?: string; san?: string }[]
>();
function trail(game: Pick<ChessGame, "initialFen" | "moves">) {
	const id = game.initialFen + "|" + game.moves.slice(0, MAX_OPENING_PLIES + 1).join(" ");
	const saved = trails.get(id);
	if (saved) return saved;
	const b = new Chess(game.initialFen);
	const result = [{ ply: 0, key: keyOf(b.fen()), fen: b.fen() }] as {
		ply: number;
		key: string;
		fen: string;
		move?: string;
		san?: string;
	}[];
	for (const [i, uci] of game.moves.slice(0, MAX_OPENING_PLIES + 1).entries()) {
		const move = b.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
		result.push({ ply: i + 1, key: keyOf(b.fen()), fen: b.fen(), move: uci, san: move.san });
	}
	if (trails.size >= 2000) trails.delete(trails.keys().next().value!);
	trails.set(id, result);
	return result;
}
export function classifyChessOpening(
	game: Pick<ChessGame, "initialFen" | "moves">,
): OpeningClassification {
	if (keyOf(game.initialFen) !== keyOf(new Chess().fen()))
		return {
			status: "nonstandard-start",
			eco: null,
			name: "Nonstandard starting position — opening not established",
			matchedPly: 0,
			revision: OPENING_SOURCE.revision,
		};
	let best: (typeof OPENING_CATALOG)[number] | undefined;
	let matchedPly = 0;
	for (const p of trail(game))
		for (const candidate of byPosition.get(p.key) ?? []) {
			if (!best || candidate.moves.length > best.moves.length) {
				best = candidate;
				matchedPly = p.ply;
			}
		}
	return {
		status: best ? "matched" : "unclassified",
		eco: best?.eco ?? null,
		name: best?.name ?? "Unclassified opening — needs review",
		matchedPly,
		revision: OPENING_SOURCE.revision,
	};
}
const referenceCache = new Map<string, typeof OPENING_CATALOG>();
const matchCache = new Map<string, Set<string>>();
export function openingReferences(query: string) {
	const term = normalized(query === "KG" || query === "kg" ? "King's Gambit" : query);
	const existing = referenceCache.get(term);
	if (existing) return existing;
	const result = OPENING_CATALOG.filter(
		(o) => normalized(o.name).startsWith(term) || normalized(o.eco) === term,
	).sort((a, b) => a.moves.length - b.moves.length || a.name.localeCompare(b.name));
	if (referenceCache.size > 500) referenceCache.clear();
	referenceCache.set(term, result);
	return result;
}
export function openingReferenceCard(query: string) {
	const references = openingReferences(query);
	const root = references[0];
	if (!root) return null;
	return {
		title: root.name,
		eco: root.eco,
		startingLine: root.pgn,
		fen: root.fen,
		source: {
			...OPENING_SOURCE,
			url: `${OPENING_SOURCE.repository}/tree/${OPENING_SOURCE.revision}`,
			licence: "CC0-1.0",
		},
		branches: references
			.slice(0, 16)
			.map((o) => ({ name: o.name, eco: o.eco, pgn: o.pgn, fen: o.fen, moves: o.moves })),
		totalReferences: references.length,
		authority:
			"These opening names and move sequences come from the cited CC0 catalogue and are checked with chess.js. They do not establish which move is best, empirical frequencies, or tactical evaluations. Use actual corpus counts and Stockfish evidence for those claims.",
	};
}
export function matchesChessOpening(game: ChessGame, query?: string) {
	if (!query?.trim()) return true;
	const references = openingReferences(query);
	if (!references.length) return false;
	const cacheKey = normalized(query);
	let positions = matchCache.get(cacheKey);
	if (!positions) {
		positions = new Set(references.map((o) => o.key));
		if (matchCache.size > 500) matchCache.clear();
		matchCache.set(cacheKey, positions);
	}
	return trail(game).some((p) => positions!.has(p.key));
}
export function openingBranch(game: ChessGame, query: string) {
	const root = openingReferences(query)[0];
	if (!root) return { name: "Unrecognised scope", ply: 0 };
	const positions = trail(game);
	const hit = positions.findIndex((p) => p.key === root.key);
	if (hit < 0) return { name: "Transposed branch", ply: 0 };
	const next = positions[hit + 1];
	return {
		name: next
			? `${Math.floor(root.moves.length / 2) + 1}${root.moves.length % 2 ? "..." : "."}${next.san}`
			: "No reply recorded",
		ply: next?.ply ?? positions[hit]!.ply,
		path: positions
			.slice(hit + 1, hit + 5)
			.map(
				(p, i) =>
					`${Math.floor((root.moves.length + i) / 2) + 1}${(root.moves.length + i) % 2 ? "..." : "."}${p.san}`,
			)
			.join(" "),
	};
}
export function openingScopeFromText(text: string) {
	const term = normalized(text);
	const names = [...new Set(OPENING_CATALOG.map((o) => o.name.split(":")[0]!))].sort(
		(a, b) => b.length - a.length,
	);
	const exact = names.find((name) => term.includes(normalized(name)));
	if (exact) return exact;
	if (/(?:king'?s? gambit|\bkg\b)/.test(term)) return "King's Gambit";
	// Language names such as French and Hungarian are also opening shorthand.
	// Only expand those first-word aliases when the request supplies chess context.
	if (!/\b(?:chess|openings?|games?|corpus|blitz|rapid|bullet|classical|lichess)\b/.test(term))
		return undefined;
	const words = new Set(term.split(/[^a-z]+/));
	const prefixes = new Map<string, string[]>();
	for (const name of names) {
		const first = normalized(name).split(" ")[0]!;
		prefixes.set(first, [...(prefixes.get(first) ?? []), name]);
	}
	return [...prefixes].find(
		([word, roots]) => word.length >= 5 && words.has(word) && roots.length === 1,
	)?.[1][0];
}

/** Deterministic bounded survey: branch entry, then positions with forcing risk in the opening. */
export function selectOpeningSurveyPlies(game: ChessGame, opening: string, limit = 4) {
	const branchPly = opening ? openingBranch(game, opening).ply : 0;
	const board = new Chess(game.initialFen);
	const candidates: { ply: number; risk: number }[] = [];
	for (const [i, uci] of game.moves.entries()) {
		if (
			board.turn() === game.learnerColor[0] &&
			i + 1 >= branchPly &&
			i < Math.max(24, branchPly + 12)
		) {
			const side = board.turn();
			const risk =
				board
					.board()
					.flat()
					.filter(
						(p) =>
							p &&
							p.color === side &&
							p.type !== "k" &&
							board.isAttacked(p.square, side === "w" ? "b" : "w") &&
							!board.isAttacked(p.square, side),
					)
					.reduce((n, p) => n + { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 }[p!.type], 0) +
				(board.isCheck() ? 10 : 0);
			candidates.push({ ply: i + 1, risk });
		}
		board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
	}
	const first = candidates[0];
	if (!first) return [];
	return [
		first.ply,
		...candidates
			.slice(1)
			.sort((a, b) => b.risk - a.risk || a.ply - b.ply)
			.slice(0, limit - 1)
			.map((p) => p.ply),
	].sort((a, b) => a - b);
}
