import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifyWithReason, parseRetellBody, str } from "@/lib/retell-verify";
import { getAgentSettings } from "@/lib/agent-settings";
import { saveLogEntry } from "@/lib/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Generic writer for user-defined logs.
 *
 * Each custom log gets its own generated tool whose URL carries ?log=<key>, so
 * one endpoint serves all of them and the agent never has to pass the log name
 * as an argument it could get wrong.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const auth = verifyWithReason(rawBody, req.headers.get("x-retell-signature"));
  if (!auth.ok) {
    return NextResponse.json({ message: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  const logKey = req.nextUrl.searchParams.get("log") || "";
  if (!logKey) {
    return NextResponse.json({ saved: false, message: "No log specified." }, { status: 400 });
  }

  const { args, call } = parseRetellBody(rawBody);
  const settings = await getAgentSettings(str(call.agent_id));

  const log = settings.customLogs.find((l) => l.key === logKey);
  if (!log) {
    return NextResponse.json({
      saved: false,
      debug: `No custom log "${logKey}" configured for this agent.`,
      message: "I've noted that down.",
    });
  }

  // Whoever isn't us. On inbound that's from_number, on outbound to_number.
  const callerNumber =
    str(call.direction) === "outbound" ? str(call.to_number) : str(call.from_number);

  const data: Record<string, string> = {};
  for (const field of log.fields) {
    const value = str(args[field.name]);
    if (value) {
      data[field.name] = value;
      continue;
    }

    // Fall back to the number the call is on. The agent often can't get a
    // number out of a caller who is already ringing from it, and a record with
    // a usable number beats no record at all.
    if (/phone|number|mobile|tel|contact/i.test(field.name) && callerNumber) {
      data[field.name] = callerNumber;
    } else {
      data[field.name] = "";
    }
  }

  // Record it even when it's thin. A partial record is recoverable;
  // a dropped one is gone.
  const hasAnything = Object.values(data).some(Boolean);
  if (!hasAnything && !callerNumber) {
    return NextResponse.json({
      saved: false,
      message: "I didn't catch enough detail to record that.",
    });
  }

  after(async () => {
    await saveLogEntry({
      logKey: log.key,
      logLabel: log.label,
      data,
      callId: str(call.call_id),
      agentId: str(call.agent_id),
      phone: callerNumber,
    });
  });

  return NextResponse.json({ saved: true, message: `Noted — I've recorded that.` });
}
