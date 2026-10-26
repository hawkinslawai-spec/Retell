import { NextRequest, NextResponse } from "next/server";
import { verifyWithReason } from "@/lib/retell-verify";
import { officeStatus } from "@/lib/hawkins/hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Inbound call webhook.
 *
 * Retell POSTs here the moment a call arrives and waits for the reply before
 * connecting the caller — the caller hears ringing until we answer, with a
 * 10 second budget and two retries. Everything in here is therefore written
 * to answer fast and to answer *something* rather than fail.
 *
 * Its job is to hand Amy the four values the specification says she must
 * never work out for herself: whether the office is open, the current time,
 * the next working day, and the caller's number.
 *
 * Set this URL on the phone number in the Retell dashboard, under
 * "Inbound Webhook URL".
 */

type InboundBody = {
  event?: string;
  call_inbound?: {
    call_id?: string;
    agent_id?: string;
    from_number?: string;
    to_number?: string;
  };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verified for the record, but never used to refuse the call.
  //
  // A failed signature here would mean dropping a real client's call, and the
  // worst a forged request could achieve is setting office_open on a call
  // Retell is already handling — there is no data to steal and nothing to
  // write. Failing open is the right trade; the log line is how you find out.
  const auth = verifyWithReason(rawBody, req.headers.get("x-retell-signature"));
  if (!auth.ok) {
    console.warn("[inbound] signature not verified, continuing anyway:", auth.reason);
  }

  let body: InboundBody = {};
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    // Still answer. An unparseable body is our problem, not the caller's.
    console.error("[inbound] could not parse body");
  }

  const inbound = body.call_inbound || {};
  const fromNumber = inbound.from_number || "";

  let status;
  try {
    status = await officeStatus();
  } catch (err) {
    // Never let a clock or feed problem stop a call connecting. Closed is the
    // safe default: Amy takes a message instead of promising a transfer that
    // cannot happen.
    console.error("[inbound] office status failed, defaulting to closed:", err);
    status = {
      officeOpen: false,
      nowSpoken: "",
      nextWorkingDaySpoken: "the next working day",
      holidaysStale: true,
      holidaysExpired: true,
      reason: "status unavailable",
    };
  }

  if (status.holidaysExpired) {
    console.error(
      "[inbound] the fallback bank holiday list has run out and the GOV.UK feed is unreachable — " +
        "the office may show as open on a bank holiday. Update FALLBACK_HOLIDAYS in lib/hawkins/hours.ts."
    );
  }

  return NextResponse.json({
    call_inbound: {
      dynamic_variables: {
        // Retell renders dynamic variables into the prompt as strings.
        office_open: status.officeOpen ? "true" : "false",
        now_spoken: status.nowSpoken,
        next_working_day_spoken: status.nextWorkingDaySpoken,
        caller_id_number: fromNumber,
      },
      metadata: {
        office_status_reason: status.reason,
        holidays_stale: String(status.holidaysStale),
      },
    },
  });
}

/** Lets you eyeball what Amy would be told, without placing a call. */
export async function GET() {
  const status = await officeStatus();
  return NextResponse.json(status);
}
