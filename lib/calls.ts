import { getRetell, unwrapList } from "./retell-client";

export type CallRow = {
  callId: string;
  agentId: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  startedAt: number;
  durationMs: number;
  status: string;
  disconnectReason: string;
  successful: boolean | null;
  sentiment: string;
  summary: string;
  recordingUrl: string;
  costUsd: number;
};

export type TranscriptTurn = { role: string; content: string };

function toRow(row: unknown): CallRow {
  const c = row as unknown as Record<string, unknown>;
  const analysis = (c.call_analysis || {}) as Record<string, unknown>;
  const cost = (c.call_cost || {}) as Record<string, unknown>;
  const start = typeof c.start_timestamp === "number" ? c.start_timestamp : 0;

  return {
    callId: String(c.call_id ?? ""),
    agentId: String(c.agent_id ?? ""),
    direction: String(c.direction ?? ""),
    fromNumber: String(c.from_number ?? ""),
    toNumber: String(c.to_number ?? ""),
    startedAt: start,
    durationMs:
      typeof c.duration_ms === "number"
        ? c.duration_ms
        : typeof c.end_timestamp === "number" && start
          ? c.end_timestamp - start
          : 0,
    status: String(c.call_status ?? ""),
    disconnectReason: String(c.disconnection_reason ?? ""),
    successful: typeof analysis.call_successful === "boolean" ? analysis.call_successful : null,
    sentiment: String(analysis.user_sentiment ?? ""),
    summary: String(analysis.call_summary ?? ""),
    recordingUrl: String(c.recording_url ?? ""),
    costUsd: typeof cost.combined_cost === "number" ? cost.combined_cost / 100 : 0,
  };
}

export async function listCalls(limit = 100): Promise<CallRow[]> {
  const retell = getRetell();
  const res = await retell.call.list({ limit, sort_order: "descending" });
  const rows = unwrapList<unknown>(res);
  return rows.map(toRow).filter((r) => r.callId);
}

export async function getCall(
  callId: string
): Promise<CallRow & { transcript: TranscriptTurn[]; transcriptText: string }> {
  const retell = getRetell();
  const call = (await retell.call.retrieve(callId)) as unknown as Record<string, unknown>;

  const objects = Array.isArray(call.transcript_object) ? call.transcript_object : [];
  const transcript: TranscriptTurn[] = objects.map((t) => {
    const turn = t as Record<string, unknown>;
    return { role: String(turn.role ?? ""), content: String(turn.content ?? "") };
  });

  return {
    ...toRow(call),
    transcript,
    transcriptText: String(call.transcript ?? ""),
  };
}
