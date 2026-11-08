import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Chess } from "chess.js";
import { playUci, type ChessAnalysis, type ChessEvaluation, type ChessGame } from "../core/chess.ts";

export interface ChessEngine {
	name: string;
	evaluate(fen: string): Promise<ChessEvaluation>;
	close(): void;
}
/** An external GPL Stockfish executable, never a model-authored evaluation. */
export class StockfishEngine implements ChessEngine {
	name = "Stockfish (unavailable)";
	private child: ChildProcessWithoutNullStreams;
	private buffer = "";
	private waiters = new Set<(line: string) => void>();
	private failure?: Error;
	constructor(
		private settings = { depth: 12, nodes: 100_000 },
		executable = process.env.STOCKFISH_PATH || "stockfish",
	) {
		this.child = spawn(executable, [], { stdio: "pipe" });
		this.child.on("error", (e) => {
			this.failure = e;
			for (const w of this.waiters) w("__failed__");
		});
		this.child.on("exit", () => {
			this.failure ??= new Error("Stockfish exited before completing the search.");
			for (const w of this.waiters) w("__failed__");
		});
		this.child.stdout.on("data", (chunk) => {
			this.buffer += chunk.toString();
			let index: number;
			while ((index = this.buffer.indexOf("\n")) >= 0) {
				const line = this.buffer.slice(0, index).trim();
				this.buffer = this.buffer.slice(index + 1);
				if (line.startsWith("id name ")) this.name = line.slice(8);
				for (const waiter of this.waiters) waiter(line);
			}
		});
		this.child.stderr.resume();
		this.child.stdin.on("error", () => {
			/* exit/error events carry the failure */
		});
	}
	private command(command: string, done: (line: string) => boolean, collect?: (line: string) => void) {
		return new Promise<void>((resolve, reject) => {
			if (this.failure) {
				reject(this.failure);
				return;
			}
			const cleanup = () => {
				clearTimeout(timer);
				this.waiters.delete(receive);
			};
			const receive = (line: string) => {
				if (line === "__failed__") {
					cleanup();
					reject(this.failure);
					return;
				}
				collect?.(line);
				if (done(line)) {
					cleanup();
					resolve();
				}
			};
			const timer = setTimeout(() => {
				cleanup();
				this.close();
				reject(new Error("Stockfish search timed out."));
			}, 15_000);
			this.waiters.add(receive);
			this.child.stdin.write(command + "\n");
		});
	}
	async ready() {
		await this.command("uci", (l) => l === "uciok");
		if (!/^Stockfish\b/i.test(this.name))
			throw new Error("The configured UCI engine did not identify itself as Stockfish.");
		this.child.stdin.write("setoption name Threads value 1\nsetoption name Hash value 16\n");
		await this.command("isready", (l) => l === "readyok");
	}
	async evaluate(fen: string): Promise<ChessEvaluation> {
		const board = new Chess(fen);
		let evaluation: ChessEvaluation = { fen, bestMove: "", depth: 0, nodes: 0, pv: [] };
		this.child.stdin.write(`position fen ${board.fen()}\n`);
		await this.command(
			`go depth ${this.settings.depth} nodes ${this.settings.nodes}`,
			(l) => l.startsWith("bestmove "),
			(line) => {
				const score = /\bscore (cp|mate) (-?\d+)\b/.exec(line);
				if (line.startsWith("info ") && score && !/\b(lowerbound|upperbound)\b/.test(line)) {
					const value = Number(score[2]) * (board.turn() === "w" ? 1 : -1);
					evaluation = {
						fen,
						bestMove: "",
						depth: Number(/\bdepth (\d+)/.exec(line)?.[1] ?? 0),
						nodes: Number(/\bnodes (\d+)/.exec(line)?.[1] ?? 0),
						pv: (line.split(" pv ")[1] ?? "").split(" ").filter(Boolean),
						...(score[1] === "cp" ? { cp: value } : { mate: value }),
					};
				}
				if (line.startsWith("bestmove ")) evaluation.bestMove = line.split(" ")[1]!;
			},
		);
		if (!board.isGameOver()) {
			playUci(new Chess(fen), evaluation.bestMove);
			if (evaluation.cp === undefined && evaluation.mate === undefined)
				throw new Error("Stockfish returned no exact evaluation.");
		}
		return evaluation;
	}
	close() {
		this.child.kill();
	}
}

function exposedPieces(board: Chess, side: "w" | "b") {
	return board
		.board()
		.flat()
		.filter(
			(p) =>
				p &&
				p.color === side &&
				p.type !== "k" &&
				p.type !== "p" &&
				board.isAttacked(p.square, side === "w" ? "b" : "w") &&
				!board.isAttacked(p.square, side),
		);
}
export async function analyzeChessGame(
	game: ChessGame,
	engine: ChessEngine,
	settings = { depth: 12, nodes: 100_000 },
	sampledPlies?: readonly number[],
): Promise<ChessAnalysis> {
	const result: ChessAnalysis = {
		gameId: game.id,
		status: "complete",
		engine: engine.name,
		settings,
		analyzedAt: new Date().toISOString(),
		positions: [],
	};
	const board = new Chess(game.initialFen);
	for (let ply = 0; ply < game.moves.length; ply++) {
		const learnerMove = board.turn() === game.learnerColor[0] && (!sampledPlies || sampledPlies.includes(ply + 1));
		const beforeBoard = new Chess(board.fen());
		const before = learnerMove ? await engine.evaluate(board.fen()) : null;
		playUci(board, game.moves[ply]!);
		if (!before) continue;
		const after = await engine.evaluate(board.fen());
		const lossCp =
			before.cp === undefined || after.cp === undefined
				? null
				: Math.max(0, (before.cp - after.cp) * (game.learnerColor === "white" ? 1 : -1));
		const opportunityIds = exposedPieces(beforeBoard, game.learnerColor === "white" ? "w" : "b").length
			? ["piece-safety"]
			: [];
		const conceptIds =
			opportunityIds.length &&
			lossCp !== null &&
			lossCp >= 150 &&
			exposedPieces(board, game.learnerColor === "white" ? "w" : "b").length
				? ["piece-safety"]
				: [];
		result.positions.push({ ply: ply + 1, before, after, lossCp, conceptIds, opportunityIds });
	}
	if (sampledPlies) result.coverage = { mode: "opening-survey", sampledPlies: [...sampledPlies], totalLearnerPositions: Math.ceil((game.moves.length - (game.learnerColor === "black" ? 1 : 0)) / 2) };
	return result;
}
