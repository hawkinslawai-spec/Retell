import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { listCalls } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit") || 100));
    return NextResponse.json({ calls: await listCalls(limit) });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load calls" },
      { status: 500 }
    );
  }
}
