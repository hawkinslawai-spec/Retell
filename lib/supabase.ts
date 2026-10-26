import { createClient, SupabaseClient } from "@supabase/supabase-js";
import parsePhoneNumberFromString from "libphonenumber-js";

export type CampaignStatus = "draft" | "active" | "paused" | "completed";
export type LeadStatus = "pending" | "queued" | "answered" | "no_answer" | "failed" | "suppressed";

export type Campaign = {
  id: string;
  name: string;
  from_number: string;
  override_agent_id: string | null;
  status: CampaignStatus;
  timezone: string;
  window_start_min: number;
  window_end_min: number;
  call_days: string[];
  batch_size: number;
  max_attempts: number;
  retry_after_minutes: number;
  reserved_concurrency: number;
  daily_cap: number;
  start_date: string | null;
  end_date: string | null;
  auto_sync_leads: boolean;
  agent_label: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignLead = {
  id: string;
  campaign_id: string;
  phone: string;
  name: string | null;
  email: string | null;
  variables: Record<string, string>;
  status: LeadStatus;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  batch_call_id: string | null;
  call_id: string | null;
  disposition: string | null;
  summary: string | null;
  recording_url: string | null;
};

let client: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so it must only ever be used from server
 * code — never imported into a "use client" component.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Is this a real, dialable number?
 *
 * Hand-written country rules were a losing game — every bad import turned up a
 * new country whose length rule we'd got wrong, and the campaign would sit
 * there showing "calling" on a number Retell had already rejected. This defers
 * to libphonenumber's metadata instead, which knows the actual numbering plan
 * for every country.
 */
export function isValidPhone(value: string): boolean {
  try {
    const parsed = parsePhoneNumberFromString(value);
    return Boolean(parsed?.isValid());
  } catch {
    return false;
  }
}

/**
 * Kept as an object with a `test` method so it reads like the regex it
 * replaced at every call site.
 */
export const E164 = { test: (v: string) => isValidPhone(v) };

/**
 * Normalise to E.164-ish. Retell rejects anything that isn't E.164 unless you
 * explicitly opt out per task, so it's worth cleaning on the way in rather
 * than discovering it mid-campaign.
 */
export function normalisePhone(raw: string, defaultCountryCode = "1"): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;

  if (hadPlus) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+${defaultCountryCode}${digits.slice(1)}`;
  return `+${digits}`;
}
