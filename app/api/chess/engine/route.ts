import { stockfishRuntime, subscriptionRequestOrigin } from "@/src/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
	return Response.json(
		await stockfishRuntime.status(new URL(req.url).searchParams.get("refresh") === "1"),
		{ headers: { "Cache-Control": "no-store" } },
	);
}
export async function PUT(req: Request) {
	if (
		req.headers.get("origin") !== subscriptionRequestOrigin(req) ||
		!req.headers.get("content-type")?.startsWith("application/json")
	)
		return Response.json({ error: "Same-origin JSON is required." }, { status: 403 });
	try {
		const body = await req.json();
		if (typeof body.executablePath !== "string" || body.executablePath.length > 2048)
			throw new Error("Executable path must be text under 2048 characters.");
		return Response.json(await stockfishRuntime.saveOverride(body.executablePath));
	} catch (e) {
		return Response.json(
			{
				error: e instanceof Error ? e.message : "Could not save engine settings.",
			},
			{ status: 400 },
		);
	}
}
