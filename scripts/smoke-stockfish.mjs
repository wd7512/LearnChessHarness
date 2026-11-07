import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function verifyStockfishBundle(directory, { execute = true } = {}) {
	const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
	for (const file of [
		manifest.executable,
		"COPYING-GPL-3.0.txt",
		"AUTHORS",
		"SOURCE-AND-LICENCE.txt",
		"source/src/Makefile",
		`source/src/${manifest.network}`,
	])
		if (!(await fs.stat(path.join(directory, file))).isFile())
			throw new Error(`Stockfish package is missing ${file}`);
	if (!execute)
		return {
			target: manifest.target,
			version: manifest.version,
			executed: false,
		};
	const executable = path.join(directory, manifest.executable);
	return new Promise((resolve, reject) => {
		const child = spawn(executable, [], {
			env: { ...process.env, STOCKFISH_PATH: "", PATH: "" },
			stdio: "pipe",
		});
		let output = "";
		let phase = 0;
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill();
			if (error) reject(error);
			else
				resolve({
					target: manifest.target,
					version: manifest.version,
					executed: true,
				});
		};
		const timer = setTimeout(
			() => finish(new Error("Bundled Stockfish did not complete a fresh UCI analysis.")),
			20_000,
		);
		child.on("error", finish);
		child.on("exit", () => {
			if (!settled) finish(new Error("Bundled Stockfish exited before returning an analysis."));
		});
		child.stderr.resume();
		child.stdin.on("error", () => {});
		child.stdout.on("data", (chunk) => {
			output += String(chunk);
			if (phase === 0 && output.includes("uciok")) {
				if (!output.includes(`id name Stockfish ${manifest.version}`))
					return finish(new Error("Bundled engine version mismatch."));
				phase = 1;
				child.stdin.write("isready\n");
			}
			if (phase === 1 && output.includes("readyok")) {
				phase = 2;
				child.stdin.write("position startpos\ngo depth 1\n");
			}
			if (phase === 2 && /bestmove [a-h][1-8][a-h][1-8]/.test(output)) finish();
		});
		child.stdin.write("uci\n");
	});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const osName =
		process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
	const dir =
		process.argv[2] ||
		path.resolve(import.meta.dirname, "..", "build", "stockfish", `${osName}-${process.arch}`);
	console.log(JSON.stringify(await verifyStockfishBundle(dir)));
}
