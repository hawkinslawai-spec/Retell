import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { listContacts, STATUSES } from "@/lib/crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const status = req.nextUrl.searchParams.get("status") || "all";
    const search = req.nextUrl.searchParams.get("q") || "";
    const contacts = await listContacts(status, search);
    return NextResponse.json({ contacts, statuses: STATUSES });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load contacts" },
      { status: 500 }
    );
  }
}
