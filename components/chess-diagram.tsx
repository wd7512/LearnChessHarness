import { Chess } from "chess.js";
import { chessSquares, type ChessDiagramData } from "@/src/core";

const glyphs: Record<string, string> = {
	wk: "♔",
	wq: "♕",
	wr: "♖",
	wb: "♗",
	wn: "♘",
	wp: "♙",
	bk: "♚",
	bq: "♛",
	br: "♜",
	bb: "♝",
	bn: "♞",
	bp: "♟",
};
const pieces: Record<string, string> = {
	k: "king",
	q: "queen",
	r: "rook",
	b: "bishop",
	n: "knight",
	p: "pawn",
};
/** Candidate squares have one neutral treatment. No move generation or legality cue is rendered. */
export function ChessDiagram({ position }: { position: ChessDiagramData }) {
	const board = new Chess(position.fen);
	const candidates = new Set(position.highlightSquares);
	return (
		<figure data-testid="chess-diagram" className="my-4 w-full max-w-[360px]">
			<div
				className="grid grid-cols-8 overflow-hidden rounded-lg border border-stone-500"
				role="img"
				aria-label={position.description}
			>
				{chessSquares(position.orientation ?? "white").map((square) => {
					const p = board.get(square);
					const marked = candidates.has(square);
					return (
						<span
							key={square}
							data-square={square}
							data-candidate={marked || undefined}
							aria-label={`${square}${p ? ` ${p.color === "w" ? "White" : "Black"} ${pieces[p.type]}` : " empty"}${marked ? ", candidate square" : ""}`}
							className="relative flex aspect-square items-center justify-center text-3xl"
							style={{
								background: marked
									? "#d7b864"
									: (square.charCodeAt(0) + Number(square[1])) % 2 === 0
										? "#78866b"
										: "#eee8d5",
								color: p?.color === "w" ? "#fffdf5" : "#182418",
								textShadow:
									p?.color === "w" ? "0 1px 2px #293225, 1px 0 #293225, -1px 0 #293225" : "none",
								fontFamily: "Georgia, serif",
								lineHeight: 1,
							}}
						>
							<span aria-hidden>{p ? glyphs[p.color + p.type] + "\uFE0E" : ""}</span>
							<span
								aria-hidden
								className="absolute bottom-1 left-1 text-[9px] font-sans"
								style={{ color: "#243020", textShadow: "none" }}
							>
								{square}
							</span>
						</span>
					);
				})}
			</div>
			<figcaption className="mt-2 text-xs leading-5 text-muted-foreground">
				{position.description}
				{candidates.size > 0 && " Highlighted squares are candidates, without a legality hint."}
			</figcaption>
		</figure>
	);
}
