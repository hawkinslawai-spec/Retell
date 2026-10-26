import { DateTime, Interval } from "luxon";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { TIMEZONE, APPOINTMENT_MINUTES } from "./config";

/**
 * Appointments live in this application's own database.
 *
 * There is no external calendar. Availability is worked out from the business
 * hours in config plus the appointments already in this table, so the app is
 * the single source of truth and there is no second system to keep in sync,
 * no service account to share a calendar with, and nothing that silently
 * stops working when someone revokes access in a Google account.
 */

export type Appointment = {
  id: string;
  callId: string;
  agentId: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  notes: string;
  startIso: string;
  endIso: string;
  startLabel: string;
  dayLabel: string;
  status: string;
  createdByAgent: boolean;
};

type Row = {
  id: string;
  call_id: string | null;
  agent_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  service: string | null;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  status: string | null;
  source: string | null;
};

function toAppointment(row: Row): Appointment {
  const start = DateTime.fromISO(row.starts_at).setZone(TIMEZONE);
  const end = DateTime.fromISO(row.ends_at).setZone(TIMEZONE);

  return {
    id: row.id,
    callId: row.call_id || "",
    agentId: row.agent_id || "",
    name: row.name || "Unknown",
    phone: row.phone || "",
    email: row.email || "",
    service: row.service || "",
    notes: row.notes || "",
    startIso: start.toISO() || "",
    endIso: end.toISO() || "",
    startLabel: `${start.toFormat("h:mm a")} – ${end.toFormat("h:mm a")}`,
    dayLabel: start.toFormat("cccc, LLLL d"),
    status: row.status || "booked",
    createdByAgent: (row.source || "") === "agent",
  };
}

export async function listAppointments(daysAhead = 30, daysBack = 7): Promise<Appointment[]> {
  if (!isSupabaseConfigured()) return [];

  const from = DateTime.now().setZone(TIMEZONE).minus({ days: daysBack }).toUTC().toISO();
  const to = DateTime.now().setZone(TIMEZONE).plus({ days: daysAhead }).toUTC().toISO();

  const { data, error } = await getSupabase()
    .from("appointments")
    .select("*")
    .neq("status", "cancelled")
    .gte("starts_at", from ?? "")
    .lte("starts_at", to ?? "")
    .order("starts_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("[appointments] list failed:", error);
    return [];
  }

  return ((data || []) as Row[]).map(toAppointment);
}

export type CreateAppointment = {
  callId: string;
  agentId: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  notes: string;
  start: DateTime;
  end: DateTime;
};

export type CreateResult =
  | { ok: true; id: string; alreadyBooked: boolean }
  | { ok: false; reason: "slot_taken" | "error"; detail?: string };

/**
 * Book a slot.
 *
 * Two things have to be true at once and both are enforced here rather than
 * trusted to the caller:
 *
 *  - Retrying the same tool call must not double-book. Retell will retry a
 *    custom function on a timeout, and the LLM sometimes calls it twice on its
 *    own. The (call_id, starts_at) unique index makes the second insert collide
 *    instead of creating a second appointment, and we report that collision as
 *    success — because from the caller's point of view it is.
 *
 *  - Two different callers must not get the same slot. The overlap check below
 *    is not race-proof on its own, so a partial unique index on (starts_at)
 *    for non-cancelled rows backs it up in the database.
 */
export async function createAppointment(input: CreateAppointment): Promise<CreateResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, reason: "error", detail: "Supabase is not configured" };
  }

  const supabase = getSupabase();
  const startIso = input.start.toUTC().toISO();
  const endIso = input.end.toUTC().toISO();

  if (!startIso || !endIso) return { ok: false, reason: "error", detail: "Invalid time" };

  // Already booked by this very call at this very time? Treat as done.
  if (input.callId) {
    const { data: existing } = await supabase
      .from("appointments")
      .select("id")
      .eq("call_id", input.callId)
      .eq("starts_at", startIso)
      .neq("status", "cancelled")
      .maybeSingle();

    if (existing?.id) return { ok: true, id: String(existing.id), alreadyBooked: true };
  }

  const busy = await getBusyIntervals(input.start, input.end);
  const requested = Interval.fromDateTimes(input.start, input.end);
  if (busy.some((b) => b.overlaps(requested))) {
    return { ok: false, reason: "slot_taken" };
  }

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      call_id: input.callId || null,
      agent_id: input.agentId || null,
      name: input.name || null,
      phone: input.phone || null,
      email: input.email || null,
      service: input.service || null,
      notes: input.notes || null,
      starts_at: startIso,
      ends_at: endIso,
      status: "booked",
      source: "agent",
    })
    .select("id")
    .single();

  if (error) {
    // 23505 is Postgres' unique_violation. Either the same call retried, or
    // another caller took the slot a moment ago. Work out which.
    if (error.code === "23505") {
      const { data: mine } = await supabase
        .from("appointments")
        .select("id")
        .eq("call_id", input.callId)
        .eq("starts_at", startIso)
        .neq("status", "cancelled")
        .maybeSingle();

      if (mine?.id) return { ok: true, id: String(mine.id), alreadyBooked: true };
      return { ok: false, reason: "slot_taken" };
    }

    console.error("[appointments] insert failed:", error);
    return { ok: false, reason: "error", detail: error.message };
  }

  return { ok: true, id: String(data?.id ?? ""), alreadyBooked: false };
}

export async function cancelAppointment(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  // Soft delete. A cancelled appointment is evidence that a call happened and
  // a law firm will want it in the record, so the row stays and only its
  // status changes. The availability queries all filter cancelled out.
  const { error } = await getSupabase()
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) console.error("[appointments] cancel failed:", error);
}

/**
 * Which parts of this window are already taken?
 *
 * Replaces the Google Calendar freeBusy query. Anything overlapping the window
 * counts, so an appointment that starts before it and runs into it is caught —
 * the naive "starts inside the window" query misses exactly that case and
 * hands out a slot on top of an existing booking.
 */
export async function getBusyIntervals(from: DateTime, to: DateTime): Promise<Interval[]> {
  if (!isSupabaseConfigured()) return [];

  const fromIso = from.toUTC().toISO();
  const toIso = to.toUTC().toISO();
  if (!fromIso || !toIso) return [];

  const { data, error } = await getSupabase()
    .from("appointments")
    .select("starts_at, ends_at")
    .neq("status", "cancelled")
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso);

  if (error) {
    // Fail closed: report the whole window busy rather than risk a double
    // booking. The agent then says nothing is free, which is recoverable;
    // two clients in one slot is not.
    console.error("[appointments] busy lookup failed, treating window as busy:", error);
    return [Interval.fromDateTimes(from, to)];
  }

  return ((data || []) as { starts_at: string; ends_at: string }[])
    .map((row) =>
      Interval.fromDateTimes(
        DateTime.fromISO(row.starts_at).setZone(TIMEZONE),
        DateTime.fromISO(row.ends_at).setZone(TIMEZONE)
      )
    )
    .filter((i) => i.isValid);
}

/** Default appointment length, exposed so routes don't re-import config. */
export const SLOT_MINUTES = APPOINTMENT_MINUTES;
