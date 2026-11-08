import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { classifyChessOpening, OPENING_SOURCE } from "../core/chess-openings.ts";
import type { ChessState } from "../core/chess.ts";

/** One server owner per profile, as with the rest of LearnHarness. Atomic replacement. */
export class ChessStore {
	constructor(private readonly file: string) {}
	read(): ChessState {
		if (!fs.existsSync(this.file))
			return { version: 1, games: [], analyses: [], connections: [], ratings: [], exercises: [] };
		const state = JSON.parse(fs.readFileSync(this.file, "utf8")) as ChessState;
		if (
			state.version !== 1 ||
			![state.games, state.analyses, state.connections, state.ratings, state.exercises].every(Array.isArray)
		)
			throw new Error("Unsupported or damaged chess data; the file was left intact.");
		return state;
	}
	backfillOpenings() {
		if (!this.read().games.some(g => g.opening?.revision !== OPENING_SOURCE.revision)) return;
		this.update(state => { for (const game of state.games) if (game.opening?.revision !== OPENING_SOURCE.revision) game.opening = classifyChessOpening(game); });
	}
	update(change: (state: ChessState) => void): ChessState {
		const state = this.read();
		change(state);
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		const temp = `${this.file}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
			fs.renameSync(temp, this.file);
		} finally {
			if (fs.existsSync(temp)) fs.unlinkSync(temp);
		}
		return state;
	}
}
