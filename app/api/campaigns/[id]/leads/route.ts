import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getSupabase, normalisePhone } from "@/lib/supabase";
import { listLeads } from "@/lib/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

type Incoming = { phone: string; name: string; email: string; interest: string };

/**
 * Parse pasted lines. Accepts a bare number per line, or comma-separated
 * "phone, name, email". Deliberately forgiving — this gets pasted from all
 * sorts of places.
 */
function parsePasted(text: string): Incoming[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return {
        phone: parts[0] || "",
        name: parts[1] || "",
        email: parts[2] || "",
        interest: parts[3] || "",
      };
    })
    .filter((l) => l.phone.length > 0);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;

  try {
    const body = (await req.json()) as {
      source?: string;
      text?: string;
      country_code?: string;
      rows?: { phone?: string; name?: string; email?: string; interest?: string }[];
    };
    const countryCode = (body.country_code || "1").replace(/\D/g, "") || "1";

    let incoming: Incoming[] = [];

    if (body.source === "leads") {
      // Enquiries the inbound agent already captured. Only the ones it marked
      // interested — opt-outs and wrong numbers stay out of campaigns.
      const saved = await listLeads(1000);
      incoming = saved
        .filter((l) => l.interested && l.phone)
        .map((l) => ({
          phone: l.phone,
          name: l.name,
          email: l.email,
          interest: l.interest,
        }));
    } else if (Array.isArray(body.rows) && body.rows.length > 0) {
      // Parsed in the browser from a CSV or Excel file.
      incoming = body.rows.map((r) => ({
        phone: String(r.phone ?? ""),
        name: String(r.name ?? ""),
        email: String(r.email ?? ""),
        interest: String(r.interest ?? ""),
      }));
    } else if (typeof body.text === "string" && body.text.trim()) {
      incoming = parsePasted(body.text);
    } else {
      return NextResponse.json(
        { message: "Nothing to import — upload a file, pull from Enquiries, or paste rows" },
        { status: 400 }
      );
    }

    // Normalise and drop duplicates within the import itself, otherwise the
    // upsert throws on its own conflicting rows.
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    let invalid = 0;

    for (const lead of incoming) {
      const phone = normalisePhone(lead.phone, countryCode);
      if (!phone) {
        invalid += 1;
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);

      rows.push({
        campaign_id: id,
        phone,
        name: lead.name || null,
        email: lead.email || null,
        variables: lead.interest ? { interest: lead.interest } : {},
        status: "pending",
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ imported: 0, invalid, message: "No valid numbers found" });
    }

    const supabase = getSupabase();

    // ignoreDuplicates so re-importing doesn't reset progress on
    // leads that have already been called.
    const { data, error } = await supabase
      .from("campaign_leads")
      .upsert(rows, { onConflict: "campaign_id,phone", ignoreDuplicates: true })
      .select("id");

    if (error) throw new Error(error.message);

    return NextResponse.json({
      imported: data?.length ?? 0,
      skipped_existing: rows.length - (data?.length ?? 0),
      invalid,
    });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
