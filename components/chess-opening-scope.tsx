"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ChessOpeningScope({
	opening: requestedOpening,
	speed,
	limit,
	revision,
	onGame,
	onScope,
}: {
	opening: string;
	speed: string;
	limit: number;
	revision: number;
	onGame: (id: string) => void;
	onScope?: (data: any) => void;
}) {
	const opening = requestedOpening.trim();
	const [page, setPage] = useState(1);
	const [data, setData] = useState<any>();
	const [error, setError] = useState("");
	useEffect(() => {
		setPage(1);
	}, [opening, speed]);
	useEffect(() => {
		let active = true;
		const query = new URLSearchParams({
			view: "scope",
			opening,
			speed,
			limit: String(limit),
			page: String(page),
			pageSize: "10",
		});
		void fetch(`/api/chess/history?${query}`)
			.then(async (r) => {
				const body = await r.json();
				if (!r.ok) throw new Error(body.error);
				if (active) {
					setData(body);
					onScope?.(body);
					setError("");
				}
			})
			.catch(() => {
				if (active)
					setError(
						"The opening scope could not be retrieved. Saved games may still exist; retry the review.",
					);
			});
		return () => {
			active = false;
		};
	}, [opening, speed, page, limit, revision, onScope]);
	if (error)
		return (
			<p role="alert" className="text-xs">
				{error}
			</p>
		);
	if (
		!data ||
		data.receipt.openingRequested !== opening ||
		data.receipt.timeControl !== speed ||
		data.survey.requestedLimit !== limit ||
		data.pagination.page !== page
	)
		return <p className="text-xs text-muted-foreground">Classifying the selected opening scope…</p>;
	return (
		<section
			data-testid="opening-scope-receipt"
			className="space-y-3 rounded-lg border p-4 text-xs leading-6"
		>
			<h4 className="font-medium">Scope receipt · {data.receipt.openingRequested}</h4>
			{!data.receipt.recognisedOpening ? (
				<p>
					This opening was not recognised in the source catalogue. Correct the scope before drawing
					conclusions.
				</p>
			) : (
				<>
					<p>
						{data.receipt.matchedGames} matching games · {data.receipt.analyzedGames} have completed
						analysis · {data.receipt.timeControl} · learner side: {data.receipt.learnerSide}
					</p>
					<p>
						{data.receipt.branches
							.map(
								(b: { branch: string; games: number; analyzedGames: number }) =>
									`${b.branch}: ${b.games} games (${b.analyzedGames} analyzed)`,
							)
							.join(" · ") || "No matching branch records."}
					</p>
					<details>
						<summary className="cursor-pointer underline">
							Branch continuations from your games
						</summary>
						{data.receipt.branchPaths.map((b: { line: string; games: number }) => (
							<p key={b.line}>
								{b.line} · {b.games} games
							</p>
						))}
					</details>
					<p className="text-muted-foreground">
						Survey: {data.survey.coveredGames} / {data.survey.selectedGames} selected games covered
						· at most {data.survey.positionBudget} learner positions per game. {data.survey.limits}
					</p>
					<details>
						<summary className="cursor-pointer underline">
							Matching games · page {data.pagination.page}
						</summary>
						<ul className="mt-2 space-y-1">
							{data.games.map(
								(g: {
									id: string;
									white: string;
									black: string;
									opening: { name: string };
									playedAt: string;
								}) => (
									<li key={g.id}>
										<button className="text-left underline" onClick={() => onGame(g.id)}>
											{g.white} vs {g.black} · {g.opening.name} ·{" "}
											{g.playedAt?.slice(0, 10) ?? "Unknown date"}
										</button>
									</li>
								),
							)}
						</ul>
						<div className="mt-3 flex gap-2">
							<Button
								size="sm"
								variant="outline"
								disabled={page <= 1}
								onClick={() => setPage((p) => p - 1)}
							>
								Previous page
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={!data.pagination.nextPage}
								onClick={() => setPage(data.pagination.nextPage)}
							>
								Next page
							</Button>
						</div>
					</details>
					{data.referenceCard && (
						<details>
							<summary className="cursor-pointer underline">
								Opening reference · {data.referenceCard.title}
							</summary>
							<p>{data.referenceCard.startingLine}</p>
							<ul>
								{data.referenceCard.branches
									.slice(0, 8)
									.map((b: { name: string; pgn: string }, i: number) => (
										<li key={i}>
											{b.name}: {b.pgn}
										</li>
									))}
							</ul>
							<p>{data.referenceCard.authority}</p>
							<a
								className="underline"
								href={data.referenceCard.source.url}
								target="_blank"
								rel="noreferrer"
							>
								CC0 source catalogue · {data.referenceCard.source.revision.slice(0, 7)}
							</a>
						</details>
					)}
				</>
			)}
		</section>
	);
}
