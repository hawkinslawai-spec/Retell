import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { verifyWithReason, parseRetellBody, str } from "@/lib/retell-verify";
import { saveLead } from "@/lib/records";
import { upsertContact } from "@/lib/crm";
import { getAgentSettings } from "@/lib/agent-settings";
import { sendSms, hotLeadMessage } from "@/lib/sms";
import { BRAND_NAME } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const auth = verifyWithReason(rawBody, req.headers.get("x-retell-signature"));
  if (!auth.ok) {
    // The reason is echoed back so it appears in Retell's call log, where you
    // can actually see it without digging through server logs.
    return NextResponse.json({ message: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  const { args, call } = parseRetellBody(rawBody);
  const settings = await getAgentSettings(str(call.agent_id));

  const name = str(args.name) || str(args.customer_name);
  const callerNumber =
    str(call.direction) === "outbound" ? str(call.to_number) : str(call.from_number);
  const phone = str(args.phone) || str(args.phone_number) || callerNumber;
  const email = str(args.email);
  const interest = str(args.interest) || str(args.service) || str(args.reason);
  const notes = str(args.notes) || str(args.summary);
  const callId = str(call.call_id);

  // The agent decides this. Anything other than an explicit no counts as yes,
  // because a missed hot lead costs more than an extra text message.
  const interestedRaw = str(args.interested).toLowerCase();
  const interested = interestedRaw === "true" || interestedRaw === "yes";

  if (!name && !phone) {
    return NextResponse.json({
      saved: false,
      message: "I still need a name or a phone number before I can pass this along.",
    });
  }

  // Written after the response has gone back to Retell, so the caller never
  // waits on a database round trip mid-sentence.
  after(async () => {
    if (interested && settings.alertOnLead && settings.alertNumber) {
      await sendSms(
        settings.alertNumber,
        hotLeadMessage({ name, phone, interest, notes, brand: BRAND_NAME })
      );
    }

    await saveLead({
      name,
      phone,
      email,
      interest,
      notes,
      interested,
      callId,
      agentId: str(call.agent_id),
    });
    await upsertContact({ phone, name, email, source: "voice agent", countCall: false });
  });

  return NextResponse.json({
    saved: true,
    message: "Got it, I've noted your details down.",
  });
}
