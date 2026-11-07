"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import {
	chessSquares,
	gradeChessAnswer,
	parseChessQuestion,
	replayChessAnswer,
	type ChessAnswer,
	type ChessQuestion,
	type QuestionAnswerData,
} from "@/src/core";
import { Button } from "@/components/ui/button";

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
const names: Record<string, string> = {
	k: "king",
	q: "queen",
	r: "rook",
	b: "bishop",
	n: "knight",
	p: "pawn",
};

export function ChessBoard({
	question,
	draftKey,
	onSubmit,
	disabled = false,
	assessment = "lesson",
}: {
	question: ChessQuestion;
	draftKey: string;
	onSubmit: (answer: ChessAnswer) => void;
	disabled?: boolean;
	assessment?: "lesson" | "engine";
}) {
	const [moves, setMoves] = useState<string[]>([]);
	const [reasoning, setReasoning] = useState("");
	const [confidence, setConfidence] = useState(50);
	const [selected, setSelected] = useState<Square | null>(null);
	const [promotion, setPromotion] = useState<{ from: Square; to: Square;
	} | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState("");
	const storageKey = `lh-chess:${draftKey}:${question.fen}:${question.objective}`;
	useEffect(() => {
		try {
			const raw = localStorage.getItem(storageKey);
			if (raw) {
				const saved = JSON.parse(raw) as ChessAnswer;
				if (Array.isArray(saved.uciMoves)) {
					replayChessAnswer(question, saved.uciMoves);
					setMoves(saved.uciMoves);
				}
				if (typeof saved.reasoning === "string") setReasoning(saved.reasoning);
				if (typeof saved.confidence === "number" && saved.confidence >= 0 && saved.confidence <= 100)
					setConfidence(saved.confidence);
			}
		} catch {
			/* stale drafts must never break a lesson */
		}
		setReady(true);
	}, [storageKey, question]);
	useEffect(() => {
		if (ready)
			try {
				localStorage.setItem(storageKey, JSON.stringify({ uciMoves: moves, reasoning, confidence }));
			} catch {
				/* private browsing can refuse storage */
			}
	}, [ready, moves, reasoning, confidence, storageKey]);
	const state = useMemo(() => replayChessAnswer(question, moves), [question, moves]);
	const board = state.board;
	const targets = selected ? board.moves({ square: selected, verbose: true }).map((m) => m.to) : [];
	const canMove = !disabled && !board.isGameOver() && !state.complete;
	const play = (from: Square, to: Square, piece = "") => {
		try {
			const next = [...moves, from + to + piece];
			replayChessAnswer(question, next);
			setMoves(next);
			setSelected(null);
			setPromotion(null);
			setError("");
		} catch {
			setError("That move is not legal in this position.");
		}
	};
	const choose = (square: Square) => {
		if (!canMove) return;
		if (selected && targets.includes(square)) {
			const options = board.moves({ square: selected, verbose: true }).filter((m) => m.to === square);
			if (options.some((m) => m.promotion)) setPromotion({ from: selected, to: square });
			else play(selected, square);
		} else setSelected(board.get(square)?.color === board.turn() ? square : null);
	};
	const status = board.isCheckmate()
		? "Checkmate"
		: board.isStalemate()
			? "Stalemate"
			: board.isDraw()
				? "Draw"
				: `${board.turn() === "w" ? "White" : "Black"} to move${board.isCheck() ? " · check" : ""}`;
	return (
		<section className="space-y-4" data-testid="chess-board">
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<strong>{status}</strong>
				<span className="text-muted-foreground">
					You play {question.learnerColor} · {question.maxLearnerMoves} learner move
					{question.maxLearnerMoves > 1 ? "s" : ""}
				</span>
			</div>
			<div
				className="mx-auto grid w-full max-w-[440px] grid-cols-8 overflow-hidden rounded-lg border border-stone-400"
				role="group"
				aria-label="Chessboard"
			>
				{chessSquares(question.learnerColor).map((square) => {
					const p = board.get(square);
					const dark = (square.charCodeAt(0) + Number(square[1])) % 2 === 0;
					return (
						<button
							key={square}
							type="button"
							data-square={square}
							aria-label={`${square}${p ? ` ${p.color === "w" ? "white" : "black"} ${names[p.type]}` : " empty"}`}
							aria-pressed={selected === square}
							onClick={() => choose(square)}
							disabled={!canMove}
							className="relative flex aspect-square items-center justify-center focus-visible:z-10 focus-visible:outline-4 focus-visible:outline-amber-400 disabled:opacity-100"
							style={{
								background:
									selected === square
										? "#e8c768"
										: targets.includes(square)
											? "#a8bb76"
											: dark
												? "#78866b"
												: "#eee8d5",
								color: p?.color === "w" ? "#fffdf5" : "#202820",
								textShadow:
									p?.color === "w" ? "0 1px 2px #293225, 1px 0 #293225, -1px 0 #293225" : "0 1px 1px #eee8d5",
								lineHeight: 1,
								minHeight: 0,
								fontFamily: "Georgia, serif",
								fontSize: "clamp(25px, 5vw, 43px)",
							}}
						>
							<span aria-hidden>
								{p ? glyphs[p.color + p.type] + "\uFE0E" : targets.includes(square) ? "·" : ""}
							</span>
							<span
								aria-hidden
								className="absolute bottom-0.5 left-1 text-[9px] font-sans"
								style={{ color: dark ? "#fff" : "#405037", textShadow: "none" }}
							>
								{square}
							</span>
						</button>
					);
				})}
			</div>
			{promotion && (
				<div role="dialog" aria-label="Choose promotion" className="flex items-center justify-center gap-2">
					<span>Promote to</span>
					{["q", "r", "b", "n"].map((p) => (
						<Button key={p} onClick={() => play(promotion.from, promotion.to, p)}>
							{names[p]}
						</Button>
					))}
					<Button variant="ghost" onClick={() => setPromotion(null)}>
						Cancel
					</Button>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!moves.length || disabled}
					onClick={() => {
						setMoves(moves.slice(0, -1));
						setSelected(null);
						setPromotion(null);
					}}
				>
					Undo
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => {
						setMoves([]);
						setSelected(null);
						setPromotion(null);
					}}
				>
					Restart
				</Button>
				<span className="text-xs text-muted-foreground">
					{assessment === "engine"
						? "Stockfish compares your move after submission"
						: state.complete
						? "Line complete"
						: state.guided
							? "Fixed opponent replies"
							: "Outside the guided line · legal free play"}
				</span>
			</div>
			<p className="min-h-5 text-sm" aria-label="Move history">
				{board
					.history()
					.map((m, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}${m}`)
					.join(" ") || "Select a piece, then a destination."}
			</p>
			<label className="block text-sm font-medium">
				Your explanation
				<textarea
					aria-label="Your explanation"
					value={reasoning}
					onChange={(e) => setReasoning(e.target.value)}
					disabled={disabled}
					placeholder="What does your move achieve? What did you check?"
					className="mt-2 min-h-20 w-full rounded-lg border bg-background p-3 text-sm font-normal"
				/>
			</label>
			<label className="flex items-center gap-3 text-xs text-muted-foreground">
				Confidence{" "}
				<input
					aria-label="Confidence"
					type="range"
					min="0"
					max="100"
					value={confidence}
					disabled={disabled}
					onChange={(e) => setConfidence(Number(e.target.value))}
				/>
				<span>{confidence}%</span>
			</label>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<div className="flex items-center justify-between gap-3">
				<span className="text-xs text-muted-foreground">
					{assessment === "engine"
						? "Alternative sound moves can receive credit."
						: "Moves and explanation are assessed separately."}
				</span>
				<Button
					disabled={disabled || !moves.length || !ready || !!promotion}
					onClick={() => {
						const answer = { uciMoves: moves, reasoning, confidence };
						gradeChessAnswer(question, answer);
						onSubmit(answer);
					}}
				>
					{assessment === "engine" ? "Check continuation" : "Submit moves"}
				</Button>
			</div>
		</section>
	);
}

export function ChessQuestionDock({
	input,
	toolCallId,
	draftKey,
	expanded,
	onExpand,
	onSubmit,
	disabled,
}: {
	input: unknown;
	toolCallId: string;
	draftKey?: string;
	expanded: boolean;
	onExpand: () => void;
	onSubmit: (answer: QuestionAnswerData) => void;
	disabled?: boolean;
}) {
	const q = parseChessQuestion(input);
	if (!q) return <p role="alert">This chess question is invalid. Request another position.</p>;
	if (!expanded)
		return (
			<button type="button" onClick={onExpand} className="w-full p-4 text-left text-sm">
				Chessboard · {q.objective}
			</button>
		);
	return (
		<div data-dock-scroll-area="" className="max-h-[var(--dock-max-h,75vh)] overflow-y-auto p-4">
			<p className="mb-4 text-sm font-medium">{q.objective}</p>
			<ChessBoard
				key={toolCallId}
				question={q}
				draftKey={draftKey ?? toolCallId}
				disabled={disabled}
				onSubmit={(answer) =>
					onSubmit({
						kind: "chessboard",
						tool: "chessboard",
						questionText: q.objective,
						dontKnow: false,
						answers: [],
						chess: answer,
						thinking: answer.reasoning,
						confidence: answer.confidence,
						answeredAt: new Date().toISOString(),
					})
				}
			/>
		</div>
	);
}

export function ChessPosition({ fen, color = "white" }: { fen: string; color?: "white" | "black";
}) {
	const board = new Chess(fen);
	return (
		<div className="grid w-48 grid-cols-8 overflow-hidden rounded border" aria-label="Game position">
			{chessSquares(color).map((s) => {
				const p = board.get(s);
				return (
					<span
						key={s}
						className="flex aspect-square items-center justify-center text-xl"
						style={{
							background: (s.charCodeAt(0) + Number(s[1])) % 2 === 0 ? "#78866b" : "#eee8d5",
							color: "#182418",
						}}
					>
						{p ? glyphs[p.color + p.type] : ""}
					</span>
				);
			})}
		</div>
	);
}
