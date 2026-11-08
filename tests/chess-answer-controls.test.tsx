import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { ChessBoard } from "../components/chess-board.tsx";
import { ChessDiagram } from "../components/chess-diagram.tsx";
import { ConfidenceControl } from "../components/answer-controls.tsx";
import { appendToPrimaryInput } from "../components/dictation.tsx";
import { KING_SAFETY_EXERCISE } from "../src/core/chess-curriculum.ts";
import type { ChessAnswer } from "../src/core/chess.ts";
globalThis.React = React;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
	await cleanup?.();
	cleanup = undefined;
});
test("native and chess confidence share the same snapped rail and visible selected value", () => {
	const html = renderToStaticMarkup(<ConfidenceControl index={3} onChange={() => {}} />);
	assert.match(html, /data-testid="confidence-slider"/);
	assert.match(html, /70 percent/);
	assert.match(html, />70%<\/span>/);
	assert.match(html, /#84cc16/);
});
test("coordinates are outside square contents and static descriptions start collapsed", () => {
	const html = renderToStaticMarkup(
		<ChessDiagram
			position={{
				fen: KING_SAFETY_EXERCISE.fen,
				highlightSquares: ["c3"],
				description: "Full accessible description of all pieces.",
			}}
		/>,
	);
	const { document } = parseHTML(html);
	assert.equal(document.querySelector('[data-square="c3"]')!.textContent, "");
	assert.match(
		document.querySelector('[role="img"]')!.getAttribute("aria-label")!,
		/Full accessible/,
	);
	assert.equal(document.querySelector("details")!.hasAttribute("open"), false);
	assert.equal(document.querySelector("summary")!.textContent, "Position description");
	assert.equal(document.querySelectorAll("[data-piece]").length, 8);
});
test("the board claims native dictation and submit includes the final spoken reasoning", async () => {
	const dom = parseHTML('<html><body><div id="root"></div></body></html>');
	const previous = new Map<string, PropertyDescriptor | undefined>();
	const globals = globalThis as Record<string, unknown>;
	const storage = new Map<string, string>();
	const key = `lh-chess:test:${KING_SAFETY_EXERCISE.fen}:${KING_SAFETY_EXERCISE.objective}`;
	storage.set(
		key,
		JSON.stringify({
			uciMoves: ["g2g3", "g1f1"],
			reasoning: "I checked the threat.",
			confidence: 70,
		}),
	);
	for (const [name, value] of Object.entries({
		window: dom.window,
		document: dom.document,
		navigator: { userAgent: "" },
		localStorage: {
			getItem: (k: string) => storage.get(k),
			setItem: (k: string, v: string) => storage.set(k, v),
		},
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(document.getElementById("root")!);
	let answer: ChessAnswer | undefined;
	cleanup = async () => {
		await act(async () => root.unmount());
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globals[name];
		}
	};
	await act(async () =>
		root.render(
			<ChessBoard
				question={KING_SAFETY_EXERCISE}
				draftKey="test"
				onSubmit={(value) => {
					answer = value;
				}}
			/>,
		),
	);
	await act(async () => {
		const button = [...document.querySelectorAll("button")].find(
			(b) => b.textContent === "Submit answer",
		)!;
		button
			.closest("form")!
			.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
		assert.equal(appendToPrimaryInput("The resulting position is safe."), true);
	});
	assert.equal(answer!.reasoning, "I checked the threat. The resulting position is safe.");
	assert.equal(answer!.confidence, 70);
	assert.deepEqual(answer!.uciMoves, ["g2g3", "g1f1"]);
});
