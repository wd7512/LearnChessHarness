/** Stage an official, pinned native engine and its complete rebuild inputs before packaging. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { inflateRawSync, crc32 } from "node:zlib";
import assets from "./stockfish-assets.json" with { type: "json" };
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const hash = (data) => createHash("sha256").update(data).digest("hex");

/** The official Windows ZIP uses ordinary deflate entries, below ZIP64 limits. */
async function extractZip(archive, destination) {
	const data = await fs.readFile(archive);
	let end = data.length - 22;
	while (end >= Math.max(0, data.length - 65557) && data.readUInt32LE(end) !== 0x06054b50) end--;
	if (end < Math.max(0, data.length - 65557)) throw new Error("Invalid Stockfish ZIP directory.");
	const count = data.readUInt16LE(end + 10);
	let offset = data.readUInt32LE(end + 16);
	let bytes = 0;
	for (let i = 0; i < count; i++) {
		if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP member.");
		const flags = data.readUInt16LE(offset + 8);
		const method = data.readUInt16LE(offset + 10);
		const expectedCrc = data.readUInt32LE(offset + 16);
		const compressed = data.readUInt32LE(offset + 20);
		const size = data.readUInt32LE(offset + 24);
		const nameLength = data.readUInt16LE(offset + 28);
		const extraLength = data.readUInt16LE(offset + 30);
		const commentLength = data.readUInt16LE(offset + 32);
		const local = data.readUInt32LE(offset + 42);
		const name = data
			.subarray(offset + 46, offset + 46 + nameLength)
			.toString("utf8")
			.replaceAll("\\", "/");
		if (
			flags & 1 ||
			![0, 8].includes(method) ||
			name.includes("\0") ||
			name.startsWith("/") ||
			/^[a-z]:/i.test(name) ||
			name.split("/").includes("..") ||
			[compressed, size, local].includes(0xffffffff)
		)
			throw new Error("Unsupported or unsafe ZIP member.");
		const mode = data.readUInt32LE(offset + 38) >>> 16;
		if ((mode & 0o170000) === 0o120000) throw new Error("ZIP symlinks are not allowed.");
		const target = path.join(destination, name);
		if (name.endsWith("/")) await fs.mkdir(target, { recursive: true });
		else {
			if (data.readUInt32LE(local) !== 0x04034b50) throw new Error("Invalid ZIP local header.");
			const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
			const content =
				method === 8
					? inflateRawSync(data.subarray(start, start + compressed), {
							maxOutputLength: 160 * 1024 * 1024,
						})
					: data.subarray(start, start + compressed);
			bytes += content.length;
			if (content.length !== size || crc32(content) !== expectedCrc || bytes > 512 * 1024 * 1024)
				throw new Error("ZIP member failed size or CRC verification.");
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, content);
		}
		offset += 46 + nameLength + extraLength + commentLength;
	}
}

async function download(url, destination, expected) {
	try {
		const data = await fs.readFile(destination);
		if (!expected || hash(data) === expected) return;
	} catch {
		/* cache miss */
	}
	await fs.mkdir(path.dirname(destination), { recursive: true });
	const { stdout } = await exec(
		process.platform === "win32" ? "curl.exe" : "curl",
		[
			"--fail",
			"--location",
			"--silent",
			"--show-error",
			"--max-time",
			"180",
			url,
			"--output",
			destination,
		],
		{ maxBuffer: 1024 * 1024 },
	);
	void stdout;
	const data = await fs.readFile(destination);
	if (expected && hash(data) !== expected) {
		await fs.rm(destination, { force: true });
		throw new Error("Stockfish archive integrity check failed.");
	}
}
export async function prepareStockfish({
	platform = process.platform,
	arch = process.arch,
	projectDir = root,
	cacheDir = path.join(projectDir, "work", "stockfish-cache"),
	outputDir,
} = {}) {
	const target = `${platform}-${arch}`;
	const asset = assets.assets[target];
	if (!asset)
		throw new Error(
			`No bundled Stockfish is configured for ${target}. Supported desktop targets: macOS arm64/x64, Windows x64, Linux x64.`,
		);
	const osName = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
	const output = outputDir ?? path.join(projectDir, "build", "stockfish", `${osName}-${arch}`);
	const archive = path.join(cacheDir, asset.name);
	const url = `https://github.com/official-stockfish/Stockfish/releases/download/${assets.tag}/${asset.name}`;
	await download(url, archive, asset.sha256);
	const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "lh-stockfish-stage-"));
	try {
		if (asset.name.endsWith(".zip")) {
			await extractZip(archive, scratch);
		} else {
			const listing = (await exec("tar", ["-tf", archive], { maxBuffer: 4 * 1024 * 1024 })).stdout
				.trim()
				.split(/\r?\n/);
			if (listing.some((p) => p.startsWith("/") || p.split(/[\\/]/).includes("..")))
				throw new Error("Unsafe archive member.");
			await exec("tar", ["-xf", archive, "-C", scratch]);
		}
		async function find(directory, name) {
			for (const entry of await fs.readdir(directory, {
				withFileTypes: true,
			})) {
				const full = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					const found = await find(full, name);
					if (found) return found;
				} else if (entry.name === name) return full;
			}
		}
		const binary = await find(scratch, asset.executable);
		const copying = await find(scratch, "Copying.txt");
		if (!binary || !copying)
			throw new Error("Official Stockfish archive is missing the binary or GPL licence.");
		const sourceRoot = path.dirname(copying);
		if (
			!(await fs.readFile(path.join(sourceRoot, "src", "evaluate.h"), "utf8")).includes(
				assets.network,
			)
		)
			throw new Error("The bundled NNUE network does not match the official source revision.");
		await fs.mkdir(output, { recursive: true });
		const executable = path.join(output, platform === "win32" ? "stockfish.exe" : "stockfish");
		await fs.copyFile(binary, executable);
		await fs.chmod(executable, 0o755);
		await fs.copyFile(copying, path.join(output, "COPYING-GPL-3.0.txt"));
		await fs.copyFile(path.join(sourceRoot, "AUTHORS"), path.join(output, "AUTHORS"));
		const source = path.join(output, "source");
		await fs.mkdir(source, { recursive: true });
		for (const entry of ["src", "scripts", "wiki", "README.md", "Copying.txt", "AUTHORS"])
			await fs.cp(path.join(sourceRoot, entry), path.join(source, entry), {
				recursive: true,
			});
		// Include the exact NNUE rebuild input. Official names carry a SHA-256 prefix.
		const networkCache = path.join(cacheDir, assets.network);
		await download(
			`https://tests.stockfishchess.org/api/nn/${assets.network}`,
			networkCache,
			assets.networkSha256,
		);
		const networkDigest = hash(await fs.readFile(networkCache));
		if (!assets.network.includes(networkDigest.slice(0, 12)))
			throw new Error(
				"Stockfish network hash does not match its official content-addressed filename.",
			);
		await fs.copyFile(networkCache, path.join(source, "src", assets.network));
		await fs.writeFile(
			path.join(output, "SOURCE-AND-LICENCE.txt"),
			`Stockfish ${assets.version}, unmodified official ${assets.tag} native engine.\nCopyright: The Stockfish developers; see AUTHORS.\nLicence: GNU GPL version 3 or later; see COPYING-GPL-3.0.txt.\nSource and build scripts are included in source/, with the exact embedded NNUE network.\nUpstream source: ${assets.sourceUrl}\nBuild instructions: source/README.md and source/src/Makefile.\nThis application does not impose additional restrictions on the Stockfish component.\nThe application distributor may add an operating-system code signature; engine source is unchanged.\n`,
		);
		await fs.writeFile(
			path.join(output, "manifest.json"),
			JSON.stringify(
				{
					version: assets.version,
					target,
					archiveUrl: url,
					archiveSha256: asset.sha256,
					sourceUrl: assets.sourceUrl,
					network: assets.network,
					networkSha256: networkDigest,
					executable: path.basename(executable),
					binarySha256: hash(await fs.readFile(executable)),
				},
				null,
				2,
			),
		);
		return { output, executable };
	} finally {
		await fs.rm(scratch, { recursive: true, force: true });
	}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await prepareStockfish({
		platform: process.argv[2] || process.platform,
		arch: process.argv[3] || process.arch,
	});
	console.log(`[Stockfish] ready: ${result.output}`);
}
