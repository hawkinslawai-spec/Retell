import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getSupabase, Campaign } from "@/lib/supabase";
import { getStats, tickCampaign } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);

    const { data: leads } = await supabase
      .from("campaign_leads")
      .select("id, phone, name, status, attempts, disposition, summary, last_attempt_at")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true })
      .limit(200);

    return NextResponse.json({
      campaign: data,
      stats: await getStats(id),
      leads: leads || [],
    });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Not found" },
      { status: 404 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const supabase = getSupabase();

    const patch: Record<string, unknown> = {};

    if (typeof body.status === "string") {
      if (!["draft", "active", "paused", "completed"].includes(body.status)) {
        return NextResponse.json({ message: "Invalid status" }, { status: 400 });
      }
      patch.status = body.status;
    }

    for (const key of [
      "name",
      "from_number",
      "override_agent_id",
      "timezone",
      "window_start_min",
      "window_end_min",
      "call_days",
      "batch_size",
      "max_attempts",
      "retry_after_minutes",
      "reserved_concurrency",
      "daily_cap",
      "start_date",
      "end_date",
      "auto_sync_leads",
      "agent_label",
    ]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ message: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("campaigns")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Starting a campaign shouldn't mean waiting up to 5 minutes for the cron.
    // Fire one tick immediately so the first batch goes out now.
    let firstTick = null;
    if (patch.status === "active") {
      firstTick = await tickCampaign(data as Campaign);
    }

    return NextResponse.json({ campaign: data, first_tick: firstTick });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to update campaign" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to delete campaign" },
      { status: 500 }
    );
  }
}
