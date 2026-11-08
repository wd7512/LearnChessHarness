"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useEnterSubmits } from "@/components/enter-submits";
import { Button } from "@/components/ui/button";

import {
	ChessBoardFrame,
	ChessSquareContent,
	chessSquareColor,
	CHESS_PIECE_NAMES as names,
} from "@/components/chess-board-visuals";
import { ChessDiagram } from "@/components/chess-diagram";
import {
	AnswerField,
	ConfidenceControl,
	nearestConfidenceIndex,
} from "@/components/answer-controls";
import { CONFIDENCE_STOPS } from "@/src/core";
import {
	DictationBar,
	finishDictation,
	joinDictation,
	useDictation,
	useDictationTarget,
} from "@/components/dictation";

type ChessBoardProps = {
	question: ChessQuestion;
	draftKey: string;
	onSubmit: (answer: ChessAnswer) => void;
	disabled?: boolean;
	assessment?: "lesson" | "engine";
	voice?: boolean;
	dictationClaim?: boolean;
	keyboardSubmit?: boolean;
	onEscape?: () => void;
};
export function ChessBoard({ voice, ...props }: ChessBoardProps) {
	return voice ? <ChessVoiceBoard {...props} /> : <ChessBoardInput {...props} />;
}
function ChessVoiceBoard(props: ChessBoardProps) {
	const dictation = useDictation({ append: () => {} });
	return (
		<ChessBoardInput
			{...props}
			onEscape={dictation.cancel}
			dictationSlot={<DictationBar dictation={dictation} />}
		/>
	);
}

function ChessBoardInput({
	question,
	draftKey,
	onSubmit,
	disabled = false,
	assessment = "lesson",
	dictationClaim = true,
	keyboardSubmit = true,
	onEscape,
	dictationSlot,
}: ChessBoardProps & { dictationSlot?: React.ReactNode }) {
	const [moves, setMoves] = useState<string[]>([]);
	const [reasoning, setReasoning] = useState("");
	const reasoningRef = useRef("");
	const [submitting, setSubmitting] = useState(false);
	const updateReasoning = useCallback((value: string) => {
		reasoningRef.current = value;
		setReasoning(value);
	}, []);
	useDictationTarget(
		useCallback(
			(value: string) => updateReasoning(joinDictation(reasoningRef.current, value)),
			[updateReasoning],
		),
		dictationClaim && !disabled,
	);

	const [confidence, setConfidence] = useState(50);
	const [selected, setSelected] = useState<Square | null>(null);
	const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
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
				if (typeof saved.reasoning === "string") updateReasoning(saved.reasoning);
				if (
					typeof saved.confidence === "number" &&
					saved.confidence >= 0 &&
					saved.confidence <= 100
				)
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
				localStorage.setItem(
					storageKey,
					JSON.stringify({ uciMoves: moves, reasoning, confidence }),
				);
			} catch {
				/* private browsing can refuse storage */
			}
	}, [ready, moves, reasoning, confidence, storageKey]);
	const state = useMemo(() => replayChessAnswer(question, moves), [question, moves]);
	const board = state.board;
	const targets = selected ? board.moves({ square: selected, verbose: true }).map((m) => m.to) : [];
	const canMove = !disabled && !submitting && !board.isGameOver() && !state.complete;
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
		if (selected === square) {
			setSelected(null);
			setPromotion(null);
			return;
		}
		if (selected && targets.includes(square)) {
			const options = board
				.moves({ square: selected, verbose: true })
				.filter((m) => m.to === square);
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
	function submitAnswer() {
		if (disabled || submitting || !moves.length || !ready || promotion) return;
		setSubmitting(true);
		void finishDictation()
			.then(() => {
				const answer = {
					uciMoves: moves,
					reasoning: reasoningRef.current,
					confidence: CONFIDENCE_STOPS[nearestConfidenceIndex(confidence)]!,
				};
				gradeChessAnswer(question, answer);
				onSubmit(answer);
			})
			.catch(() => setError("Your answer could not be submitted. Please try again."))
			.finally(() => setSubmitting(false));
	}
	useEnterSubmits(() => {
		if (dictationClaim && keyboardSubmit) submitAnswer();
	});

	return (
		<section className="space-y-4" data-testid="chess-board">
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<strong>{status}</strong>
				<span className="text-muted-foreground">
					You play {question.learnerColor} · {question.maxLearnerMoves} learner move
					{question.maxLearnerMoves > 1 ? "s" : ""}
				</span>
			</div>
			<ChessBoardFrame
				orientation={question.learnerColor}
				className="mx-auto w-full max-w-[320px] sm:max-w-[360px]"
			>
				{chessSquares(question.learnerColor).map((square) => {
					const p = board.get(square);
					const last = board.history({ verbose: true }).at(-1);
					return (
						<button
							key={square}
							type="button"
							data-square={square}
							aria-label={`${square}${p ? ` ${p.color === "w" ? "white" : "black"} ${names[p.type]}` : " empty"}${targets.includes(square) ? ", legal destination" : ""}`}
							aria-pressed={selected === square}
							onClick={() => choose(square)}
							disabled={!canMove}
							className="relative flex aspect-square items-center justify-center focus-visible:z-10 focus-visible:outline-4 focus-visible:outline-black disabled:opacity-100"
							style={{ background: chessSquareColor(square) }}
						>
							<ChessSquareContent
								square={square}
								piece={p}
								selected={selected === square}
								target={targets.includes(square)}
								lastMove={last?.from === square || last?.to === square}
							/>
						</button>
					);
				})}
			</ChessBoardFrame>
			{promotion && (
				<div
					role="dialog"
					aria-label="Choose promotion"
					className="flex items-center justify-center gap-2"
				>
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
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<div className="rounded-xl border bg-card">
				<ConfidenceControl
					index={nearestConfidenceIndex(confidence)}
					onChange={(index) => setConfidence(CONFIDENCE_STOPS[index]!)}
					disabled={disabled || submitting}
				/>
				<AnswerField
					value={reasoning}
					onChange={updateReasoning}
					onEscape={onEscape}
					disabled={disabled || submitting}
					readOnly={disabled || submitting}
					canSubmit={!!moves.length && ready && !promotion}
					placeholder="What does your move achieve? What did you check?"
					submitLabel={assessment === "engine" ? "Check continuation" : "Submit answer"}
					dictationSlot={!disabled ? dictationSlot : undefined}
					onSubmit={submitAnswer}
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				{assessment === "engine"
					? "Alternative sound moves can receive credit."
					: "Moves and explanation are assessed separately."}
			</p>
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
	onEscape,
	dictationClaim = true,
}: {
	input: unknown;
	toolCallId: string;
	draftKey?: string;
	expanded: boolean;
	onExpand: () => void;
	onSubmit: (answer: QuestionAnswerData) => void;
	disabled?: boolean;
	onEscape?: () => void;
	dictationClaim?: boolean;
}) {
	const q = parseChessQuestion(input);
	if (!q) return <p role="alert">This chess question is invalid. Request another position.</p>;
	return (
		<>
			{!expanded && <button type="button" onClick={onExpand} className="w-full p-4 text-left text-sm">Chessboard · {q.objective}</button>}
		<div hidden={!expanded} data-dock-scroll-area="" className="max-h-[var(--dock-max-h,75vh)] overflow-y-auto p-4">
			<p className="mb-4 text-sm font-medium">{q.objective}</p>
			<ChessBoard
				key={toolCallId}
				dictationClaim={dictationClaim}
				keyboardSubmit={expanded}
				question={q}
				draftKey={draftKey ?? toolCallId}
				disabled={disabled}
				onEscape={onEscape}
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
		</>
	);
}

export function ChessPosition({
	fen,
	color = "white",
}: {
	fen: string;
	color?: "white" | "black";
}) {
	return (
		<div className="w-48">
			<ChessDiagram
				position={{
					fen,
					orientation: color,
					highlightSquares: [],
					description:
						"Game position. " + (new Chess(fen).turn() === "w" ? "White" : "Black") + " to move.",
				}}
			/>
		</div>
	);
}
