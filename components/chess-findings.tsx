"use client";
import { useState } from "react";
import { ChessDiagram } from "@/components/chess-diagram";
import { Button } from "@/components/ui/button";
import { type chessMistakeFindings } from "@/src/core";

export function ChessFindings({
	findings,
	available,
	busy,
	onPractice,
	onGame,
	onLesson,
}: {
	findings: ReturnType<typeof chessMistakeFindings>;
	available: boolean;
	busy: boolean;
	onPractice: (findingId?: string) => void;
	onGame: (gameId: string, ply?: number) => void;
	onLesson: (conceptId: string, context: string) => void;
}) {
	const [shown, setShown] = useState(20);
	const [filter, setFilter] = useState("all");
	const mistakes = findings.mistakes.filter(
		(m) =>
			filter === "all" ||
			(filter === "needs-review"
				? m.status === "needs-review"
				: m.categories.some((c) => c.id === filter)),
	);
	return (
		<div data-testid="chess-mistake-findings" className="space-y-6">
			{!findings.repeated.length && (
				<p className="text-xs leading-6 text-muted-foreground">
					No repeated poor move in an identical position is currently supported by this scope’s
					verified sample. Continue with supported themes or review the critical moments below.
				</p>
			)}
			{findings.repeated.length > 0 && (
				<section className="space-y-4">
					<h3 className="font-serif text-2xl">First fixes: repeated moves</h3>
					<p className="text-xs leading-6 text-muted-foreground">
						These positions recur in your games. Practise one sound response before moving on to
						broader themes.
					</p>
					{findings.repeated.slice(0, 3).map((f) => (
						<article
							key={f.id}
							className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-[160px_1fr]"
							data-testid="repeated-position-finding"
						>
							<div className="mx-auto w-40">
								<ChessDiagram
									position={{
										fen: f.fen,
										orientation: f.learnerColor,
										highlightSquares: [],
										description: `Position before the recurring decision. ${f.learnerColor} to move.`,
									}}
								/>
							</div>
							<div>
								<h4 className="text-sm font-medium">A recurring {f.moveSan}</h4>
								<p className="mt-2 text-sm leading-6">{f.recommendation}</p>
								<p className="mt-2 text-xs leading-6 text-muted-foreground">
									{f.occurrences} visits in {f.gamesReached} games · move chosen {f.timesPlayed}{" "}
									times in {f.gamesPlayed} games · {f.verifiedMistakes} verified mistakes in{" "}
									{f.verifiedGames} games. {f.analyzedOccurrences} visits have completed analysis.
									{f.medianLossCp !== null
										? ` Median verified loss: ${f.medianLossCp} cp.`
										: " Verified mating consequences."}
								</p>
								<p className="mt-2 text-xs text-muted-foreground">
									{f.categories.length
										? f.categories.join(" · ")
										: "Needs review — no supported category yet"}
								</p>
								<div className="mt-4 flex flex-wrap gap-3">
									<Button size="sm" disabled={!available || busy} onClick={() => onPractice(f.id)}>
										Practise this position
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => onGame(f.examples[0]!.gameId, f.examples[0]!.ply)}
									>
										View evidence
									</Button>
								</div>
								<details className="mt-3 text-xs leading-6">
									<summary className="cursor-pointer underline">
										Verified consequences and alternatives
									</summary>
									<p>{f.examples[0]!.consequence}</p>
									<p>
										Reference: {f.examples[0]!.alternativeSan || "Requires a fresh engine check"}.
										Practice checks other sound moves too.
									</p>
								</details>
							</div>
						</article>
					))}
				</section>
			)}
			{findings.categoryPatterns.some((p) => p.supported) && (
				<section className="space-y-3">
					<h3 className="text-sm font-medium">Themes across different positions</h3>
					{findings.categoryPatterns
						.filter((p) => p.supported)
						.map((p) => (
							<article key={p.categoryId} className="rounded-lg border p-4">
								<p className="text-sm">
									{p.label} · {p.games} games · {p.positions} different positions
								</p>
								<p className="mt-2 text-xs text-muted-foreground">
									These are observed board events. The tutor will probe the reason before teaching.
								</p>
								<Button
									variant="link"
									size="sm"
									onClick={() =>
										onLesson(
											p.conceptId,
											JSON.stringify({ ...p, examples: p.examples.slice(0, 3) }),
										)
									}
								>
									Investigate in a lesson
								</Button>
							</article>
						))}
				</section>
			)}
			<details className="rounded-lg border p-4">
				<summary className="cursor-pointer text-sm">
					All detected mistakes ({findings.mistakes.length}) · {findings.unresolved} need review
				</summary>
				<p className="my-3 text-xs leading-6 text-muted-foreground">{findings.limitations}</p>
				<label className="text-xs">
					Category{" "}
					<select
						aria-label="Mistake category"
						className="ml-2 rounded border bg-card p-2"
						value={filter}
						onChange={(e) => {
							setFilter(e.target.value);
							setShown(20);
						}}
					>
						<option value="all">All categories</option>
						<option value="needs-review">Needs review</option>
						{findings.categoryPatterns.map((p) => (
							<option key={p.categoryId} value={p.categoryId}>
								{p.label}
							</option>
						))}
					</select>
				</label>
				<div className="mt-4 space-y-3">
					{mistakes.slice(0, shown).map((m) => (
						<article
							key={m.id}
							data-testid="categorized-mistake"
							className="border-t pt-3 text-xs leading-6"
						>
							<p>
								<button className="underline" onClick={() => onGame(m.gameId, m.ply)}>
									Ply {m.ply} · {m.moveSan}
								</button>{" "}
								· {m.phase} ·{" "}
								{m.lossCp === null ? "verified mate consequence" : `${m.lossCp} cp loss`}
							</p>
							<p>
								{m.categories.length
									? m.categories.map((c) => c.label).join(" · ")
									: "Uncategorised / needs review"}
							</p>
							<details>
								<summary className="cursor-pointer text-muted-foreground">
									Evidence and limits
								</summary>
								<p>{m.consequence}</p>
								{m.categories.map((c) => (
									<p key={c.id}>{c.evidence}</p>
								))}
								<p>Cause: needs a tutor probe.</p>
							</details>
						</article>
					))}
				</div>
				{shown < mistakes.length && (
					<Button
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => setShown((n) => n + 20)}
					>
						Show more mistakes
					</Button>
				)}
			</details>
		</div>
	);
}
