import { Chess } from "chess.js";
import type { ChessQuestion } from "./chess.ts";

export interface ChessConceptCard {
	concept_id: string;
	title: string;
	prerequisites: string[];
	principle: string;
	exceptions: string;
	sources: { title: string; url: string; authority: string }[];
	illustrativeFens: string[];
	questionObjectives: string[];
	revision: number;
	reviewedAt: string;
}
const start = new Chess().fen();
const king = "6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1";
const endgame = "8/4k3/8/4K3/4P3/8/8/8 w - - 0 1";
const ruleSource = {
	title: "FIDE Laws of Chess",
	url: "https://handbook.fide.com/chapter/E012023",
	authority: "rules",
};
const lessons: [string, string, string[], string, string, string][] = [
	[
		"piece-safety",
		"Keep your pieces safe",
		[],
		"Before committing, count attackers and defenders and inspect forcing replies.",
		"A sacrifice can be sound when a concrete continuation justifies it; material counts alone do not settle it.",
		start,
	],
	[
		"checks-captures-threats",
		"Checks, captures and threats",
		["piece-safety"],
		"Look for forcing moves for both players before selecting a quiet move.",
		"Not every check is useful; compare the resulting position.",
		start,
	],
	[
		"knight-forks",
		"Knight forks",
		["checks-captures-threats"],
		"Look for knight destinations that attack two valuable targets, especially with check.",
		"A fork fails if the knight can be captured or a stronger forcing move intervenes.",
		start,
	],
	[
		"pins",
		"Pins and pressure",
		["piece-safety"],
		"A pinned piece may be unable to defend a target effectively.",
		"A relative pin can be broken when the tactical payoff exceeds the loss behind it.",
		start,
	],
	[
		"skewers",
		"Skewers",
		["checks-captures-threats"],
		"A line attack can force a valuable piece away and expose a target behind it.",
		"Check intervening captures and blocks before assuming the second target falls.",
		start,
	],
	[
		"discovered-attacks",
		"Discovered attacks",
		["checks-captures-threats"],
		"Moving a blocking piece can uncover a second threat from a long-range piece.",
		"The moving piece must not expose its own king to check.",
		start,
	],
	[
		"removing-defender",
		"Remove the defender",
		["piece-safety"],
		"Identify the piece holding a position together and calculate exchanges or deflections against it.",
		"A replacement defender or counterattack may preserve the position.",
		start,
	],
	[
		"calculation",
		"Calculate the reply",
		["checks-captures-threats"],
		"Compare candidate moves by calculating the opponent's strongest forcing reply.",
		"Bounded search is fallible; mark uncertainty instead of declaring a forced result without proof.",
		start,
	],
	[
		"development",
		"Develop with purpose",
		[],
		"Bring minor pieces into play, contest the centre, and coordinate before starting an attack.",
		"A concrete threat may justify moving a developed piece again.",
		start,
	],
	[
		"centre",
		"Influence the centre",
		[],
		"Central pawns and pieces influence useful squares and create room for development.",
		"A centre can be controlled with pieces from a distance; pawn occupation is not mandatory.",
		start,
	],
	[
		"opening-tempi",
		"Use opening tempi",
		["development"],
		"Avoid repeated piece moves and premature queen adventures unless they achieve a concrete purpose.",
		"A forcing gain of material or necessary defense can justify an apparent loss of time.",
		start,
	],
	[
		"castling",
		"Castle safely",
		["development", "king-safety"],
		"Castling often moves the king away from central files and connects the rooks.",
		"Castling into a prepared attack may be worse; castling is illegal through check.",
		start,
	],
	[
		"king-safety",
		"Good king positioning",
		[],
		"In positions with queens and active attackers, seek shelter and reduce open lines toward your king.",
		"In a simplified endgame, the king becomes a fighting piece; shelter is contextual.",
		king,
	],
	[
		"pawn-shield",
		"Preserve useful king shelter",
		["king-safety"],
		"Pawn moves near a castled king can create lasting entry squares and open lines.",
		"A timely pawn move can prevent mate or gain essential space.",
		king,
	],
	[
		"back-rank",
		"Back-rank awareness",
		["king-safety"],
		"Notice when a king has no safe escape square against a rook or queen on its back rank.",
		"A safe escape square is only useful if it is not controlled; creating luft can cost a critical tempo.",
		king,
	],
	[
		"open-files",
		"Rooks on open files",
		["development"],
		"Coordinate rooks on files without pawns and seek useful entry squares.",
		"An open file without an entry square may offer little; opponent threats take priority.",
		start,
	],
	[
		"pawn-structure",
		"Pawn structure",
		["centre"],
		"Pawn exchanges shape open lines, weak squares and future plans.",
		"A structural weakness can be compensated by activity or a concrete attack.",
		start,
	],
	[
		"passed-pawns",
		"Passed pawns",
		["pawn-structure"],
		"Passed pawns can force defensive attention and become stronger as pieces leave the board.",
		"A blockaded passer may be less useful than an active piece elsewhere.",
		endgame,
	],
	[
		"active-king",
		"Activate the endgame king",
		["king-safety"],
		"When mating threats are controlled, bring the king toward relevant pawns and entry squares.",
		"Even with few pieces, calculate checks and pawn races before stepping forward.",
		endgame,
	],
	[
		"opposition",
		"King opposition",
		["active-king"],
		"In king-and-pawn endings, the move can determine who yields a key square.",
		"Opposition is a tool for reaching key squares, not an end in itself; reserve pawn tempi matter.",
		endgame,
	],
	[
		"rook-endgames",
		"Active rooks in endings",
		["passed-pawns"],
		"Keep the rook active and calculate checking distance and pawn support.",
		"Specific winning or drawing positions override general activity advice.",
		start,
	],
	[
		"time-management",
		"Use time deliberately",
		[],
		"Reserve time for critical decisions and use a brief tactical check before committing.",
		"A low clock can justify practical simplification; clocks alone cannot explain why a move was chosen.",
		start,
	],
	[
		"sicilian",
		"Meet the Sicilian",
		["development", "centre"],
		"After 1.e4 c5, compare central development and pawn breaks; 2.Nf3 and 2.c3 support different practical plans.",
		"An opening name does not imply an objectively best move; calculate position-specific tactics.",
		new Chess().fen(),
	],
	[
		"beginner-openings",
		"Choose a beginner opening",
		["development", "centre"],
		"Prefer positions where you can explain development, central control and king safety over memorising long lines.",
		"No opening guarantees safety; sound principles must be checked against concrete threats.",
		start,
	],
];

/** Small authored library, revision 1. Review is editorial, not a claim of engine certification. */
export const CHESS_CONCEPTS: ChessConceptCard[] = lessons.map(
	([concept_id, title, prerequisites, principle, exceptions, fen]) => ({
		concept_id,
		title,
		prerequisites,
		principle,
		exceptions,
		illustrativeFens: [fen],
		questionObjectives: [
			`Explain when to apply: ${principle}`,
			`Find a legal move and justify it using ${title.toLowerCase()}.`,
		],
		sources: [
			ruleSource,
			{
				title: "LearnHarness Chess concept library v1 (editorial principles)",
				url: "https://github.com/wd7512/LearnChessHarness/blob/main/docs/chess.md",
				authority: "curated explanation; heuristics, not rules or engine verdicts",
			},
		],
		revision: 1,
		reviewedAt: "2026-11-07",
	}),
);

/** Names are curated examples of the CC0 Lichess ECO dataset, not evaluation data. */
export const CHESS_OPENINGS = [
	{ eco: "B20", name: "Sicilian Defense", san: ["e4", "c5"] },
	{ eco: "B22", name: "Sicilian Defense: Alapin Variation", san: ["e4", "c5", "c3"] },
	{ eco: "B50", name: "Sicilian Defense: Modern Variations", san: ["e4", "c5", "Nf3", "d6"] },
	{ eco: "C50", name: "Italian Game", san: ["e4", "e5", "Nf3", "Nc6", "Bc4"] },
	{ eco: "D00", name: "Queen's Pawn Game", san: ["d4", "d5"] },
	{ eco: "C00", name: "French Defense", san: ["e4", "e6"] },
].map((o) => {
	const board = new Chess();
	for (const move of o.san) board.move(move);
	return {
		...o,
		fen: board.fen(),
		source: "https://github.com/lichess-org/chess-openings",
		license: "CC0-1.0",
	};
});

export const KING_SAFETY_EXERCISE: ChessQuestion = {
	fen: king,
	learnerColor: "white",
	objective:
		"Create a safe escape square, then bring your king forward as the position simplifies. Play two learner moves.",
	maxLearnerMoves: 2,
	opponent: { mode: "fixed", moves: ["g8f8"] },
	acceptableLines: [
		["g2g3", "g1f1"],
		["h2h3", "g1f1"],
	],
	rubric:
		"Explain the escape square, check the opponent's threats, and distinguish a simplified position from a middlegame with queens. The line is illustrative, not a claim of engine optimality.",
	expectedConceptIds: ["king-safety", "active-king"],
	heldOut: false,
};
