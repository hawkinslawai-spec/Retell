import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getOverview } from "@/lib/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    return NextResponse.json(await getOverview());
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
