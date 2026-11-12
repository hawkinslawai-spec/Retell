/**
 * Amy's editable settings: staff, routing, voice and the firm wording she
 * may say. Stored as one JSON row in amy_settings (migration 15).
 *
 * What is NOT here, on purpose: the guardrails (no legal advice, no fees, no
 * confirming who is a client), the client account script, the whisper and
 * the transfer mechanics. Those are the parts where a well-meant edit can do
 * real harm, so they stay in code.
 *
 * Read on the call path (send-message decides recipients from it), so the
 * same three defences as the opening hours: a short cache, a timeout, and the
 * built-in defaults whenever the table is missing, empty or unreachable.
 */

import { getSupabase, isSupabaseConfigured } from "../supabase";
import {
  DEFAULT_STAFF,
  DEFAULT_ROUTES,
  FIRM,
  GENERAL_EMAIL,
  type Staff,
  type RoutingTable,
  type FirmFacts,
} from "./firm";

export type AmySettings = {
  staff: Staff[];
  routes: RoutingTable;
  /** Copied on every message, and the fallback recipient. */
  generalEmail: string;
  firm: FirmFacts;
  /**
   * Extra name guidance for Amy, in plain English — e.g. two names that
   * sound alike. Shared surnames and near-misses are generated from the staff
   * list; this is for anything the list can't express.
   */
  nameGuidance: string;
  /** Retell voice id. Empty means AMY_VOICE_ID from the environment. */
  voiceId: string;
  /** Speaking speed, 0.5–2. 1 is the voice's natural pace. */
  voiceSpeed: number;
  /** Expressiveness, 0–2. Lower is steadier and calmer; 1 is the default. */
  voiceTemperature: number;
};

export type StoredSettings = AmySettings & {
  usingDefaults: boolean;
  updatedAt?: string;
  error?: string;
};

export const ROUTE_LABELS: Record<keyof RoutingTable, string> = {
  new_enquiry: "New enquiries",
  unknown_handler: "Existing clients who don't know their handler (and anyone asking for someone not on the list)",
  third_party: "Third parties — agents, lenders, other firms",
  complaint: "Complaints and bank-detail concerns",
};

export function defaultSettings(): AmySettings {
  return {
    staff: DEFAULT_STAFF.map((s) => ({ ...s, variants: [...s.variants] })),
    routes: {
      new_enquiry: [...DEFAULT_ROUTES.new_enquiry],
      unknown_handler: [...DEFAULT_ROUTES.unknown_handler],
      third_party: [...DEFAULT_ROUTES.third_party],
      complaint: [...DEFAULT_ROUTES.complaint],
    },
    generalEmail: GENERAL_EMAIL,
    firm: {
      name: FIRM.name,
      address: FIRM.address,
      websiteSpoken: FIRM.websiteSpoken,
      emailSpoken: FIRM.emailSpoken,
      practiceAreasSpoken: FIRM.practiceAreasSpoken,
      descriptionSpoken: FIRM.descriptionSpoken,
    },
    nameGuidance: "Aqilah Patel and Aqeel Ramzan sound alike: always confirm which one is meant.",
    voiceId: "",
    voiceSpeed: 1,
    voiceTemperature: 1,
  };
}

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /does not exist|could not find the table|schema cache/i.test(err.message || "")
  );
}

const MIGRATION_HINT =
  "The amy_settings table doesn't exist yet, so nothing can be saved. Run supabase-migration-15.sql in the Supabase SQL editor, then save again.";

type Cached = { at: number; value: StoredSettings };
let cache: Cached | null = null;
const TTL_MS = 30_000;
const READ_TIMEOUT_MS = 3_000;

export function invalidateSettings(): void {
  cache = null;
}

function withDefaults(error?: string): StoredSettings {
  return { ...defaultSettings(), usingDefaults: true, error };
}

/**
 * Fill anything missing from a stored row with the default, so a row saved
 * by an older build (before a field existed) still produces a whole config.
 */
function merge(raw: Partial<AmySettings>): AmySettings {
  const d = defaultSettings();
  return {
    staff: Array.isArray(raw.staff) && raw.staff.length > 0 ? raw.staff : d.staff,
    routes: { ...d.routes, ...(raw.routes || {}) },
    generalEmail: raw.generalEmail || d.generalEmail,
    firm: { ...d.firm, ...(raw.firm || {}) },
    nameGuidance: typeof raw.nameGuidance === "string" ? raw.nameGuidance : d.nameGuidance,
    voiceId: typeof raw.voiceId === "string" ? raw.voiceId : d.voiceId,
    voiceSpeed: typeof raw.voiceSpeed === "number" ? raw.voiceSpeed : d.voiceSpeed,
    voiceTemperature: typeof raw.voiceTemperature === "number" ? raw.voiceTemperature : d.voiceTemperature,
  };
}

export async function getAmySettings(opts: { fresh?: boolean } = {}): Promise<StoredSettings> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;

  if (!isSupabaseConfigured()) {
    const value = withDefaults("Database not configured");
    cache = { at: Date.now(), value };
    return value;
  }

  try {
    const read = getSupabase().from("amy_settings").select("config, updated_at").eq("id", 1).maybeSingle();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out reading Amy's settings")), READ_TIMEOUT_MS)
    );
    const { data, error } = (await Promise.race([read, timeout])) as {
      data: { config?: unknown; updated_at?: string } | null;
      error: { code?: string; message?: string } | null;
    };

    let value: StoredSettings;
    if (error) {
      value = withDefaults(
        isMissingTable(error)
          ? "amy_settings table not found — run supabase-migration-15.sql"
          : error.message || error.code || "unknown error"
      );
    } else if (!data || !data.config || typeof data.config !== "object") {
      value = withDefaults();
    } else {
      value = {
        ...merge(data.config as Partial<AmySettings>),
        usingDefaults: false,
        updatedAt: data.updated_at,
      };
    }

    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    // Don't cache a timeout for long: the next call should try again.
    const value = withDefaults(err instanceof Error ? err.message : String(err));
    cache = { at: Date.now() - TTL_MS + 5_000, value };
    return value;
  }
}

// ------------------------------------------------------------------ validation

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID = /^[a-z][a-z0-9]{1,23}$/;

/** UK numbers typed the way people write them: 07815 935588, 020 3504 1612, +44 (0)20… */
export function normaliseUkNumber(raw: string): string {
  let n = String(raw || "").replace(/[\s()\-.]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (n.startsWith("+440")) n = "+44" + n.slice(4);
  if (n.startsWith("0")) n = "+44" + n.slice(1);
  return n;
}

export function idFromName(firstName: string): string {
  return (firstName || "")
    .normalize("NFKD")
    .replace(/[^\w]/g, "")
    .replace(/_/g, "")
    .toLowerCase()
    .slice(0, 24);
}

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * Turn whatever the page posted into settings, or say exactly what's wrong.
 * Nothing is written unless the whole thing passes.
 */
export function parseSettings(body: unknown): { ok: true; value: AmySettings } | { ok: false; message: string } {
  const b = (body || {}) as Record<string, unknown>;
  const errors: string[] = [];

  // ---- staff
  const rawStaff = Array.isArray(b.staff) ? (b.staff as Record<string, unknown>[]) : [];
  if (rawStaff.length === 0) errors.push("Add at least one member of staff.");
  if (rawStaff.length > 25) errors.push("Up to 25 members of staff are supported.");

  const staff: Staff[] = rawStaff.map((r, i) => {
    const firstName = clean(r.firstName, 40);
    const fullName = clean(r.fullName, 80);
    const id = clean(r.id, 24).toLowerCase() || idFromName(firstName);
    const label = fullName || firstName || `Row ${i + 1}`;

    if (!firstName) errors.push(`${label}: first name is required.`);
    if (!fullName) errors.push(`${label}: full name is required.`);
    if (!ID.test(id)) {
      errors.push(`${label}: the id "${id}" must be 2–24 lowercase letters or digits, starting with a letter.`);
    }

    const directLine = normaliseUkNumber(String(r.directLine ?? ""));
    if (!E164.test(directLine)) {
      errors.push(`${label}: "${r.directLine ?? ""}" isn't a valid phone number. Use a UK number like 020 3504 1612 or +44 7815 935588.`);
    }

    const email = clean(r.email, 120).toLowerCase();
    if (!EMAIL.test(email)) errors.push(`${label}: "${email}" isn't a valid email address.`);

    const variants = (Array.isArray(r.variants)
      ? (r.variants as unknown[])
      : String(r.variants ?? "").split(",")
    )
      .map((v) => clean(v, 40).toLowerCase())
      .filter(Boolean)
      .filter((v, j, arr) => arr.indexOf(v) === j)
      .slice(0, 20);

    return { id, firstName, fullName, directLine, email, variants };
  });

  const dupe = (key: (s: Staff) => string, what: string) => {
    const seen = new Map<string, string>();
    for (const s of staff) {
      const k = key(s);
      if (!k) continue;
      if (seen.has(k)) errors.push(`${seen.get(k)} and ${s.fullName} have the same ${what}.`);
      else seen.set(k, s.fullName);
    }
  };
  dupe((s) => s.id, "id");
  dupe((s) => s.directLine, "direct line");
  dupe((s) => s.firstName.toLowerCase(), "first name — Amy would have no way to tell them apart");

  // ---- routing
  const ids = new Set(staff.map((s) => s.id));
  const rawRoutes = (b.routes || {}) as Record<string, unknown>;
  const routes = {} as RoutingTable;
  for (const key of Object.keys(ROUTE_LABELS) as (keyof RoutingTable)[]) {
    const list = (Array.isArray(rawRoutes[key]) ? (rawRoutes[key] as unknown[]) : [])
      .map((v) => clean(v, 24).toLowerCase())
      .filter(Boolean)
      .filter((v, j, arr) => arr.indexOf(v) === j);
    if (list.length === 0) errors.push(`${ROUTE_LABELS[key]}: choose at least one person to ring.`);
    if (list.length > 4) errors.push(`${ROUTE_LABELS[key]}: up to 4 people — callers can't hold longer than that.`);
    for (const id of list) {
      if (!ids.has(id)) errors.push(`${ROUTE_LABELS[key]}: "${id}" isn't on the staff list.`);
    }
    routes[key] = list;
  }

  // ---- firm wording
  const rawFirm = (b.firm || {}) as Record<string, unknown>;
  const firm: FirmFacts = {
    name: clean(rawFirm.name, 80),
    address: clean(rawFirm.address, 200),
    websiteSpoken: clean(rawFirm.websiteSpoken, 120),
    emailSpoken: clean(rawFirm.emailSpoken, 120),
    practiceAreasSpoken: clean(rawFirm.practiceAreasSpoken, 600),
    descriptionSpoken: clean(rawFirm.descriptionSpoken, 800),
  };
  const firmLabels: Record<keyof FirmFacts, string> = {
    name: "Firm name",
    address: "Address",
    websiteSpoken: "Website (as spoken)",
    emailSpoken: "Email (as spoken)",
    practiceAreasSpoken: "Practice areas",
    descriptionSpoken: "Firm description",
  };
  for (const k of Object.keys(firm) as (keyof FirmFacts)[]) {
    if (!firm[k]) errors.push(`${firmLabels[k]} can't be empty.`);
  }

  const nameGuidance = clean(b.nameGuidance, 600);

  // Retell treats {{…}} as a variable to fill in, so text containing it would
  // silently change meaning on a live call. Backticks would end the prompt's
  // template string in a later refactor; neither has any use here.
  const freeText = [
    ...staff.flatMap((s) => [s.firstName, s.fullName, ...s.variants]),
    ...Object.values(firm),
    nameGuidance,
  ];
  if (freeText.some((t) => /\{\{|\}\}|`/.test(t))) {
    errors.push("Text can't contain {{, }} or backticks.");
  }

  const generalEmail = clean(b.generalEmail, 120).toLowerCase();
  if (!EMAIL.test(generalEmail)) errors.push(`General email "${generalEmail}" isn't a valid email address.`);

  const voiceId = clean(b.voiceId, 120);

  const num = (v: unknown, def: number) => (v === undefined || v === null || v === "" ? def : Number(v));
  const voiceSpeed = Math.round(num(b.voiceSpeed, 1) * 100) / 100;
  const voiceTemperature = Math.round(num(b.voiceTemperature, 1) * 100) / 100;
  if (!(voiceSpeed >= 0.7 && voiceSpeed <= 1.3)) errors.push("Speaking speed must be between 0.7 and 1.3.");
  if (!(voiceTemperature >= 0 && voiceTemperature <= 2)) errors.push("Expressiveness must be between 0 and 2.");

  if (errors.length > 0) {
    return { ok: false, message: [...new Set(errors)].slice(0, 12).join("\n") };
  }

  return {
    ok: true,
    value: { staff, routes, generalEmail, firm, nameGuidance, voiceId, voiceSpeed, voiceTemperature },
  };
}

export async function saveAmySettings(
  value: AmySettings
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Database is not configured, so settings cannot be saved." };
  }

  const { error } = await getSupabase()
    .from("amy_settings")
    .upsert({ id: 1, config: value, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) {
    return {
      ok: false,
      message: isMissingTable(error) ? MIGRATION_HINT : error.message || error.code || "Could not save",
    };
  }

  invalidateSettings();
  return { ok: true };
}
