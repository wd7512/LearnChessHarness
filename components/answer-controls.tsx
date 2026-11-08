"use client";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";
import { PathInput } from "@/components/path-input";
import { CONFIDENCE_COLORS, confidenceRailStyle } from "@/components/confidence-rail";
import { CONFIDENCE_STOPS } from "@/src/core";
import { cn } from "@/lib/utils";

export function nearestConfidenceIndex(value: number) {
	return CONFIDENCE_STOPS.reduce(
		(best, stop, i) =>
			Math.abs(stop - value) < Math.abs(CONFIDENCE_STOPS[best]! - value) ? i : best,
		0,
	);
}
/** The same six stops, labels, rail and selected states on every answer surface. */
export function ConfidenceControl({
	index,
	onChange,
	disabled = false,
	muted = false,
	globalKeyboard = false,
}: {
	index: number;
	onChange: (index: number) => void;
	disabled?: boolean;
	muted?: boolean;
	globalKeyboard?: boolean;
}) {
	return (
		<div className="border-t border-border/60 px-4 py-2.5">
			<div className="flex items-center gap-3">
				<span
					className={cn(
						"shrink-0 text-xs font-medium uppercase tracking-wide",
						muted ? "text-muted-foreground/50" : "text-muted-foreground",
					)}
				>
					Confidence
				</span>
				<div
					className={cn("relative h-4 min-w-0 flex-1", (muted || disabled) && "opacity-40")}
					data-testid="confidence-track"
				>
					<div
						aria-hidden
						data-testid="confidence-rail"
						className="pointer-events-none absolute top-1/2 left-2 right-2 h-1.5 -translate-y-1/2 rounded-full border border-border"
						style={confidenceRailStyle(CONFIDENCE_STOPS[index]!)}
					/>
					<input
						type="range"
						min={0}
						max={100}
						step={1}
						value={CONFIDENCE_STOPS[index]}
						disabled={disabled || muted}
						aria-label="Confidence — the probability your selected answer is correct"
						aria-valuetext={`${CONFIDENCE_STOPS[index]} percent`}
						title="The probability your selected answer is correct — 50% is a coin flip. Adjust with ←/→."
						data-testid="confidence-slider"
						onChange={(e) => onChange(nearestConfidenceIndex(Number(e.target.value)))}
						onKeyDown={(e) => {
							if (
								!globalKeyboard &&
								!e.altKey &&
								!e.metaKey &&
								!e.ctrlKey &&
								["ArrowLeft", "ArrowRight"].includes(e.key)
							) {
								e.preventDefault();
								e.stopPropagation();
								onChange(
									Math.max(
										0,
										Math.min(
											CONFIDENCE_STOPS.length - 1,
											index + (e.key === "ArrowRight" ? 1 : -1),
										),
									),
								);
							}
						}}
						style={{ color: CONFIDENCE_COLORS[index] }}
						className={cn(
							"absolute inset-0 h-4 w-full cursor-pointer appearance-none bg-transparent outline-none",
							"[&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:bg-transparent",
							"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current",
							"[&::-moz-range-track]:h-4 [&::-moz-range-track]:bg-transparent",
							"[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current",
						)}
					/>
				</div>
				<span
					data-testid="confidence-value"
					className={cn(
						"w-9 shrink-0 text-right font-mono text-sm tabular-nums",
						muted && "text-muted-foreground/50",
					)}
				>
					{muted ? "—" : `${CONFIDENCE_STOPS[index]}%`}
				</span>
			</div>
		</div>
	);
}
/** The established composer-shaped reasoning field and submit row, shared with chess. */
export function AnswerField({
	value,
	onChange,
	onSubmit,
	onEscape,
	canSubmit,
	disabled = false,
	label = "YOUR THINKING",
	placeholder = "Why this answer? Whatever comes to mind.",
	submitLabel = "Submit answer",
	testId = "thinking-field",
	submitTestId,
	inputRef,
	tall = false,
	dictationSlot,
	readOnly = false,
	hint,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onEscape?: () => void;
	canSubmit: boolean;
	disabled?: boolean;
	label?: string;
	placeholder?: string;
	submitLabel?: string;
	testId?: string;
	submitTestId?: string;
	inputRef?: Ref<HTMLDivElement>;
	tall?: boolean;
	dictationSlot?: ReactNode;
	readOnly?: boolean;
	hint?: string;
}) {
	function keyDown(e: KeyboardEvent<HTMLDivElement>) {
		if (e.key === "Escape" && onEscape) {
			e.preventDefault();
			e.stopPropagation();
			onEscape();
		}
		if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			if (canSubmit && !disabled) onSubmit();
		}
	}
	return (
		<form
			className="border-t border-border/60 p-1.5"
			onSubmit={(e) => {
				e.preventDefault();
				if (canSubmit && !disabled) onSubmit();
			}}
		>
			<div
				data-testid={testId}
				className="rounded-[10px] border border-border/70 bg-background/60 transition-colors focus-within:border-primary/50"
			>
				<div className="px-2.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</div>
				<div inert={readOnly || undefined}>
					<PathInput
						ref={inputRef}
						aria-label={label === "YOUR THINKING" ? "Your thinking" : label}
						value={value}
						onValueChange={(v) => {
							if (!readOnly) onChange(v);
						}}
						aria-disabled={readOnly}
						onKeyDown={keyDown}
						placeholder={placeholder}
						className={cn(
							"field-sizing-content lh-input max-h-48 w-full resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground/70",
							tall ? "min-h-[4.5rem]" : "min-h-10",
						)}
					/>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-2 p-1">
					<span aria-hidden className="pl-1.5 text-xs text-muted-foreground">
						{hint ?? "↵ submits · ⇧↵ newline"}
					</span>
					{dictationSlot && <div className="min-w-28 flex-1">{dictationSlot}</div>}
					<Button
						type="submit"
						data-testid={submitTestId}
						disabled={!canSubmit || disabled}
						className="ml-auto h-9 rounded-[6px] px-3.5 text-sm font-medium"
					>
						{submitLabel}
					</Button>
				</div>
			</div>
		</form>
	);
}
