"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STOCKFISH_CHANGED, useStockfishStatus } from "@/components/chess-engine-status";

export function ChessEngineSection() {
	const { status, error, refresh } = useStockfishStatus();
	const [executablePath, setExecutablePath] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState("");
	useEffect(() => {
		if (status) setExecutablePath(status.overridePath);
	}, [status]);
	async function save() {
		setSaving(true);
		setSaveError("");
		try {
			const r = await fetch("/api/chess/engine", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ executablePath }),
			});
			const body = await r.json();
			if (!r.ok) throw new Error(body.error);
			window.dispatchEvent(new Event(STOCKFISH_CHANGED));
			await refresh(true);
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : "Engine settings could not be saved.");
		} finally {
			setSaving(false);
		}
	}
	return (
		<div data-testid="chess-engine-settings" className="space-y-5 text-sm">
			<div role="status">
				<p className="font-medium">
					{status?.state === "ready"
						? `${status.version} is ready`
						: status
							? "Stockfish unavailable"
							: "Checking engine…"}
				</p>
				<p className="mt-2 text-xs leading-6 text-muted-foreground">{error || status?.message}</p>
				{status && (
					<dl className="mt-3 space-y-2 text-xs">
						<div>
							<dt className="text-muted-foreground">Engine source</dt>
							<dd>{status.source}</dd>
						</div>
						<div>
							<dt className="text-muted-foreground">Executable</dt>
							<dd className="break-all">{status.executablePath}</dd>
						</div>
					</dl>
				)}
			</div>
			<p className="text-xs leading-6 text-muted-foreground">
				Desktop installs include Stockfish. For a browser server, the engine runs on the server
				machine. An override is optional and applies to both game review and tutor analysis tools.
			</p>
			<label className="block text-xs">
				Optional executable-path override
				<input
					aria-label="Stockfish executable override"
					value={executablePath}
					onChange={(e) => setExecutablePath(e.target.value)}
					placeholder="Leave empty to use the default engine"
					className="mt-2 w-full rounded border bg-background p-3"
				/>
			</label>
			{saveError && (
				<p role="alert" className="text-xs text-destructive">
					{saveError}
				</p>
			)}
			<div className="flex flex-wrap gap-3">
				<Button disabled={saving || !status} onClick={() => void save()}>
					{saving ? "Saving…" : "Save and check"}
				</Button>
				<Button variant="outline" disabled={saving} onClick={() => void refresh(true)}>
					Check again
				</Button>
			</div>
			<Link href="/chess/setup" className="block text-xs underline">
				Setup, source code and GPL licence information
			</Link>
		</div>
	);
}
