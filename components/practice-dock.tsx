"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { AnswerField } from "@/components/answer-controls";
import { finishDictation, joinDictation, useDictationTarget } from "@/components/dictation";
import { useEnterSubmits } from "@/components/enter-submits";
import { ChessBoard } from "@/components/chess-board";
import { ChessDiagram } from "@/components/chess-diagram";
import { questionDiagram } from "@/src/core";
import { parseChessQuestion } from "@/src/core";

/**
 * The practice dock (practice sessions, owner design 2026-10-04): an
 * ACTIVE problem replaces the chat composer — the persistent bottom blob
 * morphs into the problem. The agent's statement above; the learner's
 * half below — "Your thinking", a labeled field with ONE Send button
 * (owner round 2, 2026-10-05): Enter sends, Shift+Enter makes a newline.
 * There are no lanes — whether a submission claims an answer is apparent
 * from the thinking itself; the agent reads it. One problem may carry
 * many submissions; each starts a turn.
 *
 * Collapse (scroll-up → slim bar) is owned by the DockOverlay; this
 * component is content only, and the expanded form stays MOUNTED while
 * collapsed (hidden) so a half-written trace survives scrolling.
 *
 * The commitment (modelSolution, decisionPoints, …) rides the tool call's
 * arguments and is NOT rendered here — only the statement is the
 * learner's. Esc dismisses the problem (the layered-Esc chain; the
 * confirm dialog then the silent route) — claimed by the page, not here.
 */

export interface PracticeDockProps {
	/** The active problem's tool-call id (submissions target it). */
	problemCallId: string;
	/** The pose's arguments — only the statement is the learner's (the
	 *  mode badge would edge toward announcing the target; dropped). */
	input: { statement: string; chess?: unknown; position?: unknown };
	/** Collapse state, owned by the DockOverlay. */
	expanded: boolean;
	onExpand: () => void;
	/** text — POST {type:"thinking"} (one lane; the register is read from the text). */
	onSubmit: (text: string) => void;
	/** Escape in the thinking field stops dictation (threaded from the page). */
	onEscape?: () => void;
	/** Compaction is running for this chat (owner round 14): the thinking
	 *  POST would block on the server's compaction gate — disable submit
	 *  and say so in the hint row. The server registry is the real gate;
	 *  this is the affordance. */
	compactionRunning?: boolean;
}

export function PracticeDock({ problemCallId, input, expanded, onExpand, onSubmit, onEscape, compactionRunning = false }: PracticeDockProps) {
	const [thinking, setThinking] = useState("");
	const [hintOpen, setHintOpen] = useState(false);
	const chess = parseChessQuestion(input.chess);
	// Ref MIRRORS the field ("nothing gets lost", the question-dock
	// discipline): a submit resuming after `await finishDictation()` reads
	// the tail, never a stale closure.
	const thinkingRef = useRef("");

	useDictationTarget(
		useCallback(
			(t: string) => {
				const v = joinDictation(thinkingRef.current, t);
				thinkingRef.current = v;
				setThinking(v);
			},
			[],
		),
		!chess || hintOpen,
	);

	const submit = () => {
		if (compactionRunning) return;
		const text = thinkingRef.current.trim();
		if (text.length === 0) return;
		thinkingRef.current = "";
		setThinking("");
		onSubmit(text);
	};

	/* ENTER SUBMITS FROM ANYWHERE (owner round 6, 2026-10-05): dictation
	 * means the field is often never focused — the window-level Enter
	 * (typing surfaces and buttons excluded) submits the trace. Mounted
	 * while the dock is — collapsed bar included (the trace survives). */
	useEnterSubmits(() => { if (!chess || hintOpen) void finishDictation().then(submit); });

	/* ── the collapsed bar ── */
	const collapsedBar = !expanded ? (
			<button
				type="button"
				data-testid="practice-dock-bar"
				onClick={onExpand}
				className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon className="size-4 shrink-0 rotate-90" />
				<span className="font-medium">Problem</span>
				<span className="min-w-0 flex-1 truncate">{input.statement}</span>
			</button>
		) : null;

	// Chess reasoning remains the dictation target while the board is folded.
	if (!expanded && !chess) return collapsedBar;

	/* ── the expanded form ── */
	return (
		<>
		{collapsedBar}
		<div hidden={!expanded} data-testid="practice-dock" data-problem={problemCallId}>
			{/* The agent's half: the 'Problem' eyebrow (mirroring the quiz
			    cards' label row — owner round, 2026-10-05) + the statement,
			    markdown + LaTeX rendered, capped by the measured column
			    (--dock-max-h; the old fixed 40vh cut long problems short). */}
			<div data-dock-scroll-area="" className="max-h-[var(--dock-max-h,40vh)] overflow-y-auto px-4 pt-3 pb-2">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Problem</div>
				<div className="lh-prose text-[15px]">
					<ToolContentResponse>{input.statement}</ToolContentResponse>
				</div>
				{questionDiagram(input) && <ChessDiagram position={questionDiagram(input)!} />}
			</div>
			{chess && (
				<div className="max-h-[65vh] overflow-auto p-4"><ChessBoard keyboardSubmit={expanded} question={chess} dictationClaim={!hintOpen} onEscape={onEscape} draftKey={problemCallId} disabled={compactionRunning} onSubmit={(answer) => onSubmit(JSON.stringify({ chessAnswer: answer }))} /></div>
			)}

			{/* The learner's half: Enter SENDS (owner round 2, 2026-10-05);
			    Shift+Enter makes a newline — less to decide about. */}
			{chess ? <details onToggle={e => setHintOpen(e.currentTarget.open)} className="mt-2"><summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground">Ask your tutor or request a hint</summary><AnswerField value={thinking} onChange={value => { thinkingRef.current = value; setThinking(value); }} onSubmit={() => void finishDictation().then(submit)} onEscape={onEscape} canSubmit={thinking.trim().length > 0} disabled={compactionRunning} hint={compactionRunning ? "compacting session…" : undefined} testId="practice-thinking-field" submitTestId="practice-send" submitLabel="Submit thinking" placeholder="Work here, think out loud." tall /></details> : <AnswerField value={thinking} onChange={value => { thinkingRef.current = value; setThinking(value); }} onSubmit={() => void finishDictation().then(submit)} onEscape={onEscape} canSubmit={thinking.trim().length > 0} disabled={compactionRunning} hint={compactionRunning ? "compacting session…" : undefined} testId="practice-thinking-field" submitTestId="practice-send" submitLabel="Submit thinking" placeholder="Work here, think out loud." tall />}
		</div>
		</>
	);
}
