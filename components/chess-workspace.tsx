"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
	ArrowRightIcon,
	BookOpenIcon,
	ChartNoAxesCombinedIcon,
	CheckIcon,
	ChevronLeftIcon,
	DownloadIcon,
	LinkIcon,
	RefreshCwIcon,
	UploadIcon,
} from "lucide-react";
import { ChessReviewWorkflow } from "@/components/chess-review-workflow";
import { ChessMistakePractice } from "@/components/chess-mistake-practice";
import {
	ChessEngineNotice,
	useStockfishStatus,
	STOCKFISH_CHANGED,
} from "@/components/chess-engine-status";
import { ChessHistoryStart } from "@/components/chess-history-start";
import { ChessBoard, ChessPosition } from "@/components/chess-board";
import { Button } from "@/components/ui/button";
import {
	CHESS_CONCEPTS,
	CHESS_OPENINGS,
	KING_SAFETY_EXERCISE,
	chessProgress,
	chessWeaknesses,
	orderedChessGames,
	mistakePracticeStats,
	type ChessAnswer,
	type ChessConceptCard,
	type ChessQuestion,
	type ChessState,
} from "@/src/core";

type Snapshot = ChessState & { weaknesses: ReturnType<typeof chessWeaknesses>; warnings?: string[];
	reviewFindings?: ReturnType<typeof chessWeaknesses>;
};
type Tab = "Learn" | "Games" | "Practise" | "Progress" | "Connections";
const empty: Snapshot = {
	version: 1,
	games: [],
	analyses: [],
	connections: [],
	ratings: [],
	exercises: [],
	weaknesses: [],
};
const displayPlatform = (p: string) =>
	p === "chesscom" ? "Chess.com" : p === "lichess" ? "Lichess" : "PGN upload";
const stamp = (s?: string | null) =>
	s
		? new Date(s).toLocaleDateString("en-GB", {
				day: "numeric",
				month: "short",
				year: "numeric",
				timeZone: "Europe/London",
			})
		: "Date unknown";

export function ChessWorkspace() {
	const [state, setState] = useState<Snapshot>(empty);
	const [tab, setTab] = useState<Tab>("Learn");
	const [busy, setBusy] = useState("");
	const [notice, setNotice] = useState("");
	const [failure, setFailure] = useState("");
	const [topic, setTopic] = useState("king-safety");
	const [question, setQuestion] = useState<ChessQuestion>(KING_SAFETY_EXERCISE);
	const [feedback, setFeedback] = useState<{ moveGrade: string; independent: boolean;
	} | null>(null);
	const [username, setUsername] = useState("");
	const [platform, setPlatform] = useState<"chesscom" | "lichess">("chesscom");
	const [autoSync, setAutoSync] = useState(false);
	const [preview, setPreview] = useState<{
		previewId: string;
		games: number;
		timeControls: string[];
		coverage: string;
		warnings: string[];
	} | null>(null);
	const [playerId, setPlayerId] = useState("");
	const [pgn, setPgn] = useState("");
	const [fileName, setFileName] = useState("Manual PGN");
	const [selectedGame, setSelectedGame] = useState<string | null>(null);
	const [selectedPly, setSelectedPly] = useState<number | null>(null);
	const autoStarted = useRef(false);
	const [gameType, setGameType] = useState("all");
	const [reviewLimit, setReviewLimit] = useState(10);
	const [practiceSessionId, setPracticeSessionId] = useState<string>();
	const reviewRef = useRef<HTMLElement>(null);
	const engine = useStockfishStatus();
	const displayedGames = orderedChessGames(state.games, gameType);
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const value = params.get("tab");
		const tabs = {
			games: "Games",
			practice: "Practise",
			learn: "Learn",
			progress: "Progress",
			connections: "Connections",
		} as const;
		if (value && value in tabs) setTab(tabs[value as keyof typeof tabs]);
		if (params.get("gameId")) setSelectedGame(params.get("gameId"));
	}, []);
	useEffect(() => {
		if (tab !== "Games" || !selectedGame || !reviewRef.current) return;
		reviewRef.current.scrollIntoView({ block: "start", behavior: "instant" });
		reviewRef.current.focus({ preventScroll: true });
	}, [selectedGame, selectedPly, tab, state.games.length]);
	function showGame(id: string, ply?: number) {
		setSelectedPly(ply ?? null);
		setSelectedGame(id);
		setTab("Games");
		if (id === selectedGame) {
			reviewRef.current?.scrollIntoView({
				block: "start",
				behavior: "instant",
			});
			reviewRef.current?.focus({ preventScroll: true });
		}
	}

	const refresh = useCallback(async () => {
		const r = await fetch("/api/chess");
		if (!r.ok) throw new Error("Could not load chess history.");
		const data = (await r.json()) as Snapshot;
		setState(data);
		if (data.warnings?.length) setNotice(data.warnings.join(" "));
		return data;
	}, []);
	const mutate = useCallback(
		async (input: Record<string, unknown>, label: string) => {
			setBusy(label);
			setFailure("");
			setNotice("");
			try {
				const r = await fetch("/api/chess", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(input),
				});
				const result = await r.json();
				if (result.engineStatus || result.status === "unavailable")
					window.dispatchEvent(new Event(STOCKFISH_CHANGED));
				if (!r.ok) throw new Error(result.error ?? "Request failed");
				await refresh();
				return result;
			} catch (e) {
				setFailure(e instanceof Error ? e.message : "Request failed");
				return null;
			} finally {
				setBusy("");
			}
		},
		[refresh],
	);
	useEffect(() => {
		void refresh()
			.then(async (data) => {
				if (autoStarted.current) return;
				autoStarted.current = true;
				for (const c of data.connections.filter(
					(c) => c.autoSync && (!c.lastSync || Date.now() - Date.parse(c.lastSync) > 15 * 60_000),
				))
					await mutate(
						{ action: "sync", platform: c.platform, username: c.username },
						"Syncing public games…",
					);
			})
			.catch((e) => setFailure(String(e)));
	}, [refresh, mutate]);
	useEffect(() => {
		if (state.review?.status !== "running") return;
		const timer = setInterval(() => {
			void refresh().catch((e) => setFailure(String(e)));
		}, 1200);
		return () => clearInterval(timer);
	}, [state.review?.status, state.review?.id, refresh]);
	async function startMistakes() {
		const result = await mutate(
			{ action: "mistakeStart", speed: gameType, limit: reviewLimit },
			"Preparing mistake practice…",
		);
		if (result) {
			setPracticeSessionId(result.sessionId);
			setTab("Practise");
			if (result.message) setNotice(result.message);
		}
	}
	const card = CHESS_CONCEPTS.find((c) => c.concept_id === topic)!;
	async function startLesson(concept: ChessConceptCard, context = "") {
		setBusy("Opening lesson…");
		try {
			const r = await fetch("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: concept.title }),
			});
			if (!r.ok) throw new Error("Could not create lesson.");
			const { id } = await r.json();
			const prompt = `[LearnHarness Chess lesson] Teach me ${concept.title.toLowerCase()} using the existing probe → plan → teach cycle. Mix multiple choice, free recall and a playable chessboard. Use chess_reference for ${concept.concept_id}. Source-labelled concept v${concept.revision}: ${concept.principle} Exceptions: ${concept.exceptions}. ${context} Keep move grading separate from explanation quality. I can study without importing games.`;
			window.location.assign(`/chat/${id}?prompt=${encodeURIComponent(prompt)}`);
		} catch (e) {
			setFailure(String(e));
			setBusy("");
		}
	}
	async function submitExercise(answer: ChessAnswer) {
		const result = await mutate({ action: "exercise", question, answer }, "Recording exercise…");
		if (result) setFeedback(result);
	}
	const selected = state.games.find((g) => g.id === selectedGame);
	const analysis = state.analyses.find((a) => a.gameId === selectedGame);
	const totals = [
		{ label: "Imported games", value: state.games.length, sub: "Immutable game history" },
		{
			label: "Reviewed games",
			value: state.analyses.filter((a) => a.status === "complete").length,
			sub: "Verified Stockfish searches",
		},
		{
			label: "Learning attempts",
			value: state.exercises.length + mistakePracticeStats(state).attempts,
			sub: `${state.exercises.filter((e) => e.independent).length + mistakePracticeStats(state).unseen} independent held-out results`,
		},
	];
	return (
		<main className="h-dvh overflow-y-auto bg-background text-foreground" data-testid="chess-workspace">
			<div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
				<div className="mb-9 flex items-start justify-between gap-4">
					<div>
						<Link href="/" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground">
							<ChevronLeftIcon className="size-3" /> LearnHarness
						</Link>
						<p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
							A little study. A better next game.
						</p>
						<h1 className="font-serif text-4xl tracking-tight md:text-5xl">Your chess, understood.</h1>
						<p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
							Learn the idea. Play the position. Look for it in your next game.
						</p>
					</div>
					<span aria-hidden className="hidden text-6xl text-[#a1ac8b] sm:block">
						♞
					</span>
				</div>
			<nav aria-label="Chess sections" className="mb-8 grid grid-cols-2 gap-1 border-b sm:flex">
					{(
						[
							["Learn", BookOpenIcon],
							["Games", DownloadIcon],
							["Practise", BookOpenIcon],
							["Progress", ChartNoAxesCombinedIcon],
							["Connections", LinkIcon],
						] as const
					).map(([name, Icon]) => (
						<button
							key={name}
							type="button"
							onClick={() => setTab(name)}
							aria-current={tab === name ? "page" : undefined}
							className={`flex items-center gap-2 border-b-2 px-3 py-3 text-xs transition-colors ${tab === name ? "border-[#a1ac8b] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
						>
							<Icon className="size-3.5" />
							{name}
						</button>
					))}
				</nav>
				{busy && (
					<p role="status" className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
						<RefreshCwIcon className="size-4 animate-spin" />
						{busy}
					</p>
				)}
				{notice && (
					<p role="status" className="mb-5 rounded-lg border border-[#78866b] p-3 text-sm">
						{notice}
					</p>
				)}
				{failure && (
					<p role="alert" className="mb-5 rounded-lg border border-destructive/50 p-3 text-sm">
						{failure}
					</p>
				)}
				{tab === "Learn" && (
					<>
						<ChessHistoryStart
							state={state}
							available={engine.available}
							busy={!!busy}
							onReview={() => setTab("Games")}
							onPractice={() => void startMistakes()}
							onLesson={(c, context) => void startLesson(c, context)}
							onFreeText={async (text) => {
								setBusy("Opening chess session…");
								try {
									const r = await fetch("/api/chats", {
										method: "POST",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({ title: text }),
									});
									if (!r.ok) throw new Error("Could not create a chess session.");
									const { id } = await r.json();
									window.location.assign(`/chat/${id}?prompt=${encodeURIComponent(text)}`);
								} catch (e) {
									setFailure(String(e));
									setBusy("");
								}
							}}
						/>
						<div className="grid gap-8 lg:grid-cols-[1fr_1.05fr]">
							<div>
								<p className="mb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
									Your next idea
								</p>
								<label className="sr-only" htmlFor="chess-topic">
									Study topic
								</label>
								<select
									id="chess-topic"
									className="mb-5 w-full rounded-lg border bg-card p-3 text-sm"
									value={topic}
									onChange={(e) => setTopic(e.target.value)}
								>
									{CHESS_CONCEPTS.map((c) => (
										<option key={c.concept_id} value={c.concept_id}>
											{c.title}
										</option>
									))}
								</select>
								<article className="rounded-xl border bg-card p-6">
									<div className="mb-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#a1ac8b]">
										<span className="size-1.5 rounded-full bg-current" /> Concept{" "}
										{String(CHESS_CONCEPTS.indexOf(card) + 1).padStart(2, "0")} /{" "}
										{CHESS_CONCEPTS.length}
									</div>
									<h2 className="mb-4 font-serif text-3xl">{card.title}</h2>
									<p className="text-sm leading-7">{card.principle}</p>
									<div className="my-5 border-l-2 border-[#78866b] pl-4">
										<p className="mb-1 text-xs font-medium">The useful exception</p>
										<p className="text-xs leading-6 text-muted-foreground">{card.exceptions}</p>
									</div>
									<Button disabled={!!busy} onClick={() => void startLesson(card)} className="w-full">
										Start a guided lesson <ArrowRightIcon className="ml-2 size-4" />
									</Button>
									<p className="mt-3 text-center text-[10px] text-muted-foreground">
										Uses your LearnHarness tutor · no game import required
									</p>
								</article>
								<details className="mt-4 rounded-lg border p-4 text-xs">
									<summary className="cursor-pointer text-muted-foreground">
										Sources & concept history
									</summary>
									<p className="my-3 leading-6">
										Editorial review {card.reviewedAt} · revision {card.revision}. Principles are heuristics;
										rules determine legal moves.
									</p>
									{card.sources.map((s) => (
										<a
											key={s.url}
											href={s.url}
											target="_blank"
											rel="noreferrer"
											className="mb-2 block underline"
										>
											{s.title} · {s.authority}
										</a>
									))}
									<p className="mt-3">Prerequisites: {card.prerequisites.join(", ") || "None"}</p>
								</details>
								{topic === "sicilian" || topic === "beginner-openings" ? (
									<div className="mt-4 rounded-lg border p-4">
										<h3 className="mb-3 text-xs">Named opening examples · CC0</h3>
										{CHESS_OPENINGS.filter((o) => topic !== "sicilian" || o.name.includes("Sicilian")).map(
											(o) => (
												<button
													key={o.eco}
													className="mb-2 block text-left text-xs leading-6 text-muted-foreground hover:text-foreground"
													onClick={() => {
														setFeedback(null);
														setQuestion({
															fen: o.fen,
															learnerColor: o.fen.split(" ")[1] === "w" ? "white" : "black",
															maxLearnerMoves: 1,
															opponent: { mode: "fixed", moves: [] },
															acceptableLines:
																o.eco === "B20"
																	? [["g1f3"], ["c2c3"]]
																	: [
																			[
																				o.eco === "B50"
																					? "b1c3"
																					: o.fen.split(" ")[1] === "w"
																						? "g1f3"
																						: "g8f6",
																			],
																		],
															objective: `${o.name}: play a developing move. This example line is illustrative.`,
															rubric: "Explain central control, development, and the opponent's reply.",
															expectedConceptIds: [topic],
															heldOut: false,
														});
													}}
												>
													<span className="text-foreground">
														{o.eco} · {o.name}
													</span>
													<br />
													{o.san.join(" ")}
												</button>
											),
										)}
										<p className="text-[10px] text-muted-foreground">
											Names from Lichess chess-openings; frequency and engine quality are not implied.
										</p>
									</div>
								) : null}
							</div>
							<div className="rounded-xl border bg-card p-5 md:p-6">
								<div className="mb-4 flex items-center justify-between">
									<p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
										Try the idea on the board
									</p>
									<span className="rounded-full border px-2 py-1 text-[9px] text-muted-foreground">
										Practice preview
									</span>
								</div>
								<p className="mb-5 text-xs leading-6">{question.objective}</p>
								<ChessBoard
									key={JSON.stringify(question)}
									question={question}
									draftKey="curriculum-preview"
									disabled={!!busy || !!feedback}
									onSubmit={(answer) => void submitExercise(answer)}
								/>
								{feedback && (
									<div className="mt-5 space-y-3 rounded-lg border border-[#78866b] p-4 text-xs">
										<p className="flex items-center gap-2">
											<CheckIcon className="size-4" />
											{feedback.moveGrade === "matches-lesson"
												? "Your moves match the lesson rubric."
												: "Your continuation is legal and outside the lesson rubric."}
										</p>
										<p className="leading-6 text-muted-foreground">
											Explanation: awaiting tutor review. This is a practised example, so it does not count as
											independent transfer evidence. No engine score is implied.
										</p>
										<Button variant="outline" size="sm" onClick={() => setFeedback(null)}>
											Try again
										</Button>
									</div>
								)}
							</div>
						</div>
						<div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed p-5">
							<div>
								<h3 className="mb-1 text-sm">Make it personal when you’re ready.</h3>
								<p className="text-xs text-muted-foreground">Bring a PGN to find moments worth studying.</p>
							</div>
							<Button variant="outline" onClick={() => setTab("Games")}>
								<UploadIcon className="mr-2 size-4" />
								Import your games
							</Button>
						</div>
					</>
				)}
				{tab === "Games" && (
					<div className="space-y-7">
						<div>
							<h2 className="font-serif text-3xl">Learn from your games.</h2>
							<p className="mt-2 text-xs text-muted-foreground">
								Original games stay intact. Analysis is recorded separately, with its engine and search
								limits.
							</p>
						</div>
						<ChessEngineNotice
							status={engine.status}
							error={engine.error}
							onRefresh={() => void engine.refresh(true)}
						/>
						<ChessReviewWorkflow
							state={state}
							findings={state.reviewFindings ?? []}
							speed={gameType}
							setSpeed={setGameType}
							limit={reviewLimit}
							setLimit={setReviewLimit}
							available={engine.available}
							busy={!!busy}
							mutate={mutate}
							onGame={showGame}
							onLesson={(c, context) => void startLesson(c, context)}
							onPractice={() => void startMistakes()}
						/>
						<div className="rounded-xl border bg-card p-5">
							<div className="grid gap-4 md:grid-cols-2">
								<label className="text-xs">
									Your name in the PGN
									<input
										aria-label="Your name in the PGN"
										className="mt-2 w-full rounded-lg border bg-background p-3"
										value={playerId}
										onChange={(e) => setPlayerId(e.target.value)}
										placeholder="Match White or Black exactly"
									/>
								</label>
								<label className="text-xs">
									PGN files
									<input
										aria-label="PGN files"
										type="file"
										accept=".pgn,text/plain"
										multiple
										className="mt-2 block w-full rounded-lg border p-2.5 text-xs"
										onChange={async (e) => {
											const files = [...(e.target.files ?? [])];
											if (files.reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024) {
												setFailure("Choose at most 10 MiB of PGNs.");
												return;
											}
											setPgn((await Promise.all(files.map((f) => f.text()))).join("\n\n"));
											setFileName(
												files
													.map((f) => f.name)
													.join(", ")
													.slice(0, 200),
											);
										}}
									/>
								</label>
							</div>
							<textarea
								aria-label="PGN text"
								value={pgn}
								onChange={(e) => setPgn(e.target.value)}
								placeholder={'Or paste PGN here…\n[White "YourName"]\n[Black "Opponent"]'}
								className="mt-4 min-h-28 w-full rounded-lg border bg-background p-3 font-mono text-xs"
							/>
							<div className="mt-3 flex items-center justify-between gap-3">
								<p className="text-[10px] text-muted-foreground">
									Legal, completed games only. Repeat imports are deduplicated.
								</p>
								<Button
									disabled={!!busy || !pgn.trim() || !playerId.trim()}
									onClick={async () => {
										const r = await mutate(
											{ action: "import", pgn, playerId, source: fileName },
											"Importing games…",
										);
										if (r)
											setNotice(
												`${r.added} games added · ${r.duplicates} duplicates · ${r.rejected.length} rejected${r.rejected.length ? `. ${r.rejected.join(" ")}` : ""}`,
											);
									}}
								>
									Import PGN
								</Button>
							</div>
						</div>
						{selected && (
							<section
								ref={reviewRef}
								tabIndex={-1}
								aria-label="Selected game review"
								data-testid="selected-game-review"
								className="scroll-mt-4 rounded-xl border border-[#a1ac8b] bg-card p-5 outline-none"
							>
								<div className="flex flex-wrap justify-between gap-4">
									<div>
										<h3 className="mb-2 text-sm">
											Selected game: {selected.white.name} vs {selected.black.name}
											{selectedPly ? ` · position before ply ${selectedPly}` : ""}
										</h3>
										<p className="mb-4 text-xs text-muted-foreground">
											{stamp(selected.playedAt)} · {selected.result} · {selected.termination}
										</p>
									</div>
									<Button
										disabled={!!busy || !engine.available || state.review?.status === "running"}
										onClick={async () => {
											const r = await mutate(
												{ action: "analyze", gameId: selected.id },
												"Stockfish is reviewing the game…",
											);
											if (r?.message) setNotice(r.message);
										}}
									>
										Analyze with Stockfish
									</Button>
								</div>
								{!engine.available && (
									<p role="status" className="my-4 text-xs leading-6 text-muted-foreground">
										{engine.error ||
											engine.status?.message ||
											"Checking engine availability before enabling analysis."}{" "}
										<Link className="underline" href="/chess/setup">
											Stockfish setup
										</Link>
									</p>
								)}
								{analysis && (
									<p className="my-4 text-xs leading-6 text-muted-foreground">
										{analysis.status} · {analysis.engine} · maximum depth {analysis.settings.depth}{" "}
										/ {analysis.settings.nodes.toLocaleString()} nodes per search. {" "}
										{analysis.status !== "complete"
											? "No completed analysis is available for this game. Check engine status above before retrying."
											: ""}
									</p>
								)}
								<div className="flex gap-5 overflow-x-auto pb-3">
									{analysis?.positions
										.filter((p) => p.ply === selectedPly || (p.lossCp !== null && p.lossCp >= 150))
										.sort((a, b) => a.ply === selectedPly ? -1 : b.ply === selectedPly ? 1 : a.ply - b.ply)
										.slice(0, 12)
										.map((p) => (
											<div key={p.ply} className="shrink-0">
												<ChessPosition fen={p.before.fen} color={selected.learnerColor} />
												<p className="mt-2 text-xs">
													Ply {p.ply} · {p.lossCp} cp loss
												</p>
												<p className="mt-1 max-w-48 text-[10px] text-muted-foreground">
													Critical moment; conceptual meaning needs testing.
												</p>
												<Button
													variant="link"
													size="sm"
													onClick={() => {
														const c = CHESS_CONCEPTS.find(
															(c) => c.concept_id === (p.conceptIds[0] ?? "calculation"),
														)!;
														void startLesson(
															c,
															`Game ${selected.id}, ply ${p.ply}, FEN ${p.before.fen}. Recorded ${analysis.engine}: before ${JSON.stringify(p.before)}, after ${JSON.stringify(p.after)}. Treat conceptual tags as hypotheses.`,
														);
													}}
												>
													Study this moment
												</Button>
											</div>
										))}
								</div>
								<details className="mt-3 text-xs">
									<summary className="cursor-pointer">Original PGN & provenance</summary>
									<p className="my-2 text-muted-foreground">
										{selected.provenance.source} · imported {stamp(selected.provenance.importedAt)}
									</p>
									<pre className="max-h-64 overflow-auto whitespace-pre-wrap p-3">{selected.rawPgn}</pre>
								</details>
							</section>
						)}
					<p className="text-xs text-muted-foreground" aria-live="polite">
							Showing {displayedGames.length} of {state.games.length} games · newest first
						</p>
						{!state.games.length ? (
							<div className="rounded-xl border border-dashed p-10 text-center">
								<span className="text-4xl text-[#a1ac8b]">♟</span>
								<p className="mt-4 text-sm">Your next game has something to teach you.</p>
								<p className="mt-2 text-xs text-muted-foreground">
									Upload a PGN or connect a public username.
								</p>
							</div>
						) : (
							<div className="overflow-x-auto rounded-xl border">
								<table className="w-full text-left text-xs">
									<thead className="bg-card text-muted-foreground">
										<tr>
											{[
												"Played",
												"Players",
												"Result / ending",
												"Time control",
												"Source",
												"Review",
											].map((h, hi) => (
												<th
													key={h}
													className={`p-3 font-normal ${hi >= 2 && hi <= 4 ? "hidden sm:table-cell" : ""}`}
												>
													{h}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{displayedGames.map((g) => (
											<tr
												key={g.id}
												aria-selected={g.id === selectedGame}
												className={`border-t ${g.id === selectedGame ? "bg-accent" : ""}`}
											>
												<td className="p-3">
													<time dateTime={g.playedAt ?? undefined}>
														{stamp(g.playedAt)}
														<span className="mt-1 block text-[10px] text-muted-foreground">
															{g.playedAt
																? new Date(g.playedAt).toLocaleTimeString("en-GB", {
																		timeZone: "Europe/London",
																	})
																: ""}
														</span>
													</time>
												</td>
												<td className="p-4 leading-6">
													{g.white.name}{" "}
													<span className="text-muted-foreground">{g.white.rating ?? ""}</span>
													<br />
													{g.black.name}{" "}
													<span className="text-muted-foreground">{g.black.rating ?? ""}</span>
												</td>
												<td className="hidden p-4 leading-6 sm:table-cell">
													{g.result}
													<br />
													<span className="text-muted-foreground">{g.termination}</span>
												</td>
												<td className="hidden p-4 sm:table-cell">
													{g.speed} · {g.timeControl}
												</td>
												<td className="hidden p-4 sm:table-cell">{displayPlatform(g.platform)}</td>
												<td className="p-4">
													<Button
														size="sm"
														variant="outline"
														disabled={!!busy}
														onClick={() => showGame(g.id)}
													>
														View game
													</Button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				)}
				{tab === "Practise" && (
					<div className="space-y-5">
						<ChessEngineNotice
							status={engine.status}
							error={engine.error}
							onRefresh={() => void engine.refresh(true)}
						/>
						<ChessMistakePractice
							key={practiceSessionId ?? "saved"}
							initialSessionId={practiceSessionId}
							state={state}
							available={engine.available}
							busy={!!busy}
							mutate={mutate}
							onReview={() => setTab("Games")}
							onDiscuss={(item, feedback) =>
								void startLesson(
									CHESS_CONCEPTS.find((c) => c.concept_id === item.conceptId) ?? CHESS_CONCEPTS[0]!,
									`Discuss my completed practice: ${JSON.stringify({ item, feedback })}. Probe my understanding first.`,
								)
							}
						/>
					</div>
				)}
				{tab === "Progress" && (
					<div className="space-y-7">
						<div>
							<h2 className="font-serif text-3xl">Evidence, over time.</h2>
							<p className="mt-2 text-xs text-muted-foreground">
								Look for transfer in new games and unseen positions. A rating change alone cannot tell you
								why.
							</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-3">
							{totals.map((t) => (
								<div key={t.label} className="rounded-xl border bg-card p-5">
									<p className="text-xs text-muted-foreground">{t.label}</p>
									<p className="my-3 font-serif text-4xl">{t.value}</p>
									<p className="text-[10px] text-muted-foreground">{t.sub}</p>
								</div>
							))}
						</div>
						<RatingSeries state={state} />
						<section
							data-testid="mistake-practice-outcomes"
							className="rounded-xl border bg-card p-5"
						>
							<h3 className="mb-3 text-sm">Remembered positions and unseen transfer</h3>
							<p className="text-xs leading-6 text-muted-foreground">
								{mistakePracticeStats(state).remembered} remembered/repeated attempts. On previously
								unused transfer positions: {mistakePracticeStats(state).unseenAccepted} sound
								continuations / {mistakePracticeStats(state).unseen} comparable first attempts.{" "}
								{mistakePracticeStats(state).uncertain} attempts have an uncertain engine comparison
								and are not counted as unseen successes. Personal game positions never count as
								unseen transfer.
							</p>
							<Button className="mt-4" variant="outline" onClick={() => setTab("Practise")}>
								Continue mistake practice
							</Button>
						</section>
						<div className="rounded-xl border bg-card p-5">
							<h3 className="mb-4 text-sm">Baseline → practice → prospective games</h3>
							{chessProgress(state).length ? (
								chessProgress(state).map((p) => (
									<div key={p.conceptId} className="mb-4 border-t pt-3">
										<p className="text-xs">
											{p.conceptId} · first practice {stamp(p.firstPractice)}
										</p>
										<div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
											{(
												[
													["Baseline", p.baseline],
													["Later games", p.prospective],
												] as const
											).map(([label, sample]) => (
												<p key={label}>
													{label}: {sample.errors} / {sample.opportunities} defined opportunities ·{" "}
													{sample.games} analyzed games ·{" "}
													{sample.rate === null
														? "rate unavailable"
														: `${Math.round(sample.rate * 100)}% observed error rate`}
												</p>
											))}
										</div>
										<p className="mt-2 text-[10px] text-muted-foreground">
											Dates come from immutable game records. An opportunity detector is currently available
											only for piece safety; zero opportunities is not evidence of mastery.
										</p>
									</div>
								))
							) : (
								<p className="text-xs text-muted-foreground">
									Complete targeted practice, then import new games to compare defined opportunity counts.
								</p>
							)}
						</div>
						<div className="rounded-xl border bg-card p-5">
							<h3 className="mb-4 text-sm">Patterns to investigate</h3>
							{state.weaknesses.length ? (
								state.weaknesses.map((w) => (
									<div key={w.conceptId} className="mb-4 border-t pt-4">
										<p className="text-sm">
											{w.conceptId} · {w.examples.length} verified errors / {w.opportunities}{" "}
											defined
											opportunities
										</p>
										<p className="mt-2 text-xs text-[#a1ac8b]">{w.confidence}</p>
										<p className="my-3 text-xs leading-6 text-muted-foreground">{w.limitations}</p>
										<p className="mb-2 text-[10px] text-muted-foreground">
											Opportunity: an attacked, undefended non-pawn piece before the learner moves. Error:
											material remains exposed and the bounded engine search reports at least 150 cp lost.
										</p>
										{w.examples.map((e) => (
											<button
												key={`${e.gameId}:${e.ply}`}
												onClick={() => {
													setSelectedGame(e.gameId);
													setTab("Games");
												}}
												className="mr-3 mb-2 text-xs underline"
											>
												Game {e.gameId.slice(0, 12)} · ply {e.ply}
											</button>
										))}
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												void startLesson(
													CHESS_CONCEPTS.find((c) => c.concept_id === w.conceptId)!,
													`Tentative pattern: ${JSON.stringify(w)}`,
												)
											}
										>
											Test this idea in a lesson
										</Button>
									</div>
								))
							) : (
								<p className="text-xs leading-6 text-muted-foreground">
									No supported recurring pattern yet. Import and analyze several games. A single centipawn
									loss is not a conceptual diagnosis.
								</p>
							)}
						</div>
						<div className="rounded-xl border bg-card p-5">
							<h3 className="mb-3 text-sm">Unseen exercise results</h3>
							<p className="text-xs leading-6 text-muted-foreground">
								{
									state.exercises.filter((e) => e.independent).filter((e) => e.moveGrade === "matches-lesson")
										.length
								}{" "}
								lesson-rubric matches / {state.exercises.filter((e) => e.independent).length}{" "}
								independent
								held-out attempts.{" "}
								{state.exercises.filter((e) => !e.independent).length} practised or
								repeated attempts are excluded. Explanation grades await tutor review.
							</p>
							<p className="mt-3 text-[10px] text-muted-foreground">
								Keep the sequence: baseline games → targeted practice → new games → reanalysis. Samples are
								small; no causal improvement claim is made.
							</p>
						</div>
					</div>
				)}
				{tab === "Connections" && (
					<div className="max-w-3xl space-y-6">
						<div>
							<h2 className="font-serif text-3xl">Bring your next games along.</h2>
							<p className="mt-3 text-xs leading-6 text-muted-foreground">
								Connect a public username to import completed games and ratings. No password or OAuth is
								required. Manual PGN import is always available.
							</p>
						</div>
						<div className="rounded-xl border bg-card p-6">
							<div className="grid gap-4 sm:grid-cols-[160px_1fr]">
								<label className="text-xs">
									Platform
									<select
										aria-label="Platform"
										value={platform}
										onChange={(e) => {
											setPlatform(e.target.value as typeof platform);
											setPreview(null);
										}}
										className="mt-2 w-full rounded-lg border bg-background p-3"
									>
										<option value="chesscom">Chess.com</option>
										<option value="lichess">Lichess</option>
									</select>
								</label>
								<label className="text-xs">
									Public username
									<input
										aria-label="Public username"
										value={username}
										onChange={(e) => {
											setUsername(e.target.value);
											setPreview(null);
										}}
										className="mt-2 w-full rounded-lg border bg-background p-3"
										placeholder="Your public chess username"
									/>
								</label>
							</div>
							<label className="my-5 flex items-center gap-3 text-xs">
								<input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
								Sync when this chess workspace opens (at most every 15 minutes)
							</label>
							<Button
								disabled={!!busy || !username.trim()}
								onClick={async () => {
									const r = await mutate(
										{ action: "preview", platform, username, autoSync },
										"Fetching a public game preview…",
									);
									if (r) setPreview(r);
								}}
							>
								Preview public games
							</Button>
							{preview && (
								<div className="mt-5 space-y-3 rounded-lg border border-[#78866b] p-4">
									<p className="text-sm">
										{preview.games} completed games ·{" "}
										{preview.timeControls.join(", ") || "no games in this window"}
									</p>
									<p className="text-xs leading-6 text-muted-foreground">{preview.coverage}</p>
									{preview.warnings.map((w, i) => (
										<p className="text-xs" key={i}>
											{w}
										</p>
									))}
									<Button
										disabled={!!busy}
										onClick={async () => {
											const r = await mutate(
												{ action: "connect", previewId: preview.previewId },
												"Committing imported games…",
											);
											if (r) {
												setPreview(null);
												setNotice(`Connected. ${r.added} new games saved.`);
											}
										}}
									>
										Confirm connection & import
									</Button>
								</div>
							)}
						</div>
						{state.connections.map((c) => (
							<div key={`${c.platform}:${c.username}`} className="rounded-xl border bg-card p-5">
								<div className="flex flex-wrap items-center justify-between gap-4">
									<div>
										<h3 className="text-sm">
											{displayPlatform(c.platform)} / {c.username}
										</h3>
										<p className="mt-2 text-xs text-muted-foreground">
											{c.status} · last sync{" "}
											{c.lastSync
												? stamp(c.lastSync) +
													" " +
													new Date(c.lastSync).toLocaleTimeString("en-GB", { timeZone: "Europe/London" })
												: "never"}
										</p>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={!!busy}
										onClick={async () => {
											const r = await mutate(
												{ action: "sync", platform: c.platform, username: c.username },
												"Syncing public games…",
											);
											if (r) setNotice(`${r.added} new games committed.`);
										}}
									>
										Sync now
									</Button>
								</div>
								<p className="my-4 text-xs leading-6 text-muted-foreground">{c.message}</p>
								<div className="flex flex-wrap gap-3">
									<Button
										variant="ghost"
										size="sm"
										disabled={!!busy}
										onClick={() =>
											void mutate(
												{ action: "disconnect", platform: c.platform, username: c.username },
												"Disconnecting…",
											)
										}
									>
										Disconnect · keep history
									</Button>
									<Button
										variant="ghost"
										size="sm"
										disabled={!!busy}
										onClick={() => {
											if (
												window.confirm(
													`Disconnect ${c.username} and delete this account's locally synced games and ratings? Manual uploads remain.`,
												)
											)
												void mutate(
													{
														action: "disconnect",
														platform: c.platform,
														username: c.username,
														clearData: true,
													},
													"Clearing synced account data…",
												);
										}}
									>
										Disconnect & clear synced data
									</Button>
								</div>
							</div>
						))}
						<p className="text-[10px] leading-6 text-muted-foreground">
							Chess.com and Lichess ratings remain separate. API outages preserve existing history. Only
							completed public games are fetched; the app has no move-playing endpoints.
						</p>
					</div>
				)}
				<footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[10px] text-muted-foreground">
					<span>LearnHarness Chess · study → practice → play → reflect</span>
					<span>Rules: chess.js · Analysis: Stockfish when available</span>
				</footer>
			</div>
		</main>
	);
}

function RatingSeries({ state }: { state: ChessState }) {
	const keys = [...new Set(state.ratings.map((r) => `${r.platform}|${r.username}|${r.speed}`))];
	return (
		<section className="rounded-xl border bg-card p-5">
			<h3 className="mb-2 text-sm">Rating history by platform and time control</h3>
			<p className="mb-5 text-[10px] leading-6 text-muted-foreground">
				Ratings use different scales. Each series stands alone; game-reconstructed history and API history
				have different coverage. Per-game ratings may precede the game's result.
			</p>
			{!keys.length && (
				<p className="text-xs text-muted-foreground">
					Connect a public account to see dated rating history. Unknown and unrated PGNs are excluded.
				</p>
			)}
			{keys.map((key) => {
				const [platform, username, speed] = key.split("|");
				const records = state.ratings.filter((r) => `${r.platform}|${r.username}|${r.speed}` === key);
				const source = records.some((r) => r.source === "api") ? "api" : "game";
				const points = records
					.filter((r) => r.source === source)
					.sort((a, b) => a.date.localeCompare(b.date));
				const low = Math.min(...points.map((p) => p.rating)) - 25;
				const high = Math.max(...points.map((p) => p.rating)) + 25;
				const start = Date.parse(points[0]!.date);
				const span = Math.max(1, Date.parse(points.at(-1)!.date) - start);
				return (
					<div className="mb-6 border-t pt-4" key={key}>
						<div className="flex items-center justify-between">
							<strong className="text-xs">
								{displayPlatform(platform!)} · {speed} · {username}
							</strong>
							<span className="text-xs">{points.at(-1)!.rating}</span>
						</div>
						<svg
							className="my-3 h-28 w-full"
							viewBox="0 0 600 100"
							preserveAspectRatio="none"
							role="img"
							aria-label={`${displayPlatform(platform!)} ${speed} rating chart, ${points.length} dated observations`}
						>
							<line x1="0" x2="600" y1="85" y2="85" stroke="currentColor" opacity="0.12" />
							<polyline
								fill="none"
								stroke="#a1ac8b"
								strokeWidth="2"
								vectorEffect="non-scaling-stroke"
								points={points
									.map(
										(p) =>
											`${10 + ((Date.parse(p.date) - start) / span) * 580},${85 - ((p.rating - low) / (high - low)) * 70}`,
									)
									.join(" ")}
							/>
							{points.map((p, i) => (
								<circle
									key={i}
									cx={10 + ((Date.parse(p.date) - start) / span) * 580}
									cy={85 - ((p.rating - low) / (high - low)) * 70}
									r="2.5"
									fill="#a1ac8b"
								>
									<title>
										{stamp(p.date)} · {p.rating}
									</title>
								</circle>
							))}
						</svg>
						<div className="flex justify-between text-[10px] text-muted-foreground">
							<span>
								{stamp(points[0]!.date)} — {stamp(points.at(-1)!.date)}
							</span>
							<span>
								{points.length} observations ·{" "}
								{
									state.games.filter(
										(g) => g.platform === platform && g.playerId === username && g.speed === speed && g.rated,
									).length
								}{" "}
								rated games · {source === "api" ? "API history" : "per-game reconstruction"}
							</span>
						</div>
						<details className="mt-3 text-[10px]">
							<summary className="cursor-pointer text-muted-foreground">View dated values</summary>
							<ul className="mt-2 max-h-36 overflow-y-auto">
								{points.map((p, i) => (
									<li key={i}>
										{stamp(p.date)} · {p.rating}
									</li>
								))}
							</ul>
						</details>
					</div>
				);
			})}
		</section>
	);
}
