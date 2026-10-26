import { DateTime, Interval } from "luxon";
import {
  TIMEZONE,
  APPOINTMENT_MINUTES,
  SLOT_STEP_MINUTES,
  BUSINESS_START_HOUR,
  BUSINESS_END_HOUR,
  WORKING_DAYS,
  MIN_LEAD_MINUTES,
} from "./config";

// Availability comes from the appointments table now, not a calendar.
// Re-exported here so the routes keep importing it from one place.
export { getBusyIntervals } from "./appointments";

export type Slot = { start: DateTime; end: DateTime };

const WEEKDAY_NAMES: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export function now(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

/**
 * Turn whatever the LLM sends into a YYYY-MM-DD date string in business time.
 * Handles ISO dates, "today", "tomorrow", and bare weekday names.
 */
export function resolveDate(input: string): string | null {
  const today = now();
  const text = (input || "").trim().toLowerCase();

  if (!text) return today.toISODate();
  if (text === "today") return today.toISODate();
  if (text === "tomorrow") return today.plus({ days: 1 }).toISODate();

  const cleaned = text.replace(/^(next|this|on)\s+/, "");
  if (WEEKDAY_NAMES[cleaned]) {
    const target = WEEKDAY_NAMES[cleaned];
    let candidate = today.plus({ days: 1 });
    for (let i = 0; i < 7; i++) {
      if (candidate.weekday === target) return candidate.toISODate();
      candidate = candidate.plus({ days: 1 });
    }
  }

  const iso = DateTime.fromISO(input.trim(), { zone: TIMEZONE });
  if (iso.isValid) return iso.toISODate();

  return null;
}

export function isWorkingDay(dateISO: string): boolean {
  const day = DateTime.fromISO(dateISO, { zone: TIMEZONE });
  return day.isValid && WORKING_DAYS.includes(day.weekday);
}

export function businessWindow(dateISO: string): { start: DateTime; end: DateTime } | null {
  const day = DateTime.fromISO(dateISO, { zone: TIMEZONE });
  if (!day.isValid) return null;

  return {
    start: day.set({ hour: BUSINESS_START_HOUR, minute: 0, second: 0, millisecond: 0 }),
    end: day.set({ hour: BUSINESS_END_HOUR, minute: 0, second: 0, millisecond: 0 }),
  };
}

export function generateOpenSlots(
  window: { start: DateTime; end: DateTime },
  busy: Interval[]
): Slot[] {
  const slots: Slot[] = [];
  const earliest = now().plus({ minutes: MIN_LEAD_MINUTES });

  let cursor = window.start;
  while (cursor.plus({ minutes: APPOINTMENT_MINUTES }) <= window.end) {
    const slotEnd = cursor.plus({ minutes: APPOINTMENT_MINUTES });
    const candidate = Interval.fromDateTimes(cursor, slotEnd);
    const clashes = busy.some((b) => b.overlaps(candidate));

    if (!clashes && cursor >= earliest) {
      slots.push({ start: cursor, end: slotEnd });
    }
    cursor = cursor.plus({ minutes: SLOT_STEP_MINUTES });
  }

  return slots;
}

export function filterByPreference(slots: Slot[], preference: string): Slot[] {
  const pref = (preference || "").toLowerCase();
  if (!pref) return slots;

  let filtered: Slot[] = slots;
  if (pref.includes("morning")) {
    filtered = slots.filter((s) => s.start.hour < 12);
  } else if (pref.includes("afternoon")) {
    filtered = slots.filter((s) => s.start.hour >= 12 && s.start.hour < 17);
  } else if (pref.includes("evening")) {
    filtered = slots.filter((s) => s.start.hour >= 17);
  }

  // If the preference wipes out every option, fall back to the full list
  // rather than telling the caller there is nothing at all.
  return filtered.length > 0 ? filtered : slots;
}

export function spokenTime(dt: DateTime): string {
  return dt.toFormat("h:mm a");
}

export function spokenDate(dt: DateTime): string {
  return dt.toFormat("cccc, LLLL d");
}

/** Join times the way a person would say them: "10 AM, 11:30 AM and 2 PM". */
export function joinSpoken(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
