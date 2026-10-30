import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import {
  getSchedule,
  saveSchedule,
  invalidateSchedule,
  type DaySchedule,
} from "@/lib/hawkins/schedule";
import { officeStatus, callingAllowed } from "@/lib/hawkins/hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  // Fresh, not cached — the page is showing the user what is stored, and a
  // minute-old answer here looks like a save that didn't take.
  invalidateSchedule();

  const [schedule, status, calling] = await Promise.all([
    getSchedule(),
    officeStatus(),
    callingAllowed(),
  ]);

  return NextResponse.json({ ...schedule, status, calling });
}

export async function PUT(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const body = (await req.json()) as {
      days?: unknown;
      closures?: unknown;
    };

    if (!Array.isArray(body.days) || body.days.length === 0) {
      return NextResponse.json({ message: "No days were sent." }, { status: 400 });
    }

    const days: DaySchedule[] = (body.days as Record<string, unknown>[]).map((d) => ({
      weekday: Number(d.weekday),
      isOpen: d.isOpen === true,
      openTime: String(d.openTime ?? ""),
      closeTime: String(d.closeTime ?? ""),
      callingEnabled: d.callingEnabled === true,
      callStart: String(d.callStart ?? ""),
      callEnd: String(d.callEnd ?? ""),
    }));

    const closures = Array.isArray(body.closures)
      ? (body.closures as Record<string, unknown>[]).map((c) => ({
          date: String(c.date ?? "").slice(0, 10),
          note: String(c.note ?? ""),
        }))
      : [];

    const result = await saveSchedule(days, closures);
    if (!result.ok) return NextResponse.json({ message: result.message }, { status: 400 });

    // Return the state that will actually be used, so the page shows what was
    // stored rather than what was typed.
    const [schedule, status, calling] = await Promise.all([
      getSchedule(),
      officeStatus(),
      callingAllowed(),
    ]);

    return NextResponse.json({ saved: true, ...schedule, status, calling });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Could not save hours" },
      { status: 500 }
    );
  }
}
