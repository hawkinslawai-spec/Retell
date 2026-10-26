import { DateTime } from "luxon";

/**
 * Opening hours, bank holidays and the spoken date phrases (Section 4).
 *
 * The specification is emphatic that the language model must never work out
 * the date, the time or whether today is a bank holiday. It gets three ready
 * made values and nothing else. That is not fussiness: a model asked "are you
 * open?" will happily reason its way to a confident wrong answer, and on a
 * Saturday that means a caller is told to hold for a transfer that can never
 * connect.
 *
 * Everything here runs in Europe/London, so GMT and BST are handled by the
 * timezone database rather than by arithmetic.
 */

const ZONE = "Europe/London";

const OPEN_MINUTES = 9 * 60 + 30; // 09:30
const CLOSE_MINUTES = 17 * 60 + 30; // 17:30, exclusive — 17:29:59 is still open

/**
 * Fallback bank holidays for England and Wales, checked against the Privy
 * Council proclamation of 8 July 2026 and published 2027 listings.
 *
 * Only used when the GOV.UK feed cannot be reached and there is no cached
 * copy. Deliberately short: a stale list that silently runs out is more
 * dangerous than one that obviously needs renewing, because the failure mode
 * is the office appearing open on Christmas Day.
 */
const FALLBACK_HOLIDAYS: string[] = [
  "2026-12-25", // Christmas Day
  "2026-12-28", // Boxing Day (substitute)
  "2027-01-01", // New Year's Day
  "2027-03-26", // Good Friday
  "2027-03-29", // Easter Monday
  "2027-05-03", // Early May
  "2027-05-31", // Spring
  "2027-08-30", // Summer
  "2027-12-27", // Christmas Day (substitute)
  "2027-12-28", // Boxing Day (substitute)
];

/** The last date the fallback list covers. Past this it cannot be trusted. */
const FALLBACK_HORIZON = "2027-12-28";

/**
 * Closures that are not bank holidays — a Christmas shutdown, an Eid day, a
 * staff training afternoon. Maintained by hand.
 *
 * Set FIRM_CLOSURE_DAYS in the environment as a comma-separated list of
 * YYYY-MM-DD dates.
 */
function closureDays(): string[] {
  return (process.env.FIRM_CLOSURE_DAYS || "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

// --- Bank holiday feed ------------------------------------------------------

type HolidayCache = { dates: Set<string>; fetchedAt: number; stale: boolean };

let cache: HolidayCache | null = null;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long to wait before trying the feed again after a failure.
 *
 * Without this, a GOV.UK outage would make every inbound call pay the fetch
 * timeout before the caller hears anything — the one place in this system
 * where a couple of seconds is actually expensive. Half an hour is frequent
 * enough that a transient outage self-heals well within a working day.
 */
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000;
const FEED_URL = "https://www.gov.uk/bank-holidays.json";

/**
 * England and Wales only. Scotland and Northern Ireland have different dates,
 * and taking the wrong division would close the office on days it is open.
 */
async function fetchHolidays(): Promise<Set<string> | null> {
  try {
    const res = await fetch(FEED_URL, {
      // Refreshed daily; the feed itself changes perhaps twice a year, so
      // Next's data cache serves it instantly on all but the first call.
      next: { revalidate: 86400 },
      // Deliberately short. This runs on the inbound-call path, where Retell
      // allows 10 seconds total and the caller hears ringing until we answer.
      // A slow feed must cost the caller a moment, not the call.
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`feed returned ${res.status}`);

    const json = (await res.json()) as {
      "england-and-wales"?: { events?: { date?: string }[] };
    };

    const events = json["england-and-wales"]?.events || [];
    const dates = new Set<string>();
    for (const event of events) {
      if (event.date && /^\d{4}-\d{2}-\d{2}$/.test(event.date)) dates.add(event.date);
    }

    // An empty or malformed feed is worse than no feed, because it would
    // report every bank holiday as a working day.
    return dates.size > 0 ? dates : null;
  } catch (err) {
    console.error("[hours] bank holiday feed unavailable:", err);
    return null;
  }
}

/**
 * Bank holidays, from the feed when possible and from the last good copy or
 * the fallback list otherwise.
 *
 * Never throws. A call must not fail because GOV.UK is down.
 */
export async function bankHolidays(): Promise<HolidayCache> {
  const age = cache ? Date.now() - cache.fetchedAt : Infinity;

  // A good copy is reused for a day. A stale one is reused for half an hour,
  // so a feed outage costs one slow call rather than every call.
  if (cache && !cache.stale && age < ONE_DAY_MS) return cache;
  if (cache && cache.stale && age < RETRY_AFTER_FAILURE_MS) return cache;

  const fetched = await fetchHolidays();
  if (fetched) {
    cache = { dates: fetched, fetchedAt: Date.now(), stale: false };
    return cache;
  }

  // Keep serving the last good dates rather than dropping to the fallback —
  // yesterday's real list beats a hardcoded one. Only the timestamp and the
  // stale flag change, so the retry clock restarts.
  cache = {
    dates: cache ? cache.dates : new Set(FALLBACK_HOLIDAYS),
    fetchedAt: Date.now(),
    stale: true,
  };
  return cache;
}

// --- Open / closed ----------------------------------------------------------

export function nowLondon(): DateTime {
  return DateTime.now().setZone(ZONE);
}

function isWeekend(d: DateTime): boolean {
  return d.weekday === 6 || d.weekday === 7;
}

/** A day the firm works: weekday, not a bank holiday, not a closure day. */
function isWorkingDay(d: DateTime, holidays: Set<string>): boolean {
  const iso = d.toISODate();
  if (!iso) return false;
  if (isWeekend(d)) return false;
  if (holidays.has(iso)) return false;
  if (closureDays().includes(iso)) return false;
  return true;
}

export type OfficeStatus = {
  officeOpen: boolean;
  nowSpoken: string;
  nextWorkingDaySpoken: string;
  /** True when the holiday list came from the fallback or a stale cache. */
  holidaysStale: boolean;
  /** True when the fallback list has run out and cannot be trusted. */
  holidaysExpired: boolean;
  reason: string;
};

/** "Saturday the 24th of October, 4:47pm" */
function spokenDateTime(d: DateTime): string {
  return `${d.toFormat("cccc")} the ${ordinal(d.day)} of ${d.toFormat("LLLL")}, ${d
    .toFormat("h:mma")
    .toLowerCase()}`;
}

/** "Monday the 26th of October" */
function spokenDate(d: DateTime): string {
  return `${d.toFormat("cccc")} the ${ordinal(d.day)} of ${d.toFormat("LLLL")}`;
}

function ordinal(n: number): string {
  // 11th, 12th and 13th are the exceptions that a naive last-digit rule gets
  // wrong, and a receptionist saying "the 11st" is immediately noticeable.
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
}

/**
 * Everything the agent needs to know about time, worked out here.
 *
 * Evaluated when the call is answered. A call that runs past 17:30 keeps the
 * status it started with, except that no new transfer is attempted — that
 * rule lives with the transfer tool, not here.
 */
export async function officeStatus(at?: DateTime): Promise<OfficeStatus> {
  const now = at || nowLondon();
  const { dates: holidays, stale } = await bankHolidays();

  const todayIso = now.toISODate() || "";
  const minutes = now.hour * 60 + now.minute;

  const workingDay = isWorkingDay(now, holidays);
  const withinHours = minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
  const officeOpen = workingDay && withinHours;

  let reason = "open";
  if (!workingDay) {
    if (isWeekend(now)) reason = "weekend";
    else if (holidays.has(todayIso)) reason = "bank holiday";
    else reason = "firm closure day";
  } else if (!withinHours) {
    reason = minutes < OPEN_MINUTES ? "before opening" : "after closing";
  }

  // Next working day. If the office is open right now, or we are before
  // opening on a working day, "next" is still today.
  let candidate = now;
  if (!workingDay || minutes >= CLOSE_MINUTES) {
    candidate = now.plus({ days: 1 }).startOf("day");
    for (let i = 0; i < 30 && !isWorkingDay(candidate, holidays); i++) {
      candidate = candidate.plus({ days: 1 });
    }
  }

  return {
    officeOpen,
    nowSpoken: spokenDateTime(now),
    nextWorkingDaySpoken: spokenDate(candidate),
    holidaysStale: stale,
    holidaysExpired: stale && todayIso > FALLBACK_HORIZON,
    reason,
  };
}
