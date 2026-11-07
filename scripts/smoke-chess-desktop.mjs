/** Fresh-profile import → bundled engine discovery → real game analysis. No model/account/system engine. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { probeEnv } from "./smoke-demo-runtime.mjs";
import { verifyStockfishBundle } from "./smoke-stockfish.mjs";
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const root = path.resolve(import.meta.dirname, "..");
const payload = path.resolve(arg("--standalone") || path.join(root, ".next/standalone"));
const osName = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
const bundle = path.resolve(arg("--bundle") || (arg("--standalone") ? path.join(payload, "../../stockfish") : path.join(root, "build/stockfish", `${osName}-${process.arch}`)));
const runtime = arg("--runtime") ? path.resolve(arg("--runtime")) : createRequire(import.meta.url)("electron");
await verifyStockfishBundle(bundle);
const home = await fs.mkdtemp(path.join(os.tmpdir(), "lh-chess-desktop-"));
await fs.writeFile(path.join(home, "auth.json"), "{}");
const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}`;
let tail = ""; let failure;
const child = spawn(runtime, [path.join(payload, "server.js")], { cwd: payload, env: { ...probeEnv(process.env, home), ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", LH_DATA_DIR: path.join(home, "data"), LH_AUTH_FILE: path.join(home, "auth.json"), LH_STOCKFISH_BUNDLE_DIR: bundle, STOCKFISH_PATH: "", PATH: "" }, stdio: ["ignore", "pipe", "pipe"] });
const exited = new Promise(resolve => { child.on("exit", resolve); child.on("error", error => { failure = error; resolve(); }); });
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { tail = (tail + chunk).slice(-6000); });
async function request(route, input) { const r = await fetch(base + route, { method: input ? "POST" : "GET", headers: { Origin: base, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(45_000) }); const body = await r.json(); assert.ok(r.ok, `${route}: ${body.error || r.status}`); return body; }
try {
	const deadline = Date.now() + 45_000;
	while (true) {
		if (failure || child.exitCode !== null) throw failure || new Error("Packaged server exited before readiness.");
		try { const r = await fetch(base + "/api/settings", { signal: AbortSignal.timeout(1000) }); if (r.ok) break; } catch { /* booting */ }
		if (Date.now() > deadline) throw new Error("Packaged chess server did not start.");
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	const status = await request("/api/chess/engine");
	assert.equal(status.state, "ready"); assert.equal(status.source, "bundled"); assert.equal(status.overridePath, ""); assert.match(status.version, /Stockfish 19/);
	const pgn = (await fs.readFile(path.join(root, "tests/fixtures/chess-games.pgn"), "utf8")).split(/\n\s*\n(?=\[Event)/)[0];
	assert.equal((await request("/api/chess", { action: "import", pgn, playerId: "Learner" })).added, 1);
	const initial = await request("/api/chess/history"); assert.equal(initial.importedGames, 1); assert.equal(initial.completedAnalyses, 0);
	const state = await request("/api/chess");
	await request("/api/chess", { action: "analyze", gameId: state.games[0].id });
	const analyzed = await request("/api/chess/history"); assert.equal(analyzed.completedAnalyses, 1);
	const saved = await request("/api/chess"); assert.equal(saved.analyses[0].status, "complete"); assert.ok(saved.analyses[0].positions.length > 0);
	assert.equal(await fs.stat(path.join(home, "data/chess/engine.json")).then(() => true, () => false), false);
	console.log(JSON.stringify({ runtime: "packaged Electron Node", engine: status.version, source: status.source, freshProfile: true, configuredOverride: false, systemEnginePath: false, imported: 1, analyzed: 1, positions: saved.analyses[0].positions.length }));
} catch (error) { console.error(tail); throw error; }
finally { child.kill(); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]); if (child.exitCode === null) child.kill("SIGKILL"); await exited; await fs.rm(home, { recursive: true, force: true }); }
