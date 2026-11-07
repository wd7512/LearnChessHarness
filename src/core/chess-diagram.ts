import { Chess } from "chess.js";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const chessDiagramSchema = Type.Object({
	fen: Type.String({
		description:
			"Complete FEN at the exact moment the learner must assess, including any described opponent reply.",
	}),
	orientation: Type.Optional(Type.Union([Type.Literal("white"), Type.Literal("black")])),
	highlightSquares: Type.Array(Type.String({ pattern: "^[a-h][1-8]$" }), {
		maxItems: 64,
		description:
			"All candidate squares, highlighted identically. Never mark which candidates are legal or correct.",
	}),
	description: Type.String({
		minLength: 1,
		description:
			"Accessible written description of the position and candidate squares; do not disclose the answer.",
	}),
});
export type ChessDiagramData = Static<typeof chessDiagramSchema>;
export function parseChessDiagram(value: unknown): ChessDiagramData | undefined {
	if (!Value.Check(chessDiagramSchema, value)) return;
	try {
		new Chess(value.fen);
		return value;
	} catch {
		return;
	}
}
export function questionDiagram(input: unknown) {
	return parseChessDiagram((input as { position?: unknown } | null)?.position);
}
export function chessDiagramProblems(input: {
	question?: string;
	statement?: string;
	position?: unknown;
}): string[] {
	if (input.position !== undefined && !parseChessDiagram(input.position))
		return ["position must contain a valid FEN, candidate squares and an accessible description."];
	const text = input.question ?? input.statement ?? "";
	if (
		input.position === undefined &&
		/\b(king|queen|rook|bishop|knight|pawn)s?\b/i.test(text) &&
		(text.match(/\b[a-h][1-8]\b/g)?.length ?? 0) >= 2
	)
		return [
			"This question depends on a specific chess position. Include position with the resulting FEN, all candidate highlightSquares and a written description. Do not reveal which candidates are legal.",
		];
	return [];
}
