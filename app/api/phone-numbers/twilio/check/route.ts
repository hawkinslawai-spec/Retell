import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { diagnose, recentActivity, repair } from "@/lib/twilio-diagnose";
import { terminationUriFor } from "@/lib/retell-numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Check, and optionally repair, the Twilio side of an inbound number.
 *
 * POST { account_sid, auth_token, phone_number, repair?: true }
 *
 * Twilio credentials live for the duration of this request. They are never
 * written to the database, never logged, and never returned in the response.
 */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const body = (await req.json()) as Record<string, unknown>;

    const accountSid = String(body.account_sid ?? "").trim();
    const authToken = String(body.auth_token ?? "").trim();
    const phone = String(body.phone_number ?? "").trim();
    const shouldRepair = body.repair === true;

    if (!accountSid || !authToken || !phone) {
      return NextResponse.json(
        { message: "Account SID, Auth Token and phone number are all required" },
        { status: 400 }
      );
    }

    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
      return NextResponse.json(
        {
          message:
            "That doesn't look like an Account SID. It's a 34-character string starting with AC, at the top of the Twilio console dashboard.",
        },
        { status: 400 }
      );
    }

    // Best-effort. Retell doesn't always surface this, and the diagnosis falls
    // back to other ways of identifying the trunk rather than giving up.
    const terminationUri = await terminationUriFor(phone).catch(() => "");
    const chosenTrunkSid = String(body.trunk_sid ?? "").trim();

    const creds = { accountSid, authToken };

    // Activity is fetched alongside the configuration checks, never instead of
    // them. A trunk that looks perfect and a call log that is empty is the
    // combination that tells you to stop looking at the trunk.
    const activity = recentActivity(creds, phone).catch(() => ({ calls: [], alerts: [] }));

    if (shouldRepair) {
      const { steps, diagnosis } = await repair(creds, phone, terminationUri, chosenTrunkSid);
      return NextResponse.json({ repaired: true, steps, ...diagnosis, ...(await activity) });
    }

    return NextResponse.json({
      repaired: false,
      ...(await diagnose(creds, phone, terminationUri, chosenTrunkSid)),
      ...(await activity),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Check failed";
    // Twilio's own wording for a bad token is "Authenticate", which reads as a
    // server fault rather than a typo in the field you just filled in.
    const friendly = /authenticate/i.test(message)
      ? "Twilio rejected those credentials. Check the Auth Token — it's the one beside the Account SID on the console dashboard, not an API key secret."
      : message;
    return NextResponse.json({ message: friendly }, { status: 500 });
  }
}
