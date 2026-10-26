// Central configuration. Everything is env-driven so you can reuse this
// codebase for multiple clients without touching the code.

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** IANA timezone of the BUSINESS (not the caller). e.g. "America/New_York" */
export const TIMEZONE = process.env.BUSINESS_TIMEZONE || "America/New_York";

/** Length of one appointment, in minutes. */
export const APPOINTMENT_MINUTES = num(process.env.APPOINTMENT_MINUTES, 30);

/** How far apart slot start times are. Set equal to APPOINTMENT_MINUTES for back-to-back. */
export const SLOT_STEP_MINUTES = num(process.env.SLOT_STEP_MINUTES, 30);

/** Business open/close hour in 24h format, in TIMEZONE. */
export const BUSINESS_START_HOUR = num(process.env.BUSINESS_START_HOUR, 9);
export const BUSINESS_END_HOUR = num(process.env.BUSINESS_END_HOUR, 17);

/** Luxon weekday numbers: 1 = Monday ... 7 = Sunday. Default Mon-Fri. */
export const WORKING_DAYS: number[] = (process.env.WORKING_DAYS || "1,2,3,4,5")
  .split(",")
  .map((d) => Number(d.trim()))
  .filter((d) => Number.isFinite(d) && d >= 1 && d <= 7);

/** Minimum notice before a booking can start, in minutes. Stops "book me in 2 minutes". */
export const MIN_LEAD_MINUTES = num(process.env.MIN_LEAD_MINUTES, 60);

/** How many days ahead the agent is allowed to book. */
export const MAX_DAYS_AHEAD = num(process.env.MAX_DAYS_AHEAD, 60);

/** How many open slots to read back to the caller. Three is the sweet spot on a phone call. */
export const MAX_SLOTS_RETURNED = num(process.env.MAX_SLOTS_RETURNED, 3);

/** Business name used in appointment records and agent prompts. */
export const BUSINESS_NAME = process.env.BUSINESS_NAME || "Hawkings Law";

/** Shown in the sidebar and page titles. */
export const BRAND_NAME = process.env.BRAND_NAME || "Hawkings Law";

/** Set to "false" ONLY while testing with curl. Never in production. */
export const VERIFY_SIGNATURE = process.env.RETELL_VERIFY_SIGNATURE !== "false";
