import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifyWithReason, parseRetellBody, str } from "@/lib/retell-verify";
import { sendCallMessage, CallMessage } from "@/lib/hawkins/messages";
import { resolveStaff, routeFor, Route, GENERAL_EMAIL } from "@/lib/hawkins/firm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

/**
 * send_message (Section 8).
 *
 * Amy supplies the caller's details and which route the call falls under;
 * this decides the recipients from the routing table rather than letting the
 * model nominate them. That matters — a model asked to pick recipients will
 * occasionally send a conveyancing message to the wrong solicitor, and the
 * routing table exists precisely so it cannot.
 */

const ROUTES: Route[] = [
  "named_handler",
  "new_enquiry",
  "unknown_handler",
  "third_party",
  "complaint",
  "sales",
];

function callerType(route: Route): CallMessage["callerType"] {
  if (route === "complaint") return "complaint";
  if (route === "new_enquiry") return "new enquiry";
  if (route === "third_party") return "third party";
  return "existing client";
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const auth = verifyWithReason(rawBody, req.headers.get("x-retell-signature"));
  if (!auth.ok) {
    return NextResponse.json({ message: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  const { args, call } = parseRetellBody(rawBody);

  const rawRoute = str(args.route).toLowerCase().replace(/[\s-]/g, "_");
  const route: Route = ROUTES.includes(rawRoute as Route)
    ? (rawRoute as Route)
    : "unknown_handler";

  const handler = resolveStaff(str(args.file_handler));
  const { to, cc } = routeFor(route, handler);

  const callerName = str(args.caller_name);
  const phone =
    str(args.phone) || str(args.phone_number) || str(call.from_number);

  // The message itself is the one field with no sensible default. Without it
  // there is nothing to pass on, and a half-empty email trains staff to
  // ignore them.
  const messageText = str(args.message);
  if (!callerName && !phone) {
    return NextResponse.json({
      sent: false,
      message: "I still need a name or a number before I can pass this on.",
    });
  }

  const payload: CallMessage = {
    callerName: callerName || "Caller",
    phone,
    email: str(args.email),
    callerType: callerType(route),
    organisation: str(args.organisation),
    matterLabel: str(args.matter_label),
    fileHandler: handler ? handler.fullName : str(args.file_handler),
    whyNoTransfer:
      (["declined", "no answer", "busy", "office closed", "not attempted"].find(
        (r) => r === str(args.why_no_transfer).toLowerCase()
      ) as CallMessage["whyNoTransfer"]) || "not attempted",
    callback: str(args.callback),
    message: messageText || "No details given — please call back.",
    // Amy decides urgency from the triggers in Section 8; anything other than
    // an explicit no counts, because a missed exchange deadline costs more
    // than an unnecessary URGENT.
    urgent: /^(true|yes|urgent)$/i.test(str(args.urgent)),
    to: to.length > 0 ? to : [GENERAL_EMAIL],
    cc,
    callId: str(call.call_id),
    recordingUrl: str(call.recording_url),
  };

  // Sent after the response so Amy can carry on speaking to the caller while
  // SMTP does its work. The message is recorded inside sendCallMessage
  // whether or not the email gets through.
  after(async () => {
    const result = await sendCallMessage(payload);
    if (!result.sent) {
      console.error("[send-message] not delivered by email:", result.error);
    }
  });

  return NextResponse.json({
    sent: true,
    recipients: payload.to,
    urgent: payload.urgent,
    message: "Message recorded.",
  });
}
