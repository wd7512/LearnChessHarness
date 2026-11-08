import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { StockfishEngine, type ChessEngine } from "../agent/chess-engine.ts";
import type { StockfishStatus } from "../core/chess-workflows.ts";

export class StockfishUnavailable extends Error {
	readonly code = "stockfish_unavailable";
	constructor(readonly engineStatus: StockfishStatus) {
		super(engineStatus.message);
	}
}
type ReadyEngine = ChessEngine & { ready(): Promise<void> };
export interface ChessEngineProvider {
	status(force?: boolean): Promise<StockfishStatus>;
	open(): Promise<ChessEngine>;
}
export class StockfishRuntime {
	private cached?: { key: string; at: number; value: StockfishStatus };
	constructor(
		private configFile = path.join(PATHS.data, "chess", "engine.json"),
		private create: (executable: string, probe: boolean) => ReadyEngine = (exe, probe) =>
			new StockfishEngine(probe ? { depth: 1, nodes: 200 } : { depth: 12, nodes: 100_000 }, exe),
		private environment: () => NodeJS.ProcessEnv = () => process.env,
	) {}
	private configuration() {
		let overridePath = "";
		if (fs.existsSync(this.configFile)) {
			const saved = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
			if (saved.version !== 1 || typeof saved.executablePath !== "string")
				throw new Error(
					"The chess engine settings file is invalid. Restore it before changing engine settings.",
				);
			overridePath = saved.executablePath;
		}
		const env = this.environment();
		const source: StockfishStatus["source"] = overridePath
			? "override"
			: env.STOCKFISH_PATH
				? "environment"
				: env.LH_STOCKFISH_BUNDLE_DIR
					? "bundled"
					: "path";
		const executablePath =
			overridePath ||
			env.STOCKFISH_PATH ||
			(env.LH_STOCKFISH_BUNDLE_DIR
				? path.join(
						env.LH_STOCKFISH_BUNDLE_DIR,
						process.platform === "win32" ? "stockfish.exe" : "stockfish",
					)
				: "stockfish");
		return { source, executablePath, overridePath };
	}
	private unavailable(config: ReturnType<StockfishRuntime["configuration"]>): StockfishStatus {
		return {
			...config,
			state: "unavailable",
			version: null,
			setupUrl: "/chess/setup",
			message:
				config.source === "bundled"
					? "The bundled Stockfish engine could not start. Reinstall the desktop app, or choose another Stockfish executable in Settings → Chess engine."
					: config.source === "override" || config.source === "environment"
						? "The selected Stockfish executable could not start. Check the path and execute permission in Settings → Chess engine, or clear the override to use the default engine."
						: "Stockfish is not available on this browser server. Download the engine for the server's operating system, then select its executable in Settings → Chess engine. Desktop installs include it automatically.",
		};
	}
	async status(force = false): Promise<StockfishStatus> {
		const config = this.configuration();
		const key = JSON.stringify(config);
		if (!force && this.cached?.key === key && Date.now() - this.cached.at < 10_000)
			return this.cached.value;
		let engine: ReadyEngine | undefined;
		let value: StockfishStatus;
		try {
			engine = this.create(config.executablePath, true);
			await engine.ready();
			await engine.evaluate("8/4k3/8/4K3/4P3/8/8/8 w - - 0 1");
			value = {
				...config,
				state: "ready",
				version: engine.name,
				message: `${engine.name} is ready for analysis.`,
				setupUrl: "/chess/setup",
			};
		} catch {
			value = this.unavailable(config);
		} finally {
			engine?.close();
		}
		this.cached = { key, at: Date.now(), value };
		return value;
	}
	async open(): Promise<ChessEngine> {
		const config = this.configuration();
		let engine: ReadyEngine | undefined;
		try {
			engine = this.create(config.executablePath, false);
			await engine.ready();
			return engine;
		} catch {
			engine?.close();
			const status = this.unavailable(config);
			this.cached = {
				key: JSON.stringify(config),
				at: Date.now(),
				value: status,
			};
			throw new StockfishUnavailable(status);
		}
	}
	async saveOverride(executablePath: string) {
		const selected = executablePath.trim();
		if (selected && (!path.isAbsolute(selected) || selected.includes("\0")))
			throw new Error(
				"Enter the full executable path without quotation marks, or leave it empty to use the default engine.",
			);
		fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
		const temp = `${this.configFile}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temp, JSON.stringify({ version: 1, executablePath: selected }), {
				mode: 0o600,
			});
			fs.renameSync(temp, this.configFile);
		} finally {
			if (fs.existsSync(temp)) fs.unlinkSync(temp);
		}
		this.cached = undefined;
		return this.status(true);
	}
}
const runtimeGlobal = globalThis as typeof globalThis & {
	__lhStockfish?: StockfishRuntime;
};
export const stockfishRuntime = (runtimeGlobal.__lhStockfish ??= new StockfishRuntime());
