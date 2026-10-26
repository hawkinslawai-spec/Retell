import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { searchElevenLabsVoices } from "@/lib/retell-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const query = req.nextUrl.searchParams.get("q") || "";
  if (!query.trim()) return NextResponse.json({ results: [] });

  try {
    const results = await searchElevenLabsVoices(query.trim());
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
