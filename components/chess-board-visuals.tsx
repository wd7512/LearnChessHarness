import type { ReactNode } from "react";
import type { Piece, Square } from "chess.js";

export const CHESS_LIGHT = "#f0d9b5";
export const CHESS_DARK = "#b58863";
export const chessSquareColor = (square: string) =>
	(square.charCodeAt(0) + Number(square[1])) % 2 === 0 ? CHESS_DARK : CHESS_LIGHT;
export const CHESS_PIECE_NAMES: Record<string, string> = {
	k: "king",
	q: "queen",
	r: "rook",
	b: "bishop",
	n: "knight",
	p: "pawn",
};
export function ChessSquareContent({
	square,
	piece,
	selected,
	target,
	lastMove,
	candidate,
}: {
	square: Square;
	piece?: Piece;
	selected?: boolean;
	target?: boolean;
	lastMove?: boolean;
	candidate?: boolean;
}) {
	return (
		<>
			{lastMove && (
				<span
					aria-hidden
					data-marker="last-move"
					className="pointer-events-none absolute inset-[3px] border-2 border-dashed border-black/80"
				/>
			)}
			{candidate && (
				<span
					aria-hidden
					data-marker="candidate"
					className="pointer-events-none absolute inset-[3px] rounded-sm border-2 border-dashed border-black bg-yellow-200/20 shadow-[0_0_0_1px_white]"
				/>
			)}
			{selected && (
				<span
					aria-hidden
					data-marker="selection"
					className="pointer-events-none absolute inset-[2px] border-[3px] border-double border-black bg-yellow-200/25 shadow-[inset_0_0_0_1px_white]"
				/>
			)}
			{piece && (
				<span
					aria-hidden
					data-piece={`${piece.color}${piece.type.toUpperCase()}`}
					className="pointer-events-none absolute inset-[5%] bg-contain bg-center bg-no-repeat"
					style={{
						backgroundImage: `url('/chess/cburnett/${piece.color}${piece.type.toUpperCase()}.svg')`,
					}}
				/>
			)}
			{target && (
				<span
					aria-hidden
					data-marker={piece ? "capture" : "legal-move"}
					className={
						piece
							? "pointer-events-none absolute inset-[3px] rounded-full border-[4px] border-black/70 shadow-[0_0_0_1px_white]"
							: "pointer-events-none absolute size-[28%] rounded-full border border-white bg-black/60"
					}
				/>
			)}
		</>
	);
}

/** Coordinates sit outside the playable squares and never overlap a piece. */
export function ChessBoardFrame({
	orientation = "white",
	children,
	label = "Chessboard",
	image = false,
	className = "",
}: {
	orientation?: "white" | "black";
	children: ReactNode;
	label?: string;
	image?: boolean;
	className?: string;
}) {
	const files = orientation === "white" ? "abcdefgh" : "hgfedcba";
	const ranks = orientation === "white" ? "87654321" : "12345678";
	return (
		<div className={`grid grid-cols-[12px_minmax(0,1fr)] gap-x-1 gap-y-1 ${className}`}>
			<div
				aria-hidden
				className="grid grid-rows-8 text-center font-sans text-[10px] leading-none text-muted-foreground"
			>
				{[...ranks].map((rank) => (
					<span key={rank} className="flex items-center justify-center">
						{rank}
					</span>
				))}
			</div>
			<div
				className="grid grid-cols-8 overflow-hidden rounded border border-black/30"
				role={image ? "img" : "group"}
				aria-label={label}
			>
				{children}
			</div>
			<span aria-hidden />
			<div
				aria-hidden
				className="grid grid-cols-8 text-center font-sans text-[10px] leading-none text-muted-foreground"
			>
				{[...files].map((file) => (
					<span key={file}>{file}</span>
				))}
			</div>
		</div>
	);
}
