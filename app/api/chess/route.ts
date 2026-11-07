import { chessMutationResponse, chessService, listChats, getChat } from "@/src/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
	const warnings: string[] = [];
	for (const chat of listChats()) {
		try {
			const saved = getChat(chat.id);
			if (saved) chessService.projectSession(chat.id, saved.messages);
		} catch {
			warnings.push(
				`Some chess learning evidence from session ${chat.id} could not be projected. Its original session is intact.`,
			);
		}
	}
	return Response.json(
		{ ...chessService.snapshot(), warnings },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
export const POST = chessMutationResponse;
