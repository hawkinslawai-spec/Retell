import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { DateTime } from "luxon";
import { verifyWithReason } from "@/lib/retell-verify";
import { upsertContact } from "@/lib/crm";
import { getAgentSettings } from "@/lib/agent-settings";
import { sendCallSummaryEmail } from "@/lib/email";
import { TIMEZONE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RetellCall = {
  call_id?: string;
  agent_id?: string;
  agent_name?: string;
  direction?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  recording_url?: string;
  transcript?: string;
  transcript_with_tool_calls?: unknown;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    call_successful?: boolean;
  };
};

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Did this caller ask for a human, and did they get one?
 *
 * Read off the tool-call trail rather than guessed from the transcript. Written
 * defensively because the shape of transcript_with_tool_calls is not contractual
 * — if Retell changes it, this returns "" and the email simply omits the line
 * instead of breaking the summary.
 */
function transferOutcome(call: RetellCall): string {
  const entries = call.transcript_with_tool_calls;
  if (!Array.isArray(entries)) return "";

  let requested = false;
  let connected = false;
  let cancelled = false;

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = text(entry.name).toLowerCase();

    if (name.includes("transfer_to_team") || name.includes("transfer_call")) {
      requested = true;
      const result = `${text(entry.result)} ${text(entry.content)}`.toLowerCase();
      if (result.includes("transferred successfully") || result.includes("bridge")) {
        connected = true;
      }
      if (result.includes("cancel") || result.includes("declin")) cancelled = true;
    }

    if (name.includes("bridge_transfer")) connected = true;
    if (name.includes("cancel_transfer")) cancelled = true;
  }

  if (!requested) return "";
  if (connected) return "Requested and connected to a person";
  if (cancelled) return "Requested — the person declined or was unavailable";
  return "Requested — transfer did not complete";
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const auth = verifyWithReason(rawBody, req.headers.get("x-retell-signature"));
  if (!auth.ok) {
    // The reason is echoed back so it appears in Retell's call log, where you
    // can actually see it without digging through server logs.
    return NextResponse.json({ message: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  let body: { event?: string; call?: RetellCall } = {};
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return NextResponse.json({ message: "Bad JSON" }, { status: 400 });
  }

  const event = body.event || "";
  const call = body.call || {};

  // call_started and call_ended fire too, but call_analyzed is the one that
  // carries the summary and sentiment, so that's the only row worth logging.
  if (event !== "call_analyzed") {
    return NextResponse.json({ received: true, event });
  }

  const startedAt = call.start_timestamp
    ? DateTime.fromMillis(call.start_timestamp).setZone(TIMEZONE).toFormat("yyyy-LL-dd HH:mm:ss")
    : "";

  let durationSeconds: number | string = "";
  if (typeof call.duration_ms === "number") {
    durationSeconds = Math.round(call.duration_ms / 1000);
  } else if (call.start_timestamp && call.end_timestamp) {
    durationSeconds = Math.round((call.end_timestamp - call.start_timestamp) / 1000);
  }

  const settings = await getAgentSettings(text(call.agent_id));

  after(async () => {
    // The number to track is whoever isn't us.
    const counterparty =
      call.direction === "inbound" ? text(call.from_number) : text(call.to_number);
    if (counterparty) {
      await upsertContact({
        phone: counterparty,
        source: text(call.direction) || "call",
        summary: text(call.call_analysis?.call_summary),
        countCall: true,
      });
    }

    // Email the summary. Either on every call, or only when the caller asked
    // for a human — which is the setting most clients actually want, since a
    // mailbox full of "enquired about opening hours" gets ignored within a week.
    const outcome = transferOutcome(call);
    const wanted =
      settings.summaryEmail &&
      (settings.emailEveryCall || (settings.emailOnTransfer && outcome !== ""));

    if (wanted) {
      await sendCallSummaryEmail({
        to: settings.summaryEmail,
        callId: text(call.call_id),
        agentName: text(call.agent_name) || settings.agentName,
        direction: text(call.direction),
        fromNumber: text(call.from_number),
        toNumber: text(call.to_number),
        startedAt,
        durationSeconds,
        disconnectReason: text(call.disconnection_reason),
        sentiment: text(call.call_analysis?.user_sentiment),
        successful: text(call.call_analysis?.call_successful),
        summary: text(call.call_analysis?.call_summary),
        transcript: text(call.transcript),
        recordingUrl: text(call.recording_url),
        transferOutcome: outcome,
      });
    }
  });

  return NextResponse.json({ received: true });
}
