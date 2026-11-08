/** Rebuild the deterministic opening catalogue from the vendored CC0 TSV source. */
import fs from "node:fs";
import path from "node:path";
import { Chess } from "chess.js";
const root = path.resolve(import.meta.dirname, "..");
const source = JSON.parse(
	fs.readFileSync(path.join(root, "public/chess/openings/source.json"), "utf8"),
);
const rows = [];
for (const letter of "abcde") {
	const lines = fs
		.readFileSync(path.join(root, `public/chess/openings/${letter}.tsv`), "utf8")
		.trim()
		.split(/\r?\n/)
		.slice(1);
	for (const line of lines) {
		const [eco, name, pgn] = line.split("\t");
		const board = new Chess();
		board.loadPgn(pgn);
		const moves = board.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ""));
		rows.push([eco, name, pgn, board.fen(), moves.join(" ")]);
	}
}
fs.writeFileSync(
	path.join(root, "src/core/chess-openings-data.json"),
	JSON.stringify({ source, rows }) + "\n",
);
console.log(`Verified ${rows.length} legal CC0 opening lines at ${source.revision}.`);
