import type { ChessConnection, ChessGame, ChessRating } from "../core/chess.ts";
import { parseChessPgn, pgnGames } from "./chess-import.ts";

export type ChessFetch = typeof fetch;
export interface ChessSyncPayload {
	games: ChessGame[];
	ratings: ChessRating[];
	cursor?: number;
	archiveMonths?: string[];
	warnings: string[];
	coverage: string;
}
const MAX_BYTES = 20 * 1024 * 1024;
export function validateChessUsername(username: string) {
	if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username))
		throw new Error("Enter a public username using 2–30 letters, digits, underscores or hyphens.");
	return username.toLowerCase();
}
async function publicData(url: string, accept: string, fetcher: ChessFetch) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const r = await fetcher(url, {
			headers: {
				Accept: accept,
				"User-Agent":
					"LearnHarness-Chess/0.1 (public game import; https://github.com/wd7512/LearnChessHarness)",
			},
			signal: AbortSignal.timeout(30_000),
			redirect: "error",
			cache: "no-store",
		});
		if ((r.status === 429 || r.status >= 500) && attempt < 2) {
			const raw = r.headers.get("retry-after");
			const requested = raw
				? /^\d+$/.test(raw)
					? Number(raw) * 1000
					: Date.parse(raw) - Date.now()
				: 500 * 2 ** attempt;
			await r.body?.cancel();
			if (requested > 10_000)
				throw new Error(`Platform requested a later retry (${raw}). Existing data is intact.`);
			await new Promise((resolve) => setTimeout(resolve, Math.max(0, requested)));
			continue;
		}
		if (!r.ok) {
			await r.body?.cancel();
			throw new Error(`Public API returned HTTP ${r.status}. Existing data is intact.`);
		}
		if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) {
			await r.body?.cancel();
			throw new Error("Platform response is too large. Use a smaller PGN import.");
		}
		const reader = r.body?.getReader();
		if (!reader) throw new Error("The platform returned an empty response.");
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > MAX_BYTES) throw new Error("Platform response exceeded 20 MiB.");
				chunks.push(value);
			}
		} finally {
			await reader.cancel();
		}
		return Buffer.concat(chunks).toString("utf8");
	}
	throw new Error("Public API retry limit reached.");
}

export async function fetchChessPlatform(
	connection: ChessConnection,
	fetcher: ChessFetch = fetch,
): Promise<ChessSyncPayload> {
	const username = validateChessUsername(connection.username);
	const payload: ChessSyncPayload = { games: [], ratings: [], warnings: [], coverage: "" };
	const parse = (raw: string) => {
		try {
			payload.games.push(
				parseChessPgn(raw, username, connection.platform, `${connection.platform} public API`),
			);
		} catch (e) {
			payload.warnings.push(e instanceof Error ? e.message : "Invalid platform PGN");
		}
	};
	if (connection.platform === "chesscom") {
		const data = JSON.parse(
			await publicData(
				`https://api.chess.com/pub/player/${username}/games/archives`,
				"application/json",
				fetcher,
			),
		) as { archives?: unknown };
		if (
			!Array.isArray(data.archives) ||
			!data.archives.every(
				(a) =>
					typeof a === "string" &&
					new RegExp(`^https://api\\.chess\\.com/pub/player/${username}/games/\\d{4}/\\d{2}$`, "i").test(a),
			)
		)
			throw new Error("Chess.com returned an invalid archive list.");
		// The initial bounded window is explicit; subsequent sync revisits the last two months.
		const months = (data.archives as string[]).slice(-12);
		const recent = months.slice(-2);
		const selected = months.filter((m) => !connection.archiveMonths?.includes(m) || recent.includes(m));
		for (const month of selected) {
			const archive = JSON.parse(await publicData(month, "application/json", fetcher)) as {
				games?: {
					pgn?: string;
					rated?: boolean;
					time_class?: string;
					white?: { result?: string };
					black?: { result?: string };
				}[];
			};
			if (!Array.isArray(archive.games)) throw new Error("Chess.com returned an invalid game archive.");
			for (const entry of archive.games) {
				if (!entry.pgn) continue;
				const count = payload.games.length;
				parse(entry.pgn);
				if (payload.games.length > count) {
					const game = payload.games.at(-1)!;
					game.rated = entry.rated ?? game.rated;
					game.speed = entry.time_class ?? game.speed;
					const outcomes = `${entry.white?.result ?? ""} ${entry.black?.result ?? ""}`;
					if (/abandoned/.test(outcomes)) game.termination = "abandonment";
					else if (/timeout|timevsinsufficient/.test(outcomes)) game.termination = "timeout";
					else if (/resigned/.test(outcomes)) game.termination = "resignation";
				}
			}
		}
		payload.archiveMonths = [...new Set([...(connection.archiveMonths ?? []), ...selected])];
		payload.coverage =
			"The latest 12 archive months; older games can be uploaded as PGN. The latest two months are refreshed for delayed records.";
	} else {
		const since = connection.cursor
			? Math.max(0, connection.cursor - 2 * 86400_000)
			: Date.now() - 365 * 86400_000;
		const query = new URLSearchParams({
			since: String(since),
			until: String(Date.now()),
			max: "500",
			sort: "dateAsc",
			clocks: "true",
			ongoing: "false",
			finished: "true",
		});
		const raw = await publicData(
			`https://lichess.org/api/games/user/${username}?${query}`,
			"application/x-chess-pgn",
			fetcher,
		);
		for (const game of pgnGames(raw)) parse(game);
		if (payload.games.length >= 500)
			payload.warnings.push(
				"The 500-game window is full; upload a PGN export to ensure coverage before relying on trends.",
			);
		const ratingHistory = JSON.parse(
			await publicData(
				`https://lichess.org/api/user/${username}/rating-history`,
				"application/json",
				fetcher,
			),
		) as { name: string; points: number[][] }[];
		if (!Array.isArray(ratingHistory)) throw new Error("Lichess returned invalid rating history.");
		for (const series of ratingHistory) {
			if (!Array.isArray(series.points) || typeof series.name !== "string") continue;
			for (const p of series.points)
				if (p.length === 4 && p.every(Number.isFinite))
					payload.ratings.push({
						platform: "lichess",
						username,
						speed: series.name.toLowerCase(),
						date: new Date(Date.UTC(p[0]!, p[1]!, p[2]!)).toISOString(),
						rating: p[3]!,
						source: "api",
					});
		}
		payload.coverage =
			"Initial game coverage: one year, at most 500 games per sync, oldest first; later syncs include a two-day overlap. API rating history may predate imported games.";
	}
	const stamps = payload.games.flatMap((g) => (g.playedAt ? [Date.parse(g.playedAt)] : []));
	payload.cursor = stamps.length ? Math.max(...stamps, connection.cursor ?? 0) : connection.cursor;
	return payload;
}
