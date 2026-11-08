import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PATHS } from "../../config.ts";
import { ChessStore } from "../store/chess.ts";
import { CHESS_CONCEPTS, CHESS_OPENINGS } from "../core/chess-curriculum.ts";
import {
	chessWeaknesses,
	gradeChessAnswer,
	parseChessQuestion,
	type ChessAnswer,
	type ChessConnection,
	type ChessGame,
} from "../core/chess.ts";
import { chessHash, ingestChessGames, mergeChessRatings, parseChessPgn, pgnGames } from "./chess-import.ts";
import {
	fetchChessPlatform,
	validateChessUsername,
	type ChessFetch,
	type ChessSyncPayload,
} from "./chess-platforms.ts";
import {
	type ChessEngineProvider,
	stockfishRuntime,
	StockfishUnavailable,
} from "./chess-engine.ts";
import { analyzeStoredChessGame, ChessReviewer } from "./chess-review.ts";
import { ChessMistakes } from "./chess-mistakes.ts";
import { chessMistakeFindings } from "../core/chess-findings.ts";
import { reviewChessState } from "../core/chess-workflows.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
import { type LhMessage } from "../core/native-messages.ts";

const platform = z.enum(["chesscom", "lichess"]);
const bodySchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("reviewStart"),
		speed: z.string().max(30),
		limit: z.number().int().min(1).max(100),
		reanalyze: z.boolean().optional(),
		opening: z.string().max(150).optional(),
		learnerColor: z.enum(["white", "black"]).optional(),
		mode: z.literal("opening-survey").optional(),
		positionsPerGame: z.number().int().min(1).max(4).optional(),
	}),
	z.object({ action: z.literal("reviewCancel") }),
	z.object({
		action: z.literal("mistakeStart"),
		speed: z.string().max(30),
		limit: z.number().int().min(1).max(100),
		findingId: z.string().max(250).optional(),
		opening: z.string().max(150).optional(),
	}),
	z.object({
		action: z.literal("mistakeAnswer"),
		sessionId: z.string(),
		itemId: z.string(),
		move: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
		reasoning: z.string().max(20_000).optional(),
	}),
	z.object({
		action: z.literal("import"),
		pgn: z
			.string()
			.min(1)
			.max(10 * 1024 * 1024),
		playerId: z.string().min(1).max(80),
		source: z.string().max(200).optional(),
	}),
	z.object({ action: z.literal("analyze"), gameId: z.string().max(100) }),
	z.object({
		action: z.literal("preview"),
		platform,
		username: z.string(),
		autoSync: z.boolean().optional(),
	}),
	z.object({ action: z.literal("connect"), previewId: z.string() }),
	z.object({ action: z.literal("sync"), platform, username: z.string() }),
	z.object({
		action: z.literal("disconnect"),
		platform,
		username: z.string(),
		clearData: z.boolean().optional(),
	}),
	z.object({
		action: z.literal("exercise"),
		question: z.unknown(),
		answer: z.object({
			uciMoves: z.array(z.string()).min(1).max(64),
			reasoning: z.string().max(20000).optional(),
			confidence: z.number().min(0).max(100).optional(),
		}),
	}),
]);

export class ChessService {
	readonly reviewer: ChessReviewer;
	readonly mistakes: ChessMistakes;
	private previews = new Map<
		string,
		{ connection: ChessConnection; payload: ChessSyncPayload; expires: number }
	>();
	private busy = new Set<string>();
	constructor(
		readonly store: ChessStore,
		private fetcher: ChessFetch = fetch,
		readonly engineRuntime: ChessEngineProvider = stockfishRuntime,
	) {
		this.reviewer = new ChessReviewer(store, engineRuntime);
		this.mistakes = new ChessMistakes(store, engineRuntime);
	}
	snapshot() {
		this.store.backfillOpenings();
		this.reviewer.recover();
		const state = this.store.read();
		return {
			...state,
			weaknesses: chessWeaknesses(state),
			mistakeFindings: chessMistakeFindings(state),
			scopedMistakes: state.review ? chessMistakeFindings(reviewChessState(state)) : null,
			concepts: CHESS_CONCEPTS,
			openings: CHESS_OPENINGS,
			reviewFindings: state.review ? chessWeaknesses(reviewChessState(state)) : [],
		};
	}
	async mutate(raw: unknown) {
		const input = bodySchema.parse(raw);
		if (input.action === "reviewStart") {
			if (this.busy.has("analysis"))
				throw new Error(
					"An individual game analysis is running. Wait for it to finish before reviewing a group.",
				);
			return this.reviewer.start(input);
		}
		if (input.action === "reviewCancel") {
			this.reviewer.cancel();
			return { cancelled: true };
		}
		if (input.action === "mistakeStart") return this.mistakes.start(input);
		if (input.action === "mistakeAnswer")
			return this.mistakes.answer(input.sessionId, input.itemId, input.move, input.reasoning);
		if (input.action === "import") {
			const games: ChessGame[] = [];
			const rejected: string[] = [];
			const chunks = pgnGames(input.pgn);
			if (chunks.length > 5000) throw new Error("Import at most 5000 games at a time.");
			for (const [index, pgn] of chunks.entries()) {
				try {
					games.push(parseChessPgn(pgn, input.playerId, "manual", input.source ?? "PGN upload"));
				} catch (e) {
					rejected.push(`Game ${index + 1}: ${e instanceof Error ? e.message : "Invalid PGN"}`);
				}
			}
			let added = 0;
			this.store.update((s) => {
				added = ingestChessGames(s, games);
			});
			return { added, duplicates: games.length - added, rejected };
		}
		if (input.action === "exercise") return this.recordExercise(input.question, input.answer);
		if (input.action === "analyze") {
			if (this.busy.has("analysis") || this.reviewer.running)
				throw new Error("A game analysis is already running. Try again when it finishes.");
			const game = this.store.read().games.find((g) => g.id === input.gameId);
			if (!game) throw new Error("Game not found.");
			if (game.moves.length > 600) throw new Error("This game exceeds the 600-ply analysis limit.");
			this.busy.add("analysis");
			try {
				return await analyzeStoredChessGame(this.store, this.engineRuntime, game.id);
			} catch (e) {
				const analysis = {
					gameId: game.id,
					status: "unavailable" as const,
					engine: "Stockfish unavailable",
					settings: { depth: 12, nodes: 100_000 },
					analyzedAt: new Date().toISOString(),
					positions: [],
					message:
						e instanceof StockfishUnavailable
							? e.message
							: "Stockfish could not complete this analysis. Existing games and successful analyses are preserved. Check Settings → Chess engine and retry.",
					setupUrl: "/chess/setup",
				};
				// A failed retry never replaces an existing successful analysis.
				this.store.update((s) => {
					if (
						s.games.some((g) => g.id === game.id) &&
						!s.analyses.some((a) => a.gameId === game.id && a.status === "complete")
					)
						s.analyses = [...s.analyses.filter((a) => a.gameId !== game.id), analysis];
				});
				return analysis;
			} finally {
				this.busy.delete("analysis");
			}
		}
		if (input.action === "connect") {
			const preview = this.previews.get(input.previewId);
			if (!preview || preview.expires < Date.now())
				throw new Error("This preview expired. Preview the account again.");
			let added = 0;
			this.store.update((s) => {
				added = ingestChessGames(s, preview.payload.games);
				mergeChessRatings(s, preview.payload.ratings);
				const c = {
					...preview.connection,
					status: preview.payload.warnings.length ? ("partial" as const) : ("success" as const),
					cursor: preview.payload.cursor,
					archiveMonths: preview.payload.archiveMonths,
					lastSync: new Date().toISOString(),
					message: [preview.payload.coverage, ...preview.payload.warnings].join(" "),
				};
				s.connections = [
					...s.connections.filter((old) => old.platform !== c.platform || old.username !== c.username),
					c,
				];
			});
			this.previews.delete(input.previewId);
			return { added };
		}
		const username = validateChessUsername(input.username);
		const key = `${input.platform}:${username}`;
		if (this.busy.has(key)) throw new Error("This account is already syncing.");
		if (input.action === "disconnect") {
			this.store.update((s) => {
				s.connections = s.connections.filter((c) => c.platform !== input.platform || c.username !== username);
				if (input.clearData) {
					const ids = new Set(
						s.games
							.filter(
								(g) =>
									g.platform === input.platform &&
									g.playerId === username &&
									g.provenance.source === `${input.platform} public API`,
							)
							.map((g) => g.id),
					);
					s.games = s.games.filter((g) => !ids.has(g.id));
					s.analyses = s.analyses.filter((a) => !ids.has(a.gameId));
					s.ratings = s.ratings.filter(
						(r) =>
							r.platform !== input.platform ||
							r.username !== username ||
							(r.source === "game" && !!r.gameId && !ids.has(r.gameId)),
					);
				}
			});
			return { disconnected: true };
		}
		const connection: ChessConnection =
			input.action === "sync"
				? (this.store
						.read()
						.connections.find((c) => c.platform === input.platform && c.username === username) ??
					(() => {
						throw new Error("Connect this public account first.");
					})())
				: { platform: input.platform, username, status: "idle", autoSync: input.autoSync ?? false };
		this.busy.add(key);
		try {
			if (input.action === "sync")
				this.store.update((s) => {
					const c = s.connections.find((c) => c.platform === input.platform && c.username === username);
					if (c) c.status = "syncing";
				});
			const payload = await fetchChessPlatform(connection, this.fetcher);
			if (input.action === "preview") {
				for (const [id, value] of this.previews) if (value.expires < Date.now()) this.previews.delete(id);
				if (this.previews.size >= 20)
					throw new Error("Too many pending previews. Confirm or wait for a preview to expire.");
				const previewId = randomUUID();
				this.previews.set(previewId, { connection, payload, expires: Date.now() + 10 * 60_000 });
				return {
					previewId,
					games: payload.games.length,
					timeControls: [...new Set(payload.games.map((g) => g.speed))],
					warnings: payload.warnings,
					coverage: payload.coverage,
				};
			}
			let added = 0;
			this.store.update((s) => {
				const c = s.connections.find((c) => c.platform === input.platform && c.username === username);
				if (!c) throw new Error("This account was disconnected during sync.");
				added = ingestChessGames(s, payload.games);
				mergeChessRatings(s, payload.ratings);
				Object.assign(c, {
					status: payload.warnings.length ? "partial" : "success",
					lastSync: new Date().toISOString(),
					cursor: payload.cursor,
					archiveMonths: payload.archiveMonths,
					message: [payload.coverage, ...payload.warnings].join(" "),
				});
			});
			return { added, warnings: payload.warnings };
		} catch (e) {
			if (input.action === "sync")
				this.store.update((s) => {
					const c = s.connections.find((c) => c.platform === input.platform && c.username === username);
					if (c) {
						c.status = "failed";
						c.message = e instanceof Error ? e.message : "Sync failed";
					}
				});
			throw e;
		} finally {
			this.busy.delete(key);
		}
	}
	recordExercise(
		raw: unknown,
		answer: ChessAnswer,
		id: string = randomUUID(),
		answeredAt = new Date().toISOString(),
	) {
		const question = parseChessQuestion(raw);
		if (!question) throw new Error("Invalid chess exercise.");
		const grade = gradeChessAnswer(question, answer);
		const positionKey = chessHash(question.fen.split(" ").slice(0, 4).join(" "));
		let independent = false;
		this.store.update((s) => {
			const existing = s.exercises.find((e) => e.id === id);
			if (existing) {
				independent = existing.independent;
				return;
			}
			const knownExample = CHESS_CONCEPTS.some((c) =>
				c.illustrativeFens.some((fen) => chessHash(fen.split(" ").slice(0, 4).join(" ")) === positionKey),
			);
			independent =
				question.heldOut === true && !knownExample && !s.exercises.some((e) => e.positionKey === positionKey);
			s.exercises.push({
				id,
				positionKey,
				conceptIds: question.expectedConceptIds ?? [],
				answeredAt,
				moveGrade: grade.moveGrade,
				explanationGrade: grade.explanationGrade,
				heldOut: question.heldOut === true,
				independent,
				question,
				answer,
			});
			// Sessions can be projected in any order. Earliest recorded exposure wins.
			const attempts = s.exercises
				.filter((e) => e.positionKey === positionKey)
				.sort((a, b) => a.answeredAt.localeCompare(b.answeredAt) || a.id.localeCompare(b.id));
			attempts.forEach((event, index) => {
				event.independent = event.heldOut && !knownExample && index === 0;
			});
			independent = attempts.find((e) => e.id === id)!.independent;
		});
		return { ...grade, independent };
	}
	/** Recover analytics from canonical saved sessions, including answers made before an analytics write failed. */
	projectSession(chatId: string, messages: readonly LhMessage[]) {
		const known = new Set(this.store.read().exercises.map((e) => e.id));
		const calls = new Map<string, { question: unknown }>();
		for (const m of messages) {
			if (m.role === "assistant")
				for (const b of m.content)
					if (b.type === "toolCall" && (b.name === "chessboard" || b.name === "problem"))
						calls.set(b.id, {
							question: b.name === "problem" ? (b.arguments as { chess?: unknown })?.chess : b.arguments,
						});
			if (m.role === "toolResult" && m.toolName === "chessboard" && !m.isError) {
				const a = m.details as { chess?: ChessAnswer; dismissed?: boolean } | undefined;
				const id = `${chatId}:${m.toolCallId}`;
				if (a?.chess && !a.dismissed && calls.has(m.toolCallId) && !known.has(id)) {
					this.recordExercise(
						calls.get(m.toolCallId)!.question,
						a.chess,
						id,
						new Date(m.timestamp).toISOString(),
					);
					known.add(id);
				}
			}
			if (m.role === "custom" && m.customType === "practice-thinking") {
				const detail = m.details as { problemCallId?: string; text?: string };
				const id = `${chatId}:${m.id}`;
				if (!detail?.problemCallId || !detail.text || known.has(id)) continue;
				let answer: ChessAnswer | undefined;
				try {
					answer = JSON.parse(detail.text).chessAnswer;
				} catch {
					continue;
				}
				if (answer && calls.has(detail.problemCallId)) {
					this.recordExercise(
						calls.get(detail.problemCallId)!.question,
						answer,
						id,
						new Date(m.timestamp).toISOString(),
					);
					known.add(id);
				}
			}
		}
	}
}

const chessGlobal = globalThis as typeof globalThis & { __lhChess?: ChessService;
};
export const chessService = (chessGlobal.__lhChess ??= new ChessService(
	new ChessStore(path.join(PATHS.data, "chess", "history.json")),
));
export async function chessMutationResponse(req: Request) {
	if (
		req.headers.get("origin") !== subscriptionRequestOrigin(req) ||
		req.headers.get("sec-fetch-site") === "cross-site" ||
		!req.headers.get("content-type")?.startsWith("application/json")
	)
		return Response.json({ error: "Same-origin JSON is required." }, { status: 403 });
	if (Number(req.headers.get("content-length") ?? 0) > 12 * 1024 * 1024)
		return Response.json({ error: "Request exceeds 12 MiB." }, { status: 413 });
	try {
		return Response.json(await chessService.mutate(await req.json()));
	} catch (e) {
		if (e instanceof StockfishUnavailable)
			return Response.json(
				{
					error: e.message,
					code: e.code,
					engineStatus: e.engineStatus,
					setupUrl: e.engineStatus.setupUrl,
				},
				{ status: 503 },
			);
		return Response.json(
			{ error: e instanceof Error ? e.message : "Chess operation failed" },
			{ status: 400 },
		);
	}
}
