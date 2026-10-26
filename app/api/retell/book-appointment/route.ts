import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { DateTime } from "luxon";
import { verifyWithReason, parseRetellBody, str } from "@/lib/retell-verify";
import { businessWindow, isWorkingDay, spokenDate, spokenTime, now } from "@/lib/slots";
import { createAppointment } from "@/lib/appointments";
import { getAgentSettings } from "@/lib/agent-settings";
import { sendSms, bookingMessage } from "@/lib/sms";
import { upsertContact } from "@/lib/crm";
import { TIMEZONE, APPOINTMENT_MINUTES, MIN_LEAD_MINUTES, BRAND_NAME } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Accept either a full ISO datetime, or a separate date + time from the LLM. */
function resolveStart(args: Record<string, unknown>): DateTime | null {
  const isoInput = str(args.start_time) || str(args.start_iso) || str(args.datetime);
  if (isoInput) {
    const parsed = DateTime.fromISO(isoInput, { zone: TIMEZONE });
    if (parsed.isValid) return parsed.setZone(TIMEZONE);
  }

  const datePart = str(args.date);
  const timePart = str(args.time);
  if (datePart && timePart) {
    const combined = DateTime.fromISO(`${datePart}T${timePart}`, { zone: TIMEZONE });
    if (combined.isValid) return combined;

    const loose = DateTime.fromFormat(`${datePart} ${timePart}`, "yyyy-LL-dd h:mm a", {
      zone: TIMEZONE,
    });
    if (loose.isValid) return loose;
  }

  return null;
}

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

  const name = str(args.name) || str(args.customer_name) || "Unknown caller";
  const phone = str(args.phone) || str(args.phone_number) || str(call.from_number);
  const email = str(args.email);
  const service = str(args.service) || str(args.reason) || "";
  const notes = str(args.notes);
  const callId = str(call.call_id) || `nocall-${Date.now()}`;

  const start = resolveStart(args);
  if (!start) {
    return NextResponse.json({
      booked: false,
      reason: "bad_time",
      message: "I didn't catch the exact time. What time would suit you?",
    });
  }

  const end = start.plus({ minutes: APPOINTMENT_MINUTES });

  // --- Validation: not in the past, enough notice, inside opening hours ---
  if (start < now().plus({ minutes: MIN_LEAD_MINUTES })) {
    return NextResponse.json({
      booked: false,
      reason: "too_soon",
      message: `We need a little more notice than that. Could we look at a later time?`,
    });
  }

  const dateISO = start.toISODate();
  const window = dateISO ? businessWindow(dateISO) : null;

  if (!dateISO || !window || !isWorkingDay(dateISO) || start < window.start || end > window.end) {
    return NextResponse.json({
      booked: false,
      reason: "outside_hours",
      message: `${spokenTime(start)} on ${spokenDate(start)} is outside our opening hours. Would you like me to check what's available that day?`,
    });
  }

  const result = await createAppointment({
    callId,
    agentId: str(call.agent_id),
    name,
    phone,
    email,
    service,
    notes,
    start,
    end,
  });

  if (!result.ok) {
    if (result.reason === "slot_taken") {
      return NextResponse.json({
        booked: false,
        reason: "slot_taken",
        message: `${spokenTime(start)} has just gone. Would you like me to check what else is open on ${spokenDate(start)}?`,
      });
    }

    console.error("[book-appointment] booking failed:", result.detail);
    return NextResponse.json({
      booked: false,
      reason: "error",
      debug: result.detail,
      message:
        "I couldn't lock that in just now. Let me take your number and a colleague will confirm it with you shortly.",
    });
  }

  if (result.alreadyBooked) {
    return NextResponse.json({
      booked: true,
      already_booked: true,
      appointment_id: result.id,
      start_time: start.toISO(),
      message: `You're all set for ${spokenTime(start)} on ${spokenDate(start)}.`,
    });
  }

  // Alerts and CRM happen after the response is sent, so they cost the caller
  // zero latency on a live call.
  after(async () => {
    if (settings.alertOnBook && settings.alertNumber) {
      await sendSms(
        settings.alertNumber,
        bookingMessage({
          name,
          phone,
          whenLabel: `${spokenTime(start)} on ${spokenDate(start)}`,
          service,
          brand: BRAND_NAME,
        })
      );
    }

    await upsertContact({ phone, name, email, source: "booking", booked: true });
  });

  return NextResponse.json({
    booked: true,
    appointment_id: result.id,
    start_time: start.toISO(),
    message: `Perfect, you're booked in for ${spokenTime(start)} on ${spokenDate(start)}. I've got that down under ${name}.`,
  });
}
