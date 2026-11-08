import { classifyChessOpening } from "../core/chess-openings.ts";
import { createHash } from "node:crypto";
import { Chess } from "chess.js";
import type { ChessGame, ChessPlatform, ChessRating, ChessState } from "../core/chess.ts";

export const chessHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function pgnGames(pgn: string): string[] {
	// Headerless movetext is allowed. Event is optional; split at a header after movetext.
	return pgn
		.replace(/^\uFEFF/, "")
		.split(/\n\s*\n(?=\s*\[[A-Za-z0-9_]+\s+")/)
		.map((s) => s.trim())
		.filter(Boolean);
}
function speedOf(tc: string): string {
	const match = /^(\d+)(?:\+(\d+))?$/.exec(tc);
	if (!match) return "unknown";
	const seconds = Number(match[1]) + 40 * Number(match[2] ?? 0);
	return seconds < 180 ? "bullet" : seconds < 600 ? "blitz" : seconds < 3600 ? "rapid" : "classical";
}
export function parseChessPgn(
	rawPgn: string,
	playerId: string,
	platform: ChessPlatform = "manual",
	source = "PGN upload",
): ChessGame {
	const board = new Chess();
	board.loadPgn(rawPgn, { strict: true });
	const h = board.getHeaders();
	if (h.Variant && !/^(standard|chess)$/i.test(h.Variant))
		throw new Error(`Unsupported chess variant: ${h.Variant}.`);
	const player = playerId.trim().toLowerCase();
	const learnerColor =
		h.White?.toLowerCase() === player ? "white" : h.Black?.toLowerCase() === player ? "black" : null;
	if (!learnerColor) throw new Error(`Player “${playerId}” does not match White or Black.`);
	const history = board.history({ verbose: true });
	if (!history.length || !["1-0", "0-1", "1/2-1/2"].includes(h.Result ?? ""))
		throw new Error("Only completed games with a result and legal moves can be imported.");
	const initialFen = history[0]!.before;
	const moves = history.map((m) => m.from + m.to + (m.promotion ?? ""));
	const fingerprint = chessHash(
		JSON.stringify([
			initialFen,
			moves,
			h.White?.toLowerCase(),
			h.Black?.toLowerCase(),
			h.UTCDate ?? h.Date,
			h.UTCTime ?? h.StartTime,
			h.Result,
		]),
	);
	const site = h.Link ?? h.Site ?? "";
	let host = "";
	try {
		host = new URL(site).hostname.toLowerCase();
	} catch {
		/* A PGN Site may be a plain label. */
	}
	const origin =
		platform === "manual"
			? ["chess.com", "www.chess.com"].includes(host)
				? "chesscom"
				: ["lichess.org", "www.lichess.org"].includes(host)
					? "lichess"
					: "manual"
			: platform;
	const siteMatch =
		origin === "chesscom"
			? /chess\.com\/(?:game\/(?:live|daily)\/|live\/game\/)(\d+)/i.exec(site)
			: origin === "lichess"
				? /lichess\.org\/([a-zA-Z0-9]{8})/.exec(site)
				: null;
	const platformGameId = siteMatch?.[1];
	const stamp = `${(h.UTCDate ?? h.Date ?? "").replaceAll(".", "-")}T${h.UTCTime ?? h.StartTime ?? "00:00:00"}Z`;
	const date = Date.parse(stamp);
	const validDate = Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === stamp.slice(0, 10);
	const terminationText = `${h.Termination ?? ""} ${h.EndReason ?? ""}`.toLowerCase();
	const termination: ChessGame["termination"] = board.isCheckmate()
		? "checkmate"
		: board.isStalemate()
			? "stalemate"
			: /abandon/.test(terminationText)
				? "abandonment"
				: /time|flag/.test(terminationText)
					? "timeout"
					: /resign/.test(terminationText)
						? "resignation"
						: h.Result === "1/2-1/2"
							? "draw"
							: "unknown";
	const rating = (s?: string) => (s && /^\d+$/.test(s) ? Number(s) : undefined);
	const positions = new Map(history.map((m, i) => [m.after, i + 1]));
	return {
		opening: classifyChessOpening({ initialFen, moves }),
		id: platformGameId ? `${origin}:${platformGameId}` : fingerprint,
		fingerprint,
		platform: origin,
		platformGameId,
		playerId: player,
		learnerColor,
		playedAt: validDate ? new Date(date).toISOString() : null,
		timeControl: h.TimeControl ?? "unknown",
		speed: speedOf(h.TimeControl ?? ""),
		rated: /\bunrated\b/i.test(h.Event ?? "") ? false : /\brated\b/i.test(h.Event ?? "") ? true : null,
		white: { name: h.White ?? "?", rating: rating(h.WhiteElo) },
		black: { name: h.Black ?? "?", rating: rating(h.BlackElo) },
		result: h.Result!,
		termination,
		initialFen,
		moves,
		clocks: board.getComments().flatMap((c) => {
			const clock = /\[%clk\s+([^\]]+)\]/.exec(c.comment)?.[1];
			return clock ? [{ ply: positions.get(c.fen) ?? 0, clock }] : [];
		}),
		rawPgn,
		provenance: { source, importedAt: new Date().toISOString() },
	};
}

export function ingestChessGames(state: ChessState, games: ChessGame[]) {
	let added = 0;
	for (const game of games) {
		if (
			state.games.some(
				(g) =>
					g.fingerprint === game.fingerprint ||
					(g.platform === game.platform && g.platformGameId && g.platformGameId === game.platformGameId),
			)
		)
			continue;
		state.games.push(game);
		added++;
		const rating = game[game.learnerColor].rating;
		if (game.platform !== "manual" && game.playedAt && rating !== undefined && game.rated === true) {
			state.ratings.push({
				platform: game.platform,
				username: game.playerId,
				speed: game.speed,
				date: game.playedAt,
				rating,
				source: "game",
				gameId: game.id,
			});
		}
	}
	state.games.sort((a, b) => (a.playedAt ?? "").localeCompare(b.playedAt ?? ""));
	return added;
}
export function mergeChessRatings(state: ChessState, ratings: ChessRating[]) {
	for (const r of ratings)
		if (
			!state.ratings.some(
				(old) =>
					old.platform === r.platform &&
					old.username === r.username &&
					old.speed === r.speed &&
					old.date === r.date &&
					old.source === r.source,
			)
		)
			state.ratings.push(r);
}
