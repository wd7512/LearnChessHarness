"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CHESS_CONCEPTS, type ChessConceptCard, type ChessState } from "@/src/core";

interface HistorySummary {
	importedGames: number;
	completedAnalyses: number;
	gamesAwaitingAnalysis: number;
	historyState: string;
	connectedAccounts: { platform: string; username: string }[];
	recurringPatterns: {
		conceptId: string;
		opportunities: number;
		examples: unknown[];
		confidence: string;
	}[];
	recentTopics: { chatId: string; title: string; url: string; kind: string }[];
	previousChessPractice: {
		lessonAttempts: number;
		mistakeSessions: number;
		mistakeAttempts: number;
	};
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
}: {
	state: ChessState;
	available: boolean;
	busy: boolean;
	onReview: () => void;
	onPractice: () => void;
	onLesson: (card: ChessConceptCard, context?: string) => void;
	onFreeText: (text: string) => void;
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
				if (alive) {
					setHistory(undefined);
					setError(
						"Your chess history could not be retrieved. Open Games to retry; this does not mean your history is empty.",
					);
				}
			});
		return () => {
			alive = false;
		};
	}, [
		state.games.length,
		state.analyses.length,
		state.exercises.length,
		state.mistakeSessions?.length,
	]);
	const supported = history?.recurringPatterns.find(
		(p) => p.confidence === "tentative recurring pattern",
	);
	const card = CHESS_CONCEPTS.find(
		(c) => c.concept_id === (supported?.conceptId ?? "piece-safety"),
	)!;
	return (
		<section
			data-testid="chess-history-start"
			className="mb-8 space-y-4 rounded-xl border border-[#78866b] bg-card p-5"
		>
			<h2 className="font-serif text-2xl">Start from your chess history</h2>
			{error ? (
				<p role="alert" className="text-xs leading-6">
					{error}
				</p>
			) : !history ? (
				<p className="text-xs text-muted-foreground">
					Checking imported games, analysis and previous chess practice…
				</p>
			) : (
				<>
					<p className="text-xs leading-6">
						{history.connectedAccounts.length
							? `Connected: ${history.connectedAccounts.map((c) => `${c.platform === "chesscom" ? "Chess.com" : "Lichess"} / ${c.username}`).join(", ")}. `
							: ""}
						{history.importedGames} imported games · {history.completedAnalyses} completed analyses
						·{" "}
						{history.previousChessPractice.lessonAttempts +
							history.previousChessPractice.mistakeAttempts}{" "}
						recorded practice attempts.
					</p>
					<p className="text-sm leading-7">
						{history.historyState === "supported_patterns"
							? "Let’s use your recent games. There is a recurring piece-safety pattern worth investigating. A guided lesson can probe whether spotting threats is the issue, or you can practise the exact positions."
							: history.historyState === "games_await_analysis"
								? "Your games are imported, but they haven’t been analyzed yet, so there is no analysis-backed recurring weakness to claim. Review the games first, continue a topic, or start a short chess diagnostic."
								: history.historyState === "analyzed_without_supported_patterns"
									? "Some games have completed analysis, but there is not enough repeated evidence for a supported pattern. Practise critical moments, review more games, or choose a short diagnostic."
									: "There are no imported games recorded yet. You can study a chess topic or start a diagnostic now; importing games is optional."}
					</p>
					{history.gamesAwaitingAnalysis > 0 && history.completedAnalyses > 0 && (
						<p className="text-xs text-muted-foreground">
							{history.gamesAwaitingAnalysis} games still await completed analysis; recommendations
							use the analyzed subset only.
						</p>
					)}
					{history.engine.state !== "ready" && history.importedGames > 0 && (
						<p className="text-xs leading-6 text-muted-foreground">
							Analysis needs an available engine.{" "}
							<Link className="underline" href="/chess/setup">
								Set up Stockfish
							</Link>{" "}
							or check Settings → Chess engine.
						</p>
					)}
					<div className="flex flex-wrap gap-3">
						{history.importedGames > 0 && (
							<Button variant="outline" onClick={onReview}>
								Review my games
							</Button>
						)}
						{supported && (
							<Button
								disabled={busy}
								onClick={() =>
									onLesson(
										card,
										`Use this supported history pattern: ${JSON.stringify(supported)}. Probe understanding before teaching.`,
									)
								}
							>
								Learn this recurring pattern
							</Button>
						)}
						{history.completedAnalyses > 0 && (
							<Button variant="outline" disabled={!available || busy} onClick={onPractice}>
								Practise my mistakes
							</Button>
						)}
						{!supported && (
							<Button
								variant="outline"
								disabled={busy}
								onClick={() =>
									onLesson(
										card,
										"Start a short piece-safety diagnostic; do not assert a weakness without evidence.",
									)
								}
							>
								Start a chess diagnostic
							</Button>
						)}
						<a href="#chess-topic" className="self-center text-xs underline">
							Explore another chess topic
						</a>
					</div>
					{history.recentTopics.length > 0 && (
						<div className="border-t pt-3">
							<p className="mb-2 text-xs text-muted-foreground">Continue a previous chess topic</p>
							<div className="flex flex-wrap gap-3">
								{history.recentTopics.slice(0, 3).map((t) => (
									<Link key={t.chatId} href={t.url} className="text-xs underline">
										{t.title}
									</Link>
								))}
							</div>
						</div>
					)}
				</>
			)}
			<form
				className="flex flex-wrap gap-3 border-t pt-4"
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
		</section>
	);
}
