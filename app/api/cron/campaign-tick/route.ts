import { NextRequest, NextResponse } from "next/server";
import { checkCron } from "@/lib/auth";
import { tickAllActive } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called every few minutes by cron-job.org.
 *
 * Vercel Hobby only allows one cron run per day, which is useless here — an
 * external pinger is the way round it. Retell handles the actual call pacing
 * and time windows itself, so this endpoint only needs to reconcile finished
 * calls and hand over the next batch. Running it every 5 minutes is plenty.
 */
async function run(req: NextRequest) {
  if (!checkCron(req)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await tickAllActive();

    return NextResponse.json({
      ok: true,
      ran_at: new Date().toISOString(),
      campaigns: results.length,
      results,
    });
  } catch (err) {
    console.error("[cron] campaign tick failed:", err);
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Tick failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
