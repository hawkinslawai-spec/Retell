import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { mailMethod, senderAddress, sendMail } from "@/lib/mailer";
import { DateTime } from "luxon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send one real email to the sending mailbox itself.
 *
 * The health check can prove credentials and permissions without sending,
 * but only an actual send proves the whole path — and sending to reception@
 * itself means nobody at the firm is bothered by a test.
 *
 * POST /api/health/test-email  (signed-in admin only)
 */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const to = senderAddress();
  if (!to) return NextResponse.json({ message: "No sending mailbox configured" }, { status: 400 });

  const when = DateTime.now().setZone("Europe/London").toFormat("ccc d LLL yyyy, HH:mm");

  try {
    await sendMail({
      fromName: "Hawkins Law reception",
      to: [to],
      subject: `Test email from the AI receptionist (${when})`,
      text:
        `This is a test sent by the AI receptionist's setup checks at ${when} (London).\n\n` +
        `Method: ${mailMethod() === "graph" ? "Microsoft Graph (OAuth)" : "SMTP"}\n` +
        `If you can read this, call messages will reach fee earners. No action is needed.`,
    });
    return NextResponse.json({ sent: true, to, method: mailMethod() });
  } catch (err) {
    return NextResponse.json(
      { sent: false, to, method: mailMethod(), message: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
