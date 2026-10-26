import Retell from "retell-sdk";

let client: Retell | null = null;

export function getRetell(): Retell {
  if (client) return client;
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error("Missing RETELL_API_KEY environment variable");
  client = new Retell({ apiKey });
  return client;
}

/**
 * Retell's list endpoints return { has_more, items }, not a bare array.
 * Getting this wrong returns an empty list with no error, which is how agents,
 * phone numbers and call history all silently came back empty.
 */
export function unwrapList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const items = (res as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

export type BatchTask = {
  to_number: string;
  retell_llm_dynamic_variables?: Record<string, string>;
  metadata?: Record<string, string>;
};

export type TimeWindow = {
  timezone: string;
  startMin: number;
  endMin: number;
  days: string[];
};

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type DayName = (typeof DAY_NAMES)[number];

function toDayNames(days: string[]): DayName[] {
  return days.filter((d): d is DayName => (DAY_NAMES as readonly string[]).includes(d));
}

export async function createBatchCall(params: {
  fromNumber: string;
  name: string;
  tasks: BatchTask[];
  window: TimeWindow;
  reservedConcurrency?: number;
}): Promise<string> {
  const retell = getRetell();

  const res = await retell.batchCall.createBatchCall({
    from_number: params.fromNumber,
    name: params.name,
    tasks: params.tasks,
    reserved_concurrency: params.reservedConcurrency,
    call_time_window: {
      timezone: params.window.timezone,
      windows: [{ start: params.window.startMin, end: params.window.endMin }],
      day: toDayNames(params.window.days),
    },
  });

  return res.batch_call_id;
}

export type CallOutcome = {
  callId: string;
  toNumber: string;
  leadId: string | null;
  status: string;
  disconnectReason: string;
  successful: boolean | null;
  summary: string;
  recordingUrl: string;
  inVoicemail: boolean;
  durationMs: number;
};

/**
 * The Create Batch Call response only gives back a batch_call_id — never the
 * individual call ids. To reconcile outcomes we query List Calls filtered by
 * that batch id, then match each call back to a lead using the metadata we
 * attached when queueing.
 */
export async function listCallsForBatch(batchCallId: string, limit = 500): Promise<CallOutcome[]> {
  const retell = getRetell();

  const res = await retell.call.list({
    filter_criteria: {
      batch_call_id: { type: "string", op: "eq", value: batchCallId },
    },
    limit,
    sort_order: "descending",
  });

  const calls = unwrapList<unknown>(res);

  return calls.map((call) => {
    const c = call as Record<string, unknown>;
    const analysis = (c.call_analysis || {}) as Record<string, unknown>;
    const metadata = (c.metadata || {}) as Record<string, unknown>;

    return {
      callId: String(c.call_id ?? ""),
      toNumber: String(c.to_number ?? ""),
      leadId: typeof metadata.lead_id === "string" ? metadata.lead_id : null,
      status: String(c.call_status ?? ""),
      disconnectReason: String(c.disconnection_reason ?? ""),
      successful: typeof analysis.call_successful === "boolean" ? analysis.call_successful : null,
      summary: String(analysis.call_summary ?? ""),
      recordingUrl: String(c.recording_url ?? ""),
      inVoicemail: c.in_voicemail === true,
      durationMs: typeof c.duration_ms === "number" ? c.duration_ms : 0,
    };
  });
}
