import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { provisionTwilioNumber } from "@/lib/twilio-provision";
import { importNumber } from "@/lib/retell-numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const steps: string[] = [];

  try {
    const body = (await req.json()) as Record<string, unknown>;

    const accountSid = String(body.account_sid ?? "").trim();
    const authToken = String(body.auth_token ?? "").trim();
    const phone = String(body.phone_number ?? "").trim();
    const label = String(body.label ?? "").trim();

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
            "That doesn't look like an Account SID. It's a 34-character string starting with AC, found at the top of the Twilio console dashboard.",
        },
        { status: 400 }
      );
    }

    if (!/^\+\d{7,15}$/.test(phone)) {
      return NextResponse.json(
        { message: "Phone number must be E.164, e.g. +14157774444" },
        { status: 400 }
      );
    }

    // 1. Build the SIP trunk in Twilio.
    const provisioned = await provisionTwilioNumber({ accountSid, authToken }, phone, label);
    steps.push(...provisioned.steps);

    // 2. Hand the result to Retell.
    await importNumber({
      phoneNumber: phone,
      terminationUri: provisioned.terminationUri,
      sipUsername: provisioned.username,
      sipPassword: provisioned.password,
      nickname: label || undefined,
      inboundAgentId: String(body.inbound_agent_id ?? "").trim(),
      outboundAgentId: String(body.outbound_agent_id ?? "").trim(),
    });
    steps.push("Number is live in Retell");

    return NextResponse.json({
      imported: true,
      termination_uri: provisioned.terminationUri,
      trunk_sid: provisioned.trunkSid,
      steps,
    });
  } catch (err) {
    return NextResponse.json(
      {
        message: err instanceof Error ? err.message : "Setup failed",
        steps,
      },
      { status: 500 }
    );
  }
}
