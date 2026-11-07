"use client";
import { Button } from "@/components/ui/button";
import {
	CHESS_CONCEPTS,
	type ChessState,
	type ChessConceptCard,
	type ChessPracticeItem,
	type ChessPracticeFeedback,
	type chessWeaknesses,
} from "@/src/core";

export const GAME_TYPES = [
	["all", "All game types"],
	["bullet", "Bullet"],
	["blitz", "Blitz"],
	["rapid", "Rapid"],
	["daily", "Daily"],
	["classical", "Classical"],
	["unknown", "Unknown"],
] as const;
export interface ChessMutation {
	(input: Record<string, unknown>, label: string): Promise<any>;
}

export function ChessReviewWorkflow({
	state,
	findings,
	speed,
	setSpeed,
	limit,
	setLimit,
	available,
	busy,
	mutate,
	onGame,
	onLesson,
	onPractice,
}: {
	state: ChessState;
	findings: ReturnType<typeof chessWeaknesses>;
	speed: string;
	setSpeed: (s: string) => void;
	limit: number;
	setLimit: (n: number) => void;
	available: boolean;
	busy: boolean;
	mutate: ChessMutation;
	onGame: (id: string, ply?: number) => void;
	onLesson: (card: ChessConceptCard, context?: string) => void;
	onPractice: () => void;
}) {
	const job = state.review;
	const running = job?.status === "running";
	return (
		<section
			data-testid="chess-review-workflow"
			className="space-y-5 rounded-xl border border-[#78866b] bg-card p-5"
		>
			<div>
				<p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
					Start with your history
				</p>
				<h3 className="font-serif text-2xl">Find areas to improve</h3>
				<p className="mt-2 text-xs leading-6 text-muted-foreground">
					Review a group of games, look for repeated evidence, and choose a useful lesson. The
					current concept detector covers <strong>piece safety</strong>: attacked, undefended
					non-pawn pieces with engine-verified loss. It is not a comprehensive assessment of your
					chess strengths and weaknesses.
				</p>
			</div>
			<div className="flex flex-wrap items-end gap-4">
				<label className="text-xs">
					Game type
					<select
						aria-label="Game type"
						value={speed}
						onChange={(e) => setSpeed(e.target.value)}
						className="mt-2 block rounded-lg border bg-background p-2.5"
					>
						{GAME_TYPES.map(([v, label]) => (
							<option key={v} value={v}>
								{label}
							</option>
						))}
					</select>
				</label>
				<label className="text-xs">
					Recent games
					<select
						aria-label="Review recent games"
						value={limit}
						onChange={(e) => setLimit(Number(e.target.value))}
						className="mt-2 block rounded-lg border bg-background p-2.5"
					>
						{[10, 25, 50, 100].map((n) => (
							<option key={n} value={n}>
								Most recent {n}
							</option>
						))}
					</select>
				</label>
				<Button
					disabled={!available || busy || !!running || !state.games.length}
					onClick={() =>
						void mutate({ action: "reviewStart", speed, limit }, "Starting game review…")
					}
				>
					Review my games
				</Button>
				{running && (
					<Button
						variant="outline"
						onClick={() =>
							void mutate({ action: "reviewCancel" }, "Stopping after the current game…")
						}
					>
						Stop review
					</Button>
				)}
			</div>
			{job && (
				<div role="status" aria-live="polite" className="space-y-3 rounded-lg border p-4 text-xs">
					<p>
						{job.status === "running" ? "Reviewing games…" : `Review ${job.status}`} ·{" "}
						{job.completed} / {job.gameIds.length} games ·{" "}
						{job.scope.speed === "all" ? "all game types" : job.scope.speed}
					</p>
					<progress
						aria-label="Game review progress"
						max={job.gameIds.length || 1}
						value={job.completed}
						className="h-2 w-full accent-[#a1ac8b]"
					/>
					{job.message && <p className="leading-6 text-muted-foreground">{job.message}</p>}
					{job.failures.map((f, i) => (
						<p key={i} className="text-muted-foreground">
							{f.message}{" "}
							<button className="underline" onClick={() => onGame(f.gameId)}>
								View affected game
							</button>
						</p>
					))}
				</div>
			)}
			{job && job.completed > 0 && (
				<div className="space-y-5">
					<h4 className="text-sm font-medium">Areas worth investigating</h4>
					{!findings.length ? (
						<p className="text-xs leading-6 text-muted-foreground">
							No piece-safety pattern is supported by the reviewed sample yet. This does not
							establish mastery or rule out other weaknesses. Try more games, practise verified
							critical positions, or start a short chess diagnostic.
						</p>
					) : (
						findings.map((f) => (
							<article key={f.conceptId} className="space-y-3 border-t pt-4">
								<h5 className="text-sm">
									{CHESS_CONCEPTS.find((c) => c.concept_id === f.conceptId)?.title ?? f.conceptId}
								</h5>
								<p className="text-xs">
									{f.examples.length} verified examples in{" "}
									{new Set(f.examples.map((e) => e.gameId)).size} games / {f.opportunities} defined
									opportunities · {f.confidence}
								</p>
								<p className="text-xs leading-6 text-muted-foreground">{f.limitations}</p>
								<div className="flex flex-wrap gap-3">
									{f.examples.slice(0, 4).map((e) => (
										<button
											key={`${e.gameId}:${e.ply}`}
											className="text-xs underline"
											onClick={() => onGame(e.gameId, e.ply)}
										>
											Example position · ply {e.ply}
										</button>
									))}
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										onLesson(
											CHESS_CONCEPTS.find((c) => c.concept_id === f.conceptId)!,
											`Use actual reviewed evidence: ${JSON.stringify(f)}. Probe my understanding before teaching. The detector is a tentative hypothesis, not proof of a conceptual weakness.`,
										)
									}
								>
									Investigate this in a lesson
								</Button>
							</article>
						))
					)}
					<Button variant="outline" disabled={!available || busy || !!running} onClick={onPractice}>
						Practise my mistakes
					</Button>
				</div>
			)}
		</section>
	);
}
