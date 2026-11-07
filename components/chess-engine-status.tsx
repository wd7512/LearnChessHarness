"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import type { StockfishStatus } from "@/src/core";

export const STOCKFISH_CHANGED = "lh:stockfish-changed";
export function useStockfishStatus() {
	const [status, setStatus] = useState<StockfishStatus>();
	const [error, setError] = useState("");
	const sequence = useRef(0);
	const refresh = useCallback(async (force = false) => {
		const id = ++sequence.current;
		try {
			const r = await fetch(`/api/chess/engine${force ? "?refresh=1" : ""}`);
			if (!r.ok)
				throw new Error("The engine status could not be checked. Retry before analyzing games.");
			const data = (await r.json()) as StockfishStatus;
			if (id === sequence.current) {
				setStatus(data);
				setError("");
			}
			return data;
		} catch (e) {
			if (id === sequence.current) {
				setStatus(undefined);
				setError(e instanceof Error ? e.message : "Engine status unavailable.");
			}
			return undefined;
		}
	}, []);
	useEffect(() => {
		void refresh();
		const changed = () => {
			void refresh(true);
		};
		window.addEventListener(STOCKFISH_CHANGED, changed);
		return () => {
			sequence.current++;
			window.removeEventListener(STOCKFISH_CHANGED, changed);
		};
	}, [refresh]);
	return { status, error, refresh, available: status?.state === "ready" };
}
export function ChessEngineNotice({
	status,
	error,
	onRefresh,
}: {
	status?: StockfishStatus;
	error?: string;
	onRefresh: () => void;
}) {
	const settings = useSettingsDialog();
	return (
		<div data-testid="chess-engine-status" className="rounded-lg border p-4 text-xs" role="status">
			<p className="font-medium">
				{status?.state === "ready"
					? `${status.version} ready`
					: status
						? "Analysis needs an available engine"
						: error
							? "Engine status unavailable"
							: "Checking Stockfish…"}
			</p>
			<p className="mt-2 leading-6 text-muted-foreground">
				{error || status?.message || "Analysis will be enabled after this check completes."}
			</p>
			<div className="mt-2 flex flex-wrap items-center gap-3">
				<Button variant="link" size="sm" onClick={() => settings.open("chess")}>
					Engine settings
				</Button>
				{status?.state !== "ready" && (
					<Link href="/chess/setup" className="underline">
						Stockfish setup
					</Link>
				)}
				<Button variant="ghost" size="sm" onClick={onRefresh}>
					Check again
				</Button>
			</div>
		</div>
	);
}
