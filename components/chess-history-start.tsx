"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
	CHESS_CONCEPTS,
	type ChessConceptCard,
	type ChessState,
	type RepeatedChessMistake,
} from "@/src/core";

interface HistorySummary {
	importedGames: number;
	completedAnalyses: number;
	gamesAwaitingAnalysis: number;
	historyState: string;
	repeatedMistakes: RepeatedChessMistake[];
	supportedCategoryPatterns?: { conceptId: string; label: string; examples: unknown[] }[];
	recurringPatterns: { conceptId: string; confidence: string; examples: unknown[] }[];
	recentTopics: { chatId: string; title: string; url: string }[];
	previousChessPractice: { lessonAttempts: number; mistakeAttempts: number };
	engine: { state: string; message: string };
}
export function ChessHistoryStart({
	state,
	available,
	busy,
	onReview,
	onPractice,
	onLesson,
	onFreeText,
	onExplore,
}: {
	state: ChessState;
	available: boolean;
	busy: boolean;
	onReview: () => void;
	onPractice: (findingId?: string) => void;
	onLesson: (card: ChessConceptCard, context?: string) => void;
	onFreeText: (text: string) => void;
	onExplore: () => void;
}) {
	const [history, setHistory] = useState<HistorySummary>();
	const [error, setError] = useState("");
	const [text, setText] = useState("");
	useEffect(() => {
		let alive = true;
		void fetch("/api/chess/history")
			.then(async (r) => {
				const data = await r.json();
				if (!r.ok) throw new Error(data.error);
				if (alive) {
					setHistory(data);
					setError("");
				}
			})
			.catch(() => {
				if (alive)
					setError(
						"Your chess history could not be retrieved. Open Games to retry; this does not mean your history is empty.",
					);
			});
		return () => {
			alive = false;
		};
	}, [
		state.games.length,
		state.analyses.length,
		state.exercises.length,
		state.mistakeSessions?.length,
		state.review?.completed,
	]);
	const repeated = history?.repeatedMistakes?.[0];
	const theme =
		history?.supportedCategoryPatterns?.[0] ??
		history?.recurringPatterns.find((p) => p.confidence === "tentative recurring pattern");
	const topic = history?.recentTopics[0];
	const card = CHESS_CONCEPTS.find((c) => c.concept_id === (theme?.conceptId ?? "piece-safety"))!;
	return (
		<section data-testid="chess-history-start" className="space-y-6">
			{error ? (
				<p role="alert" className="rounded-xl border p-5 text-sm">
					{error}
				</p>
			) : !history ? (
				<p className="text-sm text-muted-foreground">Checking your games and learning history…</p>
			) : (
				<>
					<div className="rounded-xl border bg-card p-5 sm:p-7" data-testid="recommended-next-step">
						<p className="text-xs uppercase tracking-wide text-muted-foreground">Your next step</p>
						<h2 className="mt-3 font-serif text-2xl sm:text-3xl">
							{repeated
								? "Fix a recurring move"
								: history.historyState === "games_await_analysis"
									? "Learn from your games"
									: theme
										? "Investigate a recurring theme"
										: history.completedAnalyses > 0
											? "Practise a critical moment"
											: topic
												? "Continue your chess lesson"
												: "Find your starting point"}
						</h2>
						<p className="mt-3 max-w-2xl font-prose text-base leading-7 text-muted-foreground">
							{repeated
								? repeated.recommendation
								: history.historyState === "games_await_analysis"
									? `Your ${history.importedGames} imported games are ready for review. Analyze a recent group to find concrete mistakes worth practising.`
									: theme
										? "Your analyzed games suggest a recurring board events across different positions. A short lesson will check your understanding before teaching."
										: history.completedAnalyses > 0
											? "Start with a short queue of verified positions from your games. There is not enough evidence to claim a broader weakness yet."
											: topic
												? `Pick up where you left off with “${topic.title}”.`
												: "Start a short chess diagnostic. You can connect an account or import games whenever you’re ready."}
						</p>
						<div className="mt-5 flex flex-wrap gap-3">
							{repeated ? (
								<Button disabled={busy || !available} onClick={() => onPractice(repeated.id)}>
									Practise this position
								</Button>
							) : history.historyState === "games_await_analysis" ? (
								<Button onClick={onReview}>Review my games</Button>
							) : theme ? (
								<Button
									disabled={busy}
									onClick={() =>
										onLesson(
											card,
											`Investigate the supported pattern ${JSON.stringify(theme)}. Probe understanding first.`,
										)
									}
								>
									Start a guided lesson
								</Button>
							) : history.completedAnalyses > 0 ? (
								<Button disabled={busy || !available} onClick={() => onPractice()}>
									Practise my mistakes
								</Button>
							) : topic ? (
								<Button asChild>
									<Link href={topic.url}>Continue lesson</Link>
								</Button>
							) : (
								<Button
									disabled={busy}
									onClick={() =>
										onLesson(card, "Start a short diagnostic. Do not presume a weakness.")
									}
								>
									Start a chess diagnostic
								</Button>
							)}
						</div>
						{history.importedGames > 0 && !available && (
							<p className="mt-4 text-xs leading-6 text-muted-foreground">
								Stockfish needs attention before analysis or mistake practice.{" "}
								<Link href="/chess/setup" className="underline">
									Engine setup
								</Link>
							</p>
						)}
						{repeated && (
							<p className="mt-4 text-xs text-muted-foreground">
								First fix · repeated position · {repeated.verifiedGames} verified games ·{" "}
								{repeated.analyzedOccurrences} analyzed visits / {repeated.occurrences} visits.
								Broader themes come next.
							</p>
						)}
					</div>
					<div className="grid gap-3 sm:grid-cols-3" aria-label="Chess learning actions">
						<button
							onClick={onReview}
							className="rounded-xl border p-4 text-left text-sm hover:bg-accent"
						>
							<span className="block font-medium">Review my games</span>
							<span className="mt-2 block text-xs leading-5 text-muted-foreground">
								Find repeated decisions and areas to improve.
							</span>
						</button>
						<button
							disabled={!available || busy || !history.completedAnalyses}
							onClick={() => onPractice()}
							className="rounded-xl border p-4 text-left text-sm hover:bg-accent disabled:opacity-50"
						>
							<span className="block font-medium">Practise mistakes</span>
							<span className="mt-2 block text-xs leading-5 text-muted-foreground">
								A short queue from your analyzed positions.
							</span>
						</button>
						{topic ? (
							<Link href={topic.url} className="rounded-xl border p-4 text-sm hover:bg-accent">
								<span className="block font-medium">Continue a lesson</span>
								<span className="mt-2 block truncate text-xs text-muted-foreground">
									{topic.title}
								</span>
							</Link>
						) : (
							<button
								onClick={onExplore}
								className="rounded-xl border p-4 text-left text-sm hover:bg-accent"
							>
								<span className="block font-medium">Explore a topic</span>
								<span className="mt-2 block text-xs text-muted-foreground">
									Choose what you want to learn.
								</span>
							</button>
						)}
					</div>
					<p
						className="border-y py-4 text-xs leading-6 text-muted-foreground"
						aria-label="Progress summary"
					>
						{history.importedGames} imported games · {history.completedAnalyses} completed analyses
						·{" "}
						{history.previousChessPractice.lessonAttempts +
							history.previousChessPractice.mistakeAttempts}{" "}
						practice attempts
					</p>
				</>
			)}
			<details className="text-sm">
				<summary className="cursor-pointer text-muted-foreground">Ask my chess tutor</summary>
				<form
					className="mt-3 flex flex-wrap gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (text.trim()) onFreeText(text.trim());
					}}
				>
					<label className="min-w-0 flex-1 text-xs">
						What would you like to work on?
						<input
							aria-label="Chess learning request"
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Teach me my common weaknesses"
							className="mt-2 w-full rounded border bg-background p-3"
						/>
					</label>
					<Button className="self-end" disabled={busy || !text.trim()}>
						Start chess session
					</Button>
				</form>
			</details>
		</section>
	);
}
