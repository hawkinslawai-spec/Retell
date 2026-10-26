import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getSupabase, Campaign } from "@/lib/supabase";
import { getStats } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const campaigns = (data || []) as Campaign[];
    const withStats = await Promise.all(
      campaigns.map(async (c) => ({ ...c, stats: await getStats(c.id) }))
    );

    return NextResponse.json({ campaigns: withStats });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load campaigns" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const body = (await req.json()) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const fromNumber = typeof body.from_number === "string" ? body.from_number.trim() : "";

    if (!name || !fromNumber) {
      return NextResponse.json(
        { message: "name and from_number are required" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        name,
        from_number: fromNumber,
        override_agent_id: typeof body.override_agent_id === "string" && body.override_agent_id
          ? body.override_agent_id
          : null,
        timezone: typeof body.timezone === "string" ? body.timezone : "America/New_York",
        window_start_min: Number(body.window_start_min ?? 540),
        window_end_min: Number(body.window_end_min ?? 1020),
        call_days: Array.isArray(body.call_days)
          ? body.call_days
          : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        batch_size: Number(body.batch_size ?? 50),
        max_attempts: Number(body.max_attempts ?? 3),
        retry_after_minutes: Number(body.retry_after_minutes ?? 240),
        reserved_concurrency: Number(body.reserved_concurrency ?? 1),
        daily_cap: Number(body.daily_cap ?? 200),
        start_date: typeof body.start_date === "string" && body.start_date ? body.start_date : null,
        end_date: typeof body.end_date === "string" && body.end_date ? body.end_date : null,
        auto_sync_leads: body.auto_sync_leads === true,
        agent_label: typeof body.agent_label === "string" ? body.agent_label : null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ campaign: data });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to create campaign" },
      { status: 500 }
    );
  }
}
