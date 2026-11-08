const { Arch } = require("builder-util");
module.exports = async function beforePack(context) {
	const { prepareStockfish } = await import("./prepare-stockfish.mjs");
	await prepareStockfish({
		platform: context.electronPlatformName,
		arch: Arch[context.arch],
		projectDir: context.packager.info.projectDir,
	});
};
