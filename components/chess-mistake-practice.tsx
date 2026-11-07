"use client";
import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import { ChessBoard } from "@/components/chess-board";
import { ChessDiagram } from "@/components/chess-diagram";
import { Button } from "@/components/ui/button";
import {
	type ChessState,
	type ChessQuestion,
	type ChessPracticeFeedback,
	type ChessPracticeItem,
} from "@/src/core";
import { GAME_TYPES, type ChessMutation } from "@/components/chess-review-workflow";

export function ChessMistakePractice({
	state,
	available,
	busy,
	mutate,
	onReview,
	onDiscuss,
	initialSessionId,
}: {
	state: ChessState;
	available: boolean;
	busy: boolean;
	mutate: ChessMutation;
	onReview: () => void;
	onDiscuss: (item: ChessPracticeItem, feedback: ChessPracticeFeedback) => void;
	initialSessionId?: string;
}) {
	const [sessionId, setSessionId] = useState(initialSessionId ?? "");
	const [index, setIndex] = useState(0);
	const [attempt, setAttempt] = useState(0);
	const [message, setMessage] = useState("");
	const [speed, setSpeed] = useState("all");
	const [feedback, setFeedback] = useState<ChessPracticeFeedback | null>(null);
	const session = state.mistakeSessions?.find((s) => s.id === sessionId);
	const item = session?.items[index];
	const question = useMemo<ChessQuestion | undefined>(() => {
		if (!item) return;
		const board = new Chess(item.fen);
		return {
			fen: item.fen,
			learnerColor: item.learnerColor,
			objective:
				"Find a sound continuation. The original move and engine reference stay hidden until you answer.",
			maxLearnerMoves: 1,
			opponent: { mode: "fixed", moves: [] },
			acceptableLines: board
				.moves({ verbose: true })
				.map((m) => [m.from + m.to + (m.promotion ?? "")]),
			rubric:
				"The server compares this move using real Stockfish, independently of the lesson line.",
			expectedConceptIds: [item.conceptId],
			heldOut: item.kind === "unseen",
		};
	}, [item]);
	async function start() {
		const r = await mutate(
			{ action: "mistakeStart", speed, limit: 100 },
			"Preparing positions from your analyzed games…",
		);
		if (r) {
			setMessage(r.message ?? "");
			setSessionId(r.sessionId);
			setIndex(0);
			setFeedback(null);
			setAttempt(0);
		}
	}
	function change(next: number) {
		setIndex(next);
		setFeedback(null);
		setAttempt((n) => n + 1);
	}
	return (
		<section data-testid="mistake-practice" className="space-y-6">
			<div>
				<h2 className="font-serif text-3xl">Practise my mistakes</h2>
				<p className="mt-3 text-xs leading-6 text-muted-foreground">
					Revisit the exact position before your move, then compare your choice with verified
					analysis. Separate, unused positions test transfer. Personal game positions and retries
					are remembered practice, not unseen results.
				</p>
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<label className="text-xs">
					Practice game type
					<select
						aria-label="Practice game type"
						value={speed}
						onChange={(e) => setSpeed(e.target.value)}
						className="mt-2 block rounded border bg-card p-2.5"
					>
						{GAME_TYPES.map(([v, label]) => (
							<option key={v} value={v}>
								{label}
							</option>
						))}
					</select>
				</label>
				<Button
					disabled={!available || busy || state.review?.status === "running"}
					onClick={() => void start()}
				>
					Start mistake practice
				</Button>
				<Button variant="outline" onClick={onReview}>
					Review games first
				</Button>
			</div>
			{message && (
				<p role="status" className="text-xs leading-6 text-muted-foreground">
					{message}
				</p>
			)}
			{(state.mistakeSessions ?? []).length > 0 && (
				<details className="rounded-lg border p-4 text-xs">
					<summary className="cursor-pointer">Previous practice sessions</summary>
					<div className="mt-3 space-y-2">
						{[...(state.mistakeSessions ?? [])]
							.reverse()
							.slice(0, 10)
							.map((s) => (
								<button
									key={s.id}
									className="block text-left underline"
									onClick={() => {
										setSessionId(s.id);
										const next = s.items.findIndex(
											(i) => !s.attempts.some((a) => a.itemId === i.id),
										);
										change(next < 0 ? 0 : next);
									}}
								>
									{new Date(s.createdAt).toLocaleDateString("en-GB")} · {s.attempts.length} attempts
									· {s.items.length} positions · resume or revisit
								</button>
							))}
					</div>
				</details>
			)}
			{item && question && session && (
				<article className="space-y-5 rounded-xl border bg-card p-5">
					<div>
						<p className="text-[10px] uppercase tracking-widest text-muted-foreground">
							Position {index + 1} / {session.items.length} ·{" "}
							{item.kind === "personal-game"
								? "From your games · remembered practice"
								: "Separate transfer position · first attempt tracked"}
						</p>
						<h3 className="mt-3 text-lg">Find a better continuation</h3>
						<p className="mt-2 text-xs leading-6 text-muted-foreground">{question.objective}</p>
					</div>
					<ChessBoard
						key={`${session.id}:${item.id}:${attempt}`}
						question={question}
						draftKey={`mistake:${session.id}:${item.id}:${attempt}`}
						assessment="engine"
						disabled={busy || !!feedback || !available}
						onSubmit={async (answer) => {
							const result = await mutate(
								{
									action: "mistakeAnswer",
									sessionId: session.id,
									itemId: item.id,
									move: answer.uciMoves[0],
									reasoning: answer.reasoning,
								},
								"Checking your continuation with Stockfish…",
							);
							if (result) setFeedback(result);
						}}
					/>
					{feedback && (
						<div data-testid="mistake-feedback" className="space-y-4 border-t pt-5">
							<p className="font-medium">
								{!feedback.comparable
									? "Comparison needs further review"
									: feedback.accepted
										? "A sound continuation in this search"
										: "There is a stronger continuation to investigate"}
							</p>
							<p className="text-sm">
								You chose {feedback.moveSan}.
								{feedback.originalSan && ` In the game, you played ${feedback.originalSan}.`}
							</p>
							<p className="text-xs leading-7 text-muted-foreground">{feedback.explanation}</p>
							<div className="grid gap-5 sm:grid-cols-2">
								<ChessDiagram
									position={{
										fen: feedback.candidateFen,
										orientation: item.learnerColor,
										highlightSquares: [feedback.move.slice(2, 4)],
										description: `Position after your ${feedback.moveSan}.`,
									}}
								/>
								{feedback.originalFen && (
									<ChessDiagram
										position={{
											fen: feedback.originalFen,
											orientation: item.learnerColor,
											highlightSquares: feedback.originalMove
												? [feedback.originalMove.slice(2, 4)]
												: [],
											description: `Original game position after ${feedback.originalSan}.`,
										}}
									/>
								)}
							</div>
							<p className="text-xs text-muted-foreground">
								{feedback.independent
									? "First attempt on a position not previously used in this app. Tracked separately as an unseen-position result."
									: "Remembered or repeated position. Excluded from unseen-position results."}{" "}
								Explanations are available for discussion with the tutor; no numeric explanation
								grade is invented.
							</p>
							<div className="flex flex-wrap gap-3">
								<Button variant="outline" onClick={() => change(index)}>
									Retry position
								</Button>
								<Button variant="outline" onClick={() => onDiscuss(item, feedback)}>
									Discuss this with my tutor
								</Button>
								{index + 1 < session.items.length && (
									<Button onClick={() => change(index + 1)}>Next position</Button>
								)}
							</div>
						</div>
					)}
				</article>
			)}
		</section>
	);
}
