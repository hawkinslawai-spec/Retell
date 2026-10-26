import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { verifyWithReason, parseRetellBody, str } from "@/lib/retell-verify";
import {
  resolveDate,
  isWorkingDay,
  businessWindow,
  getBusyIntervals,
  generateOpenSlots,
  filterByPreference,
  spokenTime,
  spokenDate,
  joinSpoken,
  now,
} from "@/lib/slots";
import { MAX_SLOTS_RETURNED, MAX_DAYS_AHEAD, TIMEZONE } from "@/lib/config";
import { getAgentSettings } from "@/lib/agent-settings";

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
  await getAgentSettings(str(call.agent_id));
  const requestedDate = str(args.date);
  const preference = str(args.preferred_time);

  const dateISO = resolveDate(requestedDate);
  if (!dateISO) {
    return NextResponse.json({
      available: false,
      message:
        "I didn't quite catch that date. What day were you thinking of — for example, this Thursday?",
    });
  }

  const day = DateTime.fromISO(dateISO, { zone: TIMEZONE });
  const today = now().startOf("day");

  if (day < today) {
    return NextResponse.json({
      available: false,
      date: dateISO,
      message: `${spokenDate(day)} has already passed. Which upcoming day works for you?`,
    });
  }

  if (day > today.plus({ days: MAX_DAYS_AHEAD })) {
    return NextResponse.json({
      available: false,
      date: dateISO,
      message: `I can only book up to ${MAX_DAYS_AHEAD} days ahead. Could we pick something sooner?`,
    });
  }

  if (!isWorkingDay(dateISO)) {
    return NextResponse.json({
      available: false,
      date: dateISO,
      message: `We're closed on ${spokenDate(day)}. Would a weekday work instead?`,
    });
  }

  const window = businessWindow(dateISO);
  if (!window) {
    return NextResponse.json({
      available: false,
      date: dateISO,
      message: "I couldn't read that date. What day would you like?",
    });
  }

  try {
    const busy = await getBusyIntervals(window.start, window.end);
    const open = filterByPreference(generateOpenSlots(window, busy), preference);
    const chosen = open.slice(0, MAX_SLOTS_RETURNED);

    if (chosen.length === 0) {
      return NextResponse.json({
        available: false,
        date: dateISO,
        spoken_date: spokenDate(day),
        slots: [],
        message: `I don't have anything open on ${spokenDate(day)}. Would you like me to check another day?`,
      });
    }

    const spoken = chosen.map((s) => spokenTime(s.start));

    return NextResponse.json({
      available: true,
      date: dateISO,
      spoken_date: spokenDate(day),
      slots: spoken,
      slots_iso: chosen.map((s) => s.start.toISO()),
      first_slot_iso: chosen[0].start.toISO(),
      message: `On ${spokenDate(day)} I have ${joinSpoken(spoken)} available. Which one suits you?`,
    });
  } catch (err) {
    console.error("[check-availability] availability lookup failed:", err);
    return NextResponse.json({
      available: false,
      // Not spoken — but Retell shows the raw tool response in the call log,
      // which is where you look when the agent apologises about the diary.
      debug: err instanceof Error ? err.message : String(err),
      message:
        "I'm having trouble reaching the diary right now. Can I take your number and have a colleague confirm the time with you?",
    });
  }
}
