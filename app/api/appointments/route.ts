import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { listAppointments, cancelAppointment } from "@/lib/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const ahead = Number(req.nextUrl.searchParams.get("days") || 30);
    return NextResponse.json({ appointments: await listAppointments(ahead) });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load appointments" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ message: "id required" }, { status: 400 });
    await cancelAppointment(id);
    return NextResponse.json({ cancelled: true });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Cancel failed" },
      { status: 500 }
    );
  }
}
