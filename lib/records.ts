import { DateTime } from "luxon";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { TIMEZONE } from "./config";

/**
 * Leads and custom-log entries, stored in this application's own database.
 *
 * This replaces the Google Sheets writer. Everything a call produces is now
 * queryable from the app: no spreadsheet to share, no tab names to keep in
 * step with the agent's tools, and no silent data loss when somebody renames
 * a tab or the service account loses access.
 *
 * Nothing in this file is allowed to throw. All of it runs inside after(),
 * which means the phone call has already been answered by the time it runs —
 * a failed write must be logged and swallowed, never surfaced as a failed
 * tool call to the agent mid-conversation.
 */

export type LeadInput = {
  name: string;
  phone: string;
  email: string;
  interest: string;
  notes: string;
  interested: boolean;
  callId: string;
  agentId: string;
};

export async function saveLead(input: LeadInput): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.error("[records] Supabase not configured — lead dropped");
    return;
  }

  try {
    const { error } = await getSupabase().from("leads").insert({
      name: input.name || null,
      phone: input.phone || null,
      email: input.email || null,
      interest: input.interest || null,
      notes: input.notes || null,
      interested: input.interested,
      call_id: input.callId || null,
      agent_id: input.agentId || null,
    });

    if (error) console.error("[records] lead insert failed:", error);
  } catch (err) {
    console.error("[records] lead insert threw:", err);
  }
}

export type Lead = {
  id: string;
  createdAt: string;
  createdLabel: string;
  name: string;
  phone: string;
  email: string;
  interest: string;
  notes: string;
  interested: boolean;
  callId: string;
};

export async function listLeads(limit = 200, search = ""): Promise<Lead[]> {
  if (!isSupabaseConfigured()) return [];

  let query = getSupabase()
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (search.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(
      `name.ilike.${term},phone.ilike.${term},email.ilike.${term},interest.ilike.${term}`
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[records] lead list failed:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const created = DateTime.fromISO(String(row.created_at ?? "")).setZone(TIMEZONE);
    return {
      id: String(row.id ?? ""),
      createdAt: String(row.created_at ?? ""),
      createdLabel: created.isValid ? created.toFormat("d LLL yyyy, h:mm a") : "",
      name: String(row.name ?? "") || "Unknown",
      phone: String(row.phone ?? ""),
      email: String(row.email ?? ""),
      interest: String(row.interest ?? ""),
      notes: String(row.notes ?? ""),
      interested: row.interested === true,
      callId: String(row.call_id ?? ""),
    };
  });
}

/**
 * One row per custom log the client defined on /agents.
 *
 * The fields are stored as JSON rather than columns, because the client can
 * add, rename and remove fields from the UI at any time and a fixed schema
 * would need a migration every time they did.
 */
export type LogEntryInput = {
  logKey: string;
  logLabel: string;
  data: Record<string, string>;
  callId: string;
  agentId: string;
  phone: string;
};

export async function saveLogEntry(input: LogEntryInput): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.error("[records] Supabase not configured — log entry dropped");
    return;
  }

  try {
    const { error } = await getSupabase().from("log_entries").insert({
      log_key: input.logKey,
      log_label: input.logLabel || input.logKey,
      data: input.data,
      call_id: input.callId || null,
      agent_id: input.agentId || null,
      phone: input.phone || null,
    });

    if (error) console.error("[records] log entry insert failed:", error);
  } catch (err) {
    console.error("[records] log entry insert threw:", err);
  }
}

export type LogEntry = {
  id: string;
  createdLabel: string;
  logKey: string;
  logLabel: string;
  phone: string;
  callId: string;
  data: Record<string, string>;
};

export async function listLogEntries(logKey = "", limit = 200): Promise<LogEntry[]> {
  if (!isSupabaseConfigured()) return [];

  let query = getSupabase()
    .from("log_entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (logKey) query = query.eq("log_key", logKey);

  const { data, error } = await query;
  if (error) {
    console.error("[records] log entry list failed:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const created = DateTime.fromISO(String(row.created_at ?? "")).setZone(TIMEZONE);
    const raw = row.data;
    const parsed: Record<string, string> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        parsed[k] = v === null || v === undefined ? "" : String(v);
      }
    }

    return {
      id: String(row.id ?? ""),
      createdLabel: created.isValid ? created.toFormat("d LLL yyyy, h:mm a") : "",
      logKey: String(row.log_key ?? ""),
      logLabel: String(row.log_label ?? "") || String(row.log_key ?? ""),
      phone: String(row.phone ?? ""),
      callId: String(row.call_id ?? ""),
      data: parsed,
    };
  });
}

/** Distinct log types that actually have entries, for the tab strip. */
export async function listLogKinds(): Promise<{ key: string; label: string; count: number }[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from("log_entries")
    .select("log_key, log_label")
    .limit(2000);

  if (error) {
    console.error("[records] log kinds failed:", error);
    return [];
  }

  const counts = new Map<string, { label: string; count: number }>();
  for (const row of (data || []) as { log_key: string; log_label: string }[]) {
    const key = row.log_key || "";
    if (!key) continue;
    const found = counts.get(key);
    if (found) found.count++;
    else counts.set(key, { label: row.log_label || key, count: 1 });
  }

  return [...counts.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
}
