import { getSupabase, normalisePhone, E164, Campaign, CampaignLead, LeadStatus } from "./supabase";
import { createBatchCall, listCallsForBatch, BatchTask, CallOutcome } from "./retell-client";

export type TickResult = {
  campaign: string;
  synced: number;
  queued: number;
  retried: number;
  suppressed: number;
  completed: boolean;
  imported?: number;
  called_today?: number;
  skipped?: string;
  error?: string;
};

/**
 * Map a Retell call outcome onto a lead status.
 *
 * Anything that never reached a human — busy, no answer, dial failure,
 * voicemail, answering machine — is retryable. Everything else is terminal:
 * the call connected and whatever happened, happened.
 */
function classify(outcome: CallOutcome): LeadStatus {
  const reason = (outcome.disconnectReason || "").toLowerCase();

  if (outcome.inVoicemail) return "no_answer";
  if (reason.startsWith("dial_")) return "no_answer";
  if (reason.includes("voicemail") || reason.includes("machine")) return "no_answer";
  if (reason.includes("error") || outcome.status === "error") return "failed";
  if (reason.includes("concurrency")) return "no_answer";

  return "answered";
}

async function syncBatch(campaign: Campaign, batchCallId: string): Promise<number> {
  const supabase = getSupabase();
  const outcomes = await listCallsForBatch(batchCallId);
  if (outcomes.length === 0) return 0;

  const { data: leads } = await supabase
    .from("campaign_leads")
    .select("id, phone, attempts, status")
    .eq("campaign_id", campaign.id)
    .eq("batch_call_id", batchCallId);

  const byId = new Map<string, { id: string; phone: string; attempts: number; status: string }>();
  const byPhone = new Map<string, { id: string; phone: string; attempts: number; status: string }>();
  for (const lead of leads || []) {
    byId.set(lead.id, lead);
    byPhone.set(lead.phone, lead);
  }

  let synced = 0;

  for (const outcome of outcomes) {
    // Ongoing calls have no final outcome yet — leave them queued.
    if (outcome.status === "ongoing" || outcome.status === "registered") continue;

    const lead = (outcome.leadId ? byId.get(outcome.leadId) : null) || byPhone.get(outcome.toNumber);
    if (!lead || lead.status !== "queued") continue;

    const status = classify(outcome);
    const retryable = status === "no_answer" && lead.attempts < campaign.max_attempts;

    const { error } = await supabase
      .from("campaign_leads")
      .update({
        status: retryable ? "pending" : status,
        call_id: outcome.callId,
        disposition: outcome.disconnectReason || outcome.status,
        summary: outcome.summary,
        recording_url: outcome.recordingUrl,
        next_attempt_at: retryable
          ? new Date(Date.now() + campaign.retry_after_minutes * 60_000).toISOString()
          : null,
      })
      .eq("id", lead.id);

    if (!error) synced += 1;
  }

  return synced;
}

async function suppressDnc(campaignId: string, leads: CampaignLead[]): Promise<Set<string>> {
  if (leads.length === 0) return new Set();

  const supabase = getSupabase();
  const phones = leads.map((l) => l.phone);

  const { data: blocked } = await supabase.from("dnc_list").select("phone").in("phone", phones);
  const blockedSet = new Set((blocked || []).map((b) => b.phone as string));
  if (blockedSet.size === 0) return blockedSet;

  await supabase
    .from("campaign_leads")
    .update({ status: "suppressed", next_attempt_at: null })
    .eq("campaign_id", campaignId)
    .in("phone", Array.from(blockedSet));

  return blockedSet;
}

async function queueNextBatch(
  campaign: Campaign,
  headroom: number
): Promise<{ queued: number; suppressed: number }> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const take = Math.min(campaign.batch_size, headroom);

  const { data: due } = await supabase
    .from("campaign_leads")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .lt("attempts", campaign.max_attempts)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(take);

  const leads = (due || []) as CampaignLead[];
  if (leads.length === 0) return { queued: 0, suppressed: 0 };

  const blocked = await suppressDnc(campaign.id, leads);
  const notBlocked = leads.filter((l) => !blocked.has(l.phone));

  // Drop numbers that can never connect, BEFORE they reach Retell.
  //
  // Retell rejects a whole batch if any single task has a malformed number, so
  // one typo in an imported list used to stall an entire campaign while the UI
  // cheerfully showed "calling". Failing them here, individually, keeps the
  // rest of the batch moving and leaves a readable reason on the dead row.
  const callable = notBlocked.filter((lead) => E164.test(lead.phone));
  const invalid = notBlocked.filter((lead) => !E164.test(lead.phone));

  if (invalid.length > 0) {
    for (const lead of invalid) {
      await supabase
        .from("campaign_leads")
        .update({
          status: "failed",
          disposition: "invalid phone number",
          last_attempt_at: new Date().toISOString(),
          next_attempt_at: null,
        })
        .eq("id", lead.id);
    }
    console.warn(
      `[campaigns] dropped ${invalid.length} invalid number(s) from "${campaign.name}":`,
      invalid.map((l) => l.phone).join(", ")
    );
  }

  if (callable.length === 0) {
    return { queued: 0, suppressed: blocked.size + invalid.length };
  }

  const tasks: BatchTask[] = callable.map((lead) => ({
    to_number: lead.phone,
    metadata: { lead_id: lead.id, campaign_id: campaign.id },
    retell_llm_dynamic_variables: {
      ...(lead.variables || {}),
      customer_name: lead.name || "there",
      customer_phone: lead.phone,
      customer_email: lead.email || "",
      attempt: String(lead.attempts + 1),
    },
  }));

  const batchCallId = await createBatchCall({
    fromNumber: campaign.from_number,
    name: `${campaign.name} — ${new Date().toISOString().slice(0, 16)}`,
    tasks,
    reservedConcurrency: campaign.reserved_concurrency,
    window: {
      timezone: campaign.timezone,
      startMin: campaign.window_start_min,
      endMin: campaign.window_end_min,
      days: campaign.call_days,
    },
  });

  const ids = callable.map((l) => l.id);
  const attemptsById = new Map(callable.map((l) => [l.id, l.attempts]));

  // Supabase has no bulk "increment per row", so bump attempts individually.
  // Batch size is capped, so this stays small.
  for (const id of ids) {
    await supabase
      .from("campaign_leads")
      .update({
        status: "queued",
        batch_call_id: batchCallId,
        attempts: (attemptsById.get(id) ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        next_attempt_at: null,
      })
      .eq("id", id);
  }

  return { queued: callable.length, suppressed: blocked.size + invalid.length };
}

/** Local calendar date in the campaign's timezone, as YYYY-MM-DD. */
function localDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** UTC instant of local midnight today, for the daily-cap counter. */
function localMidnightUtc(timezone: string): string {
  const today = localDate(timezone);
  const guess = new Date(`${today}T00:00:00Z`);
  try {
    const asLocal = new Date(guess.toLocaleString("en-US", { timeZone: timezone }));
    const offset = guess.getTime() - asLocal.getTime();
    return new Date(guess.getTime() + offset).toISOString();
  } catch {
    return guess.toISOString();
  }
}

async function calledToday(campaign: Campaign): Promise<number> {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .gte("last_attempt_at", localMidnightUtc(campaign.timezone));
  return count ?? 0;
}

/**
 * Pull new enquiries from the leads table into this campaign.
 *
 * This replaces the old Google Sheets sync. The inbound agent saves a lead
 * whenever a caller leaves details without booking; with this switched on, a
 * follow-up campaign picks those up automatically and rings them back without
 * anyone exporting or importing anything.
 *
 * Only leads the agent marked as interested are pulled, so "do not call"
 * records and wrong numbers never get dialled back. The upsert is keyed on
 * (campaign_id, phone) and ignores duplicates, which makes this safe to run on
 * every tick — a lead already in the campaign is never re-added, even after
 * it has been called and completed.
 */
async function syncLeads(campaign: Campaign): Promise<number> {
  const supabase = getSupabase();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("name, phone, email, interest, notes")
    .eq("interested", true)
    .not("phone", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[campaigns] lead sync failed:", error);
    return 0;
  }

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];

  for (const lead of (leads || []) as Record<string, string | null>[]) {
    const phone = normalisePhone(lead.phone || "");
    // Drop unreachable numbers at the door rather than letting them fail
    // later in a batch.
    if (!phone || seen.has(phone) || !E164.test(phone)) continue;

    // Never auto-dial someone who asked not to be called, whatever the
    // interested flag says.
    const notes = (lead.notes || "").toLowerCase();
    if (notes.includes("do not call") || notes.includes("dnc")) continue;

    seen.add(phone);
    rows.push({
      campaign_id: campaign.id,
      phone,
      name: lead.name || null,
      email: lead.email || null,
      variables: lead.interest ? { interest: lead.interest } : {},
      status: "pending",
    });
  }

  if (rows.length === 0) return 0;

  const { data } = await supabase
    .from("campaign_leads")
    .upsert(rows, { onConflict: "campaign_id,phone", ignoreDuplicates: true })
    .select("id");

  return data?.length ?? 0;
}

export async function tickCampaign(campaign: Campaign): Promise<TickResult> {
  const supabase = getSupabase();
  const result: TickResult = {
    campaign: campaign.name,
    synced: 0,
    queued: 0,
    retried: 0,
    suppressed: 0,
    completed: false,
  };

  try {
    const today = localDate(campaign.timezone);

    // A campaign past its end date stops for good.
    if (campaign.end_date && today > campaign.end_date) {
      await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaign.id);
      result.completed = true;
      result.skipped = "past end date";
      return result;
    }

    // 1. Reconcile any batches still in flight. This runs even before the
    //    start date, so outcomes from a previous run are never lost.
    const { data: inFlight } = await supabase
      .from("campaign_leads")
      .select("batch_call_id")
      .eq("campaign_id", campaign.id)
      .eq("status", "queued")
      .not("batch_call_id", "is", null);

    const batchIds = Array.from(
      new Set((inFlight || []).map((r) => r.batch_call_id as string).filter(Boolean))
    );

    for (const batchId of batchIds) {
      result.synced += await syncBatch(campaign, batchId);
    }

    // 2. Optionally pull new rows from the linked sheet.
    if (campaign.auto_sync_leads) {
      try {
        result.imported = await syncLeads(campaign);
      } catch (err) {
        console.error(`[campaign ${campaign.name}] sheet sync failed:`, err);
      }
    }

    // 3. Hold off if the campaign hasn't started yet.
    if (campaign.start_date && today < campaign.start_date) {
      result.skipped = `starts ${campaign.start_date}`;
      return result;
    }

    // 4. Respect the daily cap. Counted from local midnight in the campaign's
    //    own timezone, not UTC, so "200 a day" means what the client thinks.
    const already = await calledToday(campaign);
    const headroom = Math.max(0, campaign.daily_cap - already);
    result.called_today = already;

    if (headroom === 0) {
      result.skipped = `daily cap reached (${already}/${campaign.daily_cap})`;
      return result;
    }

    // 5. Queue the next batch of due leads.
    const queued = await queueNextBatch(campaign, headroom);
    result.queued = queued.queued;
    result.suppressed = queued.suppressed;

    // 6. Count what's left. A campaign is done only when nothing is pending
    //    AND nothing is still out on a call.
    const { count: remaining } = await supabase
      .from("campaign_leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .in("status", ["pending", "queued"]);

    const { count: waiting } = await supabase
      .from("campaign_leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .not("next_attempt_at", "is", null);

    result.retried = waiting ?? 0;

    if ((remaining ?? 0) === 0) {
      await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaign.id);
      result.completed = true;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[campaign ${campaign.name}] tick failed:`, err);
  }

  return result;
}

export async function tickAllActive(): Promise<TickResult[]> {
  const supabase = getSupabase();

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "active");

  if (error) throw new Error(error.message);

  const results: TickResult[] = [];
  for (const campaign of (campaigns || []) as Campaign[]) {
    results.push(await tickCampaign(campaign));
  }
  return results;
}

export type CampaignStats = {
  total: number;
  pending: number;
  queued: number;
  answered: number;
  no_answer: number;
  failed: number;
  suppressed: number;
};

export async function getStats(campaignId: string): Promise<CampaignStats> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("campaign_leads")
    .select("status")
    .eq("campaign_id", campaignId);

  const stats: CampaignStats = {
    total: 0,
    pending: 0,
    queued: 0,
    answered: 0,
    no_answer: 0,
    failed: 0,
    suppressed: 0,
  };

  for (const row of data || []) {
    stats.total += 1;
    const key = row.status as keyof CampaignStats;
    if (key in stats && key !== "total") stats[key] += 1;
  }

  return stats;
}
