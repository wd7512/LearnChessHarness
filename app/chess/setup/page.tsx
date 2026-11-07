import Link from "next/link";
export default function ChessSetupPage() {
	return (
		<main className="h-dvh overflow-y-auto p-6 md:p-12">
			<div className="mx-auto max-w-2xl space-y-6">
				<Link href="/chess" className="text-xs underline">
					Back to Chess
				</Link>
				<h1 className="font-serif text-3xl">Stockfish setup</h1>
				<section className="space-y-3 rounded-xl border p-5">
					<h2 className="text-lg">Desktop app</h2>
					<p className="text-sm leading-7">
						Stockfish 19 is included in new desktop packages for macOS arm64/x64, Windows x64 and
						Linux x64. No command-line installation is required. If the bundled engine is missing or
						blocked by the operating system, reinstall the current desktop app, check its
						permissions, or choose another official Stockfish executable in Settings → Chess engine.
					</p>
				</section>
				<section className="space-y-3 rounded-xl border p-5">
					<h2 className="text-lg">Browser or development server</h2>
					<ol className="list-decimal space-y-3 pl-5 text-sm leading-7">
						<li>
							Download an{" "}
							<a
								href="https://stockfishchess.org/download/"
								target="_blank"
								rel="noreferrer"
								className="underline"
							>
								official Stockfish release
							</a>{" "}
							for the machine running the LearnHarness server.
						</li>
						<li>Extract it. On macOS/Linux, ensure the executable has execute permission.</li>
						<li>
							In Settings → Chess engine, enter the full executable path and choose Save and check.
							Leave the override empty to use the bundled engine, the server’s STOCKFISH_PATH, or
							stockfish on PATH.
						</li>
						<li>Return to Games. Analysis becomes available when the status check succeeds.</li>
					</ol>
					<p className="text-xs text-muted-foreground">
						A developer can also run npm run stockfish:prepare and set LH_STOCKFISH_BUNDLE_DIR to
						the generated build/stockfish folder for the host platform.
					</p>
				</section>
				<section className="space-y-3 text-xs leading-6 text-muted-foreground">
					<h2 className="text-sm text-foreground">GPL licence and corresponding source</h2>
					<p>
						Stockfish is a separate GPL-3.0-or-later executable. Desktop packages include its
						licence, authors, source/build scripts and the matching NNUE network under the app’s
						stockfish resource directory. SOURCE-AND-LICENCE.txt explains the included materials.
						The engine’s source is unchanged; the app distributor may add an operating-system code
						signature.
					</p>
					<a
						href="https://github.com/official-stockfish/Stockfish/tree/sf_19"
						className="underline"
					>
						Stockfish 19 upstream source
					</a>
				</section>
			</div>
		</main>
	);
}
