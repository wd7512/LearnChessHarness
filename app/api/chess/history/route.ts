import { readChessHistory } from "@/src/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
	const q = new URL(req.url).searchParams;
	const view = q.get("view") ?? "summary";
	if (!["summary", "list", "scope", "game", "position", "practice"].includes(view))
		return Response.json({ error: "Unknown chess-history view." }, { status: 400 });
	try {
		return Response.json(
			await readChessHistory({
				view: view as "summary" | "list" | "scope" | "game" | "position" | "practice",
				opening: q.get("opening") ?? undefined,
				speed: q.get("speed") ?? undefined,
				learnerColor: q.get("learnerColor") === "white" ? "white" : q.get("learnerColor") === "black" ? "black" : undefined,
				page: q.has("page") ? Number(q.get("page")) : undefined,
				pageSize: q.has("pageSize") ? Number(q.get("pageSize")) : undefined,
				limit: q.has("limit") ? Number(q.get("limit")) : undefined,
				gameId: q.get("gameId") ?? undefined,
				ply: q.has("ply") ? Number(q.get("ply")) : undefined,
			}),
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch {
		return Response.json(
			{
				status: "unavailable",
				error:
					"Chess history could not be retrieved. This is an access failure, not evidence of an empty history. Existing games may still be saved.",
			},
			{ status: 503 },
		);
	}
}
