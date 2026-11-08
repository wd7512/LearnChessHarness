import { Chess } from "chess.js";
import { chessSquares, type ChessDiagramData } from "@/src/core";

import {
	ChessBoardFrame,
	ChessSquareContent,
	chessSquareColor,
	CHESS_PIECE_NAMES as pieces,
} from "@/components/chess-board-visuals";
/** Candidate squares have one neutral treatment. No move generation or legality cue is rendered. */
export function ChessDiagram({ position }: { position: ChessDiagramData }) {
	const board = new Chess(position.fen);
	const candidates = new Set(position.highlightSquares);
	return (
		<figure
			data-testid="chess-diagram"
			className="mx-auto my-2 w-full max-w-[180px] sm:max-w-[260px]"
		>
			<ChessBoardFrame orientation={position.orientation} label={position.description} image>
				{chessSquares(position.orientation ?? "white").map((square) => {
					const p = board.get(square);
					const marked = candidates.has(square);
					return (
						<span
							key={square}
							data-square={square}
							data-candidate={marked || undefined}
							aria-label={`${square}${p ? ` ${p.color === "w" ? "White" : "Black"} ${pieces[p.type]}` : " empty"}${marked ? ", candidate square" : ""}`}
							className="relative flex aspect-square items-center justify-center"
							style={{ background: chessSquareColor(square) }}
						>
							<ChessSquareContent square={square} piece={p} candidate={marked} />
						</span>
					);
				})}
			</ChessBoardFrame>
			<figcaption className="mt-1 flex flex-wrap items-center justify-center gap-x-2 text-center text-xs leading-5 text-muted-foreground">
				<span>
					{board.turn() === "w" ? "White" : "Black"} to move
					{candidates.size > 0 ? " · outlined squares are candidates" : ""}
				</span>
				<details className="text-xs leading-5 text-muted-foreground">
					<summary className="cursor-pointer text-center underline underline-offset-2">
						Position description
					</summary>
					<p className="mt-2">{position.description}</p>
				</details>
			</figcaption>
		</figure>
	);
}
