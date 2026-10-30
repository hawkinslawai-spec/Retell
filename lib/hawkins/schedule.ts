/**
 * Opening hours and calling hours, read from the database.
 *
 * This sits on the inbound-call path: Retell gives the webhook roughly ten
 * seconds and the caller hears ringing for every one of them, so a schedule
 * read must never be the thing that holds up answering. Three defences:
 *
 *   - an in-process cache, so a busy period does one read rather than one per
 *     call;
 *   - a short timeout on the read itself;
 *   - built-in defaults that match what was previously hardcoded, used
 *     whenever the table is missing, empty or unreachable.
 *
 * The last one is the important one. If the database is down, the office
 * should still keep its normal hours rather than appearing shut.
 */

import { getSupabase, isSupabaseConfigured } from "../supabase";

export type DaySchedule = {
  weekday: number; // 1 = Monday ... 7 = Sunday
  isOpen: boolean;
  openTime: string; // "HH:MM"
  closeTime: string; // "HH:MM"
  callingEnabled: boolean;
  callStart: string;
  callEnd: string;
};

export type Schedule = {
  days: DaySchedule[];
  closures: { date: string; note: string }[];
  /** True when these are the built-in defaults rather than the firm's own. */
  usingDefaults: boolean;
  /** Set when a read was attempted and failed, for the diagnostics page. */
  error?: string;
};

const DEFAULT_OPEN = "09:30";
const DEFAULT_CLOSE = "17:30";

export const DEFAULT_DAYS: DaySchedule[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isOpen: weekday <= 5,
  openTime: DEFAULT_OPEN,
  closeTime: DEFAULT_CLOSE,
  callingEnabled: weekday <= 5,
  callStart: DEFAULT_OPEN,
  callEnd: DEFAULT_CLOSE,
}));

function defaults(error?: string): Schedule {
  return { days: DEFAULT_DAYS.map((d) => ({ ...d })), closures: [], usingDefaults: true, error };
}

/** "HH:MM" to minutes since midnight. Returns null on anything malformed. */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

type Cached = { at: number; value: Schedule };
let cache: Cached | null = null;

// Short enough that an edit shows up on the next call rather than the next
// deploy, long enough that a run of calls doesn't hammer the database.
const TTL_MS = 60_000;

/** Drop the cache so the next read reflects an edit immediately. */
export function invalidateSchedule(): void {
  cache = null;
}

export async function getSchedule(): Promise<Schedule> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  if (!isSupabaseConfigured()) {
    const value = defaults("Database not configured");
    cache = { at: Date.now(), value };
    return value;
  }

  try {
    const db = getSupabase();

    const [hoursRes, closureRes] = await Promise.all([
      db.from("office_hours").select("*").order("weekday"),
      db.from("office_closures").select("closure_date, note").order("closure_date"),
    ]);

    if (hoursRes.error) {
      // 42P01 is "relation does not exist" — migration 14 hasn't been run.
      const missing =
        hoursRes.error.code === "42P01" || /does not exist/i.test(hoursRes.error.message || "");
      const value = defaults(
        missing
          ? "office_hours table not found — run supabase-migration-14.sql"
          : hoursRes.error.message || hoursRes.error.code || "unknown error"
      );
      cache = { at: Date.now(), value };
      return value;
    }

    const rows = (hoursRes.data || []) as Record<string, unknown>[];
    if (rows.length === 0) {
      const value = defaults("office_hours is empty — re-run supabase-migration-14.sql");
      cache = { at: Date.now(), value };
      return value;
    }

    // Start from the defaults and overlay what the table provides, so a row
    // missing for one weekday leaves that day on its default rather than
    // vanishing from the week entirely.
    const byDay = new Map<number, DaySchedule>(DEFAULT_DAYS.map((d) => [d.weekday, { ...d }]));

    for (const r of rows) {
      const weekday = Number(r.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;

      const openTime = String(r.open_time ?? DEFAULT_OPEN);
      const closeTime = String(r.close_time ?? DEFAULT_CLOSE);
      const callStart = String(r.call_start ?? openTime);
      const callEnd = String(r.call_end ?? closeTime);

      // A row that can't be parsed keeps that day's default rather than
      // producing an office that is open from NaN to NaN.
      if (toMinutes(openTime) === null || toMinutes(closeTime) === null) continue;

      byDay.set(weekday, {
        weekday,
        isOpen: r.is_open !== false,
        openTime,
        closeTime,
        callingEnabled: r.calling_enabled !== false,
        callStart: toMinutes(callStart) === null ? openTime : callStart,
        callEnd: toMinutes(callEnd) === null ? closeTime : callEnd,
      });
    }

    const closures = closureRes.error
      ? []
      : ((closureRes.data || []) as Record<string, unknown>[]).map((c) => ({
          date: String(c.closure_date ?? "").slice(0, 10),
          note: String(c.note ?? ""),
        }));

    const value: Schedule = {
      days: [...byDay.values()].sort((a, b) => a.weekday - b.weekday),
      closures: closures.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)),
      usingDefaults: false,
    };

    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    const value = defaults(err instanceof Error ? err.message : String(err));
    cache = { at: Date.now(), value };
    return value;
  }
}

export type SaveResult = { ok: true } | { ok: false; message: string };

/** Validate before writing — the database constraints are the backstop, not the message. */
export function validateDays(days: DaySchedule[]): string | null {
  const seen = new Set<number>();

  for (const d of days) {
    if (!Number.isInteger(d.weekday) || d.weekday < 1 || d.weekday > 7) {
      return `"${d.weekday}" is not a weekday between 1 and 7.`;
    }
    if (seen.has(d.weekday)) return `Weekday ${d.weekday} appears twice.`;
    seen.add(d.weekday);

    const open = toMinutes(d.openTime);
    const close = toMinutes(d.closeTime);
    const cs = toMinutes(d.callStart);
    const ce = toMinutes(d.callEnd);

    if (open === null) return `${DAY_NAMES[d.weekday]}: "${d.openTime}" is not a valid time.`;
    if (close === null) return `${DAY_NAMES[d.weekday]}: "${d.closeTime}" is not a valid time.`;
    if (cs === null) return `${DAY_NAMES[d.weekday]}: "${d.callStart}" is not a valid time.`;
    if (ce === null) return `${DAY_NAMES[d.weekday]}: "${d.callEnd}" is not a valid time.`;

    if (open >= close) {
      return `${DAY_NAMES[d.weekday]}: opening time must be before closing time.`;
    }
    if (cs >= ce) {
      return `${DAY_NAMES[d.weekday]}: calling start must be before calling end.`;
    }
  }

  return null;
}

export const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export async function saveSchedule(
  days: DaySchedule[],
  closures: { date: string; note: string }[]
): Promise<SaveResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Database is not configured, so hours cannot be saved." };
  }

  const problem = validateDays(days);
  if (problem) return { ok: false, message: problem };

  const db = getSupabase();

  const { error: hoursError } = await db.from("office_hours").upsert(
    days.map((d) => ({
      weekday: d.weekday,
      is_open: d.isOpen,
      open_time: d.openTime,
      close_time: d.closeTime,
      calling_enabled: d.callingEnabled,
      call_start: d.callStart,
      call_end: d.callEnd,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "weekday" }
  );

  if (hoursError) {
    return {
      ok: false,
      message:
        hoursError.code === "42P01"
          ? "The office_hours table doesn't exist yet. Run supabase-migration-14.sql in the Supabase SQL editor."
          : hoursError.message || hoursError.code || "Could not save hours",
    };
  }

  const wanted = closures.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date));

  // Replace the closure list wholesale. The page always posts the complete
  // set, so a date the user removed has to disappear rather than linger.
  const { error: wipeError } = await db
    .from("office_closures")
    .delete()
    .neq("closure_date", "1900-01-01");

  if (wipeError && wipeError.code !== "42P01") {
    return { ok: false, message: wipeError.message || "Could not update closure dates" };
  }

  if (wanted.length > 0) {
    const { error: insertError } = await db
      .from("office_closures")
      .upsert(
        wanted.map((c) => ({ closure_date: c.date, note: c.note || null })),
        { onConflict: "closure_date" }
      );

    if (insertError && insertError.code !== "42P01") {
      return { ok: false, message: insertError.message || "Could not save closure dates" };
    }
  }

  invalidateSchedule();
  return { ok: true };
}
