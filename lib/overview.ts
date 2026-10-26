import { getRetell, unwrapList } from "./retell-client";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { TIMEZONE } from "./config";

export type RecentCall = {
  callId: string;
  toNumber: string;
  fromNumber: string;
  direction: string;
  startedAt: number;
  durationMs: number;
  status: string;
  successful: boolean | null;
};

export type Overview = {
  callsToday: number;
  totalCalls: number;
  minutesUsed: number;
  costUsd: number;
  activeAgents: number;
  activeCampaigns: number;
  leadsCaptured: number;
  appointmentsBooked: number;
  answerRate: number | null;
  avgDurationSec: number | null;
  perDay: { day: string; calls: number; minutes: number }[];
  recent: RecentCall[];
  warnings: string[];
};

function dayKey(ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function shortDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(
      new Date(`${iso}T12:00:00Z`)
    );
  } catch {
    return iso.slice(5);
  }
}

/** Rows in a table, counted server-side rather than fetched. */
async function countRows(table: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { count, error } = await getSupabase()
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/** Appointments still to come, which is the number worth showing. */
async function countUpcomingAppointments(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { count, error } = await getSupabase()
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .neq("status", "cancelled")
    .gte("starts_at", new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function getOverview(): Promise<Overview> {
  const warnings: string[] = [];

  const overview: Overview = {
    callsToday: 0,
    totalCalls: 0,
    minutesUsed: 0,
    costUsd: 0,
    activeAgents: 0,
    activeCampaigns: 0,
    leadsCaptured: 0,
    appointmentsBooked: 0,
    answerRate: null,
    avgDurationSec: null,
    perDay: [],
    recent: [],
    warnings,
  };

  // Seed the last 7 days so the chart has an axis even with no calls.
  const buckets = new Map<string, { calls: number; ms: number }>();
  for (let i = 6; i >= 0; i--) {
    buckets.set(dayKey(Date.now() - i * 86_400_000), { calls: 0, ms: 0 });
  }
  const today = dayKey(Date.now());

  // ---- Retell: calls ----
  try {
    const retell = getRetell();
    const res = await retell.call.list({ limit: 500, sort_order: "descending" });
    const calls = unwrapList<unknown>(res);

    let answered = 0;
    let ended = 0;
    let totalMs = 0;

    for (const row of calls) {
      const c = row as unknown as Record<string, unknown>;
      const start = typeof c.start_timestamp === "number" ? c.start_timestamp : 0;
      const durationMs =
        typeof c.duration_ms === "number"
          ? c.duration_ms
          : typeof c.end_timestamp === "number" && start
            ? c.end_timestamp - start
            : 0;

      overview.totalCalls += 1;
      totalMs += durationMs;

      const cost = (c.call_cost || {}) as Record<string, unknown>;
      if (typeof cost.combined_cost === "number") {
        overview.costUsd += cost.combined_cost / 100; // API returns cents
      }

      if (start) {
        const key = dayKey(start);
        if (key === today) overview.callsToday += 1;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.calls += 1;
          bucket.ms += durationMs;
        }
      }

      const reason = String(c.disconnection_reason ?? "").toLowerCase();
      if (reason) {
        ended += 1;
        if (!reason.startsWith("dial_") && c.in_voicemail !== true) answered += 1;
      }

      if (overview.recent.length < 8) {
        const analysis = (c.call_analysis || {}) as Record<string, unknown>;
        overview.recent.push({
          callId: String(c.call_id ?? ""),
          toNumber: String(c.to_number ?? ""),
          fromNumber: String(c.from_number ?? ""),
          direction: String(c.direction ?? ""),
          startedAt: start,
          durationMs,
          status: String(c.call_status ?? ""),
          successful:
            typeof analysis.call_successful === "boolean" ? analysis.call_successful : null,
        });
      }
    }

    overview.minutesUsed = Math.round(totalMs / 60000);
    overview.answerRate = ended > 0 ? Math.round((answered / ended) * 100) : null;
    overview.avgDurationSec =
      overview.totalCalls > 0 ? Math.round(totalMs / overview.totalCalls / 1000) : null;
  } catch (err) {
    warnings.push(`Couldn't load calls: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  overview.perDay = Array.from(buckets.entries()).map(([iso, v]) => ({
    day: shortDay(iso),
    calls: v.calls,
    minutes: Math.round(v.ms / 60000),
  }));

  // ---- Retell: agents ----
  try {
    const retell = getRetell();
    const res = await retell.agent.list({ limit: 100 });
    const rows = unwrapList<unknown>(res);
    const ids = new Set(
      rows.map((r) => String((r as unknown as Record<string, unknown>).agent_id ?? ""))
    );
    ids.delete("");
    overview.activeAgents = ids.size;
  } catch {
    warnings.push("Couldn't load agents");
  }

  // ---- Supabase: campaigns ----
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabase();
      const { count } = await supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");
      overview.activeCampaigns = count ?? 0;
    } catch {
      warnings.push("Couldn't load campaigns");
    }
  }

  // ---- Leads and appointments, straight from our own tables ----
  try {
    const [leads, bookings] = await Promise.all([
      countRows("leads"),
      countUpcomingAppointments(),
    ]);
    overview.leadsCaptured = leads;
    overview.appointmentsBooked = bookings;
  } catch (err) {
    console.error("[overview] counts failed:", err);
    warnings.push("Couldn't read leads and appointments — has migration 12 been run?");
  }

  return overview;
}
