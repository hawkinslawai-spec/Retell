import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifyWithReason, parseRetellBody, str } from "@/lib/retell-verify";
import { CLIENT_ACCOUNT_SCRIPT, resolveStaff, GENERAL_EMAIL } from "@/lib/hawkins/firm";
import { recordAccountReadout } from "@/lib/hawkins/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * get_client_account_details (Section 10).
 *
 * Returns the read-out script as fixed configuration. The details are never
 * written into Amy's prompt, which is the whole point of this endpoint: a
 * model that has only ever seen the sort code in a tool result cannot recite
 * it from memory, cannot paraphrase it, and cannot be talked into confirming
 * a different one.
 *
 * This is conveyancing fraud territory. A caller about to send a deposit is
 * exactly who a fraudster impersonates, and the controls in the script — read
 * our details rather than confirm theirs, the bank name check, the "we never
 * change details by email" line — are what stand between a client and a lost
 * house deposit. None of them are optional, so they are part of the returned
 * string rather than instructions the model could decide to summarise.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const auth = verifyWithReason(rawBody, req.headers.get("x-retell-signature"));
  if (!auth.ok) {
    return NextResponse.json({ message: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  const { args, call } = parseRetellBody(rawBody);

  const handler = resolveStaff(str(args.file_handler));
  const callerName = str(args.caller_name);
  const phone = str(args.phone) || str(call.from_number);
  const matterLabel = str(args.matter_label);

  // Every read-out is recorded and emailed to the file handler, or to info@
  // when the handler isn't known. Done after the response so the caller isn't
  // left waiting mid-sentence.
  after(async () => {
    await recordAccountReadout({
      callerName,
      phone,
      matterLabel,
      fileHandler: handler ? handler.fullName : "",
      handlerEmail: handler ? handler.email : GENERAL_EMAIL,
      callId: str(call.call_id),
    });
  });

  return NextResponse.json({
    // The agent is instructed to read this exactly, one digit at a time.
    script: CLIENT_ACCOUNT_SCRIPT,
    instructions:
      "Read the script word for word, one digit at a time. Do not summarise it, " +
      "do not skip the payment reference, the bank name check or the fraud warning, " +
      "and do not confirm any details the caller reads to you.",
  });
}
