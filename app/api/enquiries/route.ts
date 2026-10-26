import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { listLeads, listLogEntries, listLogKinds } from "@/lib/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Everything the phone agent recorded that isn't a booking or a call:
 * enquiries it saved, plus whatever custom logs the firm defined.
 */
export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const kind = req.nextUrl.searchParams.get("kind") || "leads";
  const search = req.nextUrl.searchParams.get("q") || "";

  try {
    // The tab strip is always returned, so switching tabs never loses it.
    const kinds = await listLogKinds();

    if (kind === "leads") {
      return NextResponse.json({ kind, kinds, leads: await listLeads(200, search) });
    }

    const entries = await listLogEntries(kind, 200);

    // Column order comes from the first entry's keys. Custom logs are
    // free-form, so there is no schema to read it from — and the agent writes
    // the fields in the order they were defined on /agents.
    const columns: string[] = [];
    for (const entry of entries) {
      for (const key of Object.keys(entry.data)) {
        if (!columns.includes(key)) columns.push(key);
      }
    }

    return NextResponse.json({ kind, kinds, entries, columns });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load enquiries" },
      { status: 500 }
    );
  }
}
