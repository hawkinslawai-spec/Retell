import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getRetell } from "@/lib/retell-client";
import { normalisePhone } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Place a single outbound call immediately, bypassing campaigns entirely.
 *
 * This exists so you can hear the agent before committing a list to it. It
 * ignores calling windows, daily caps and the DNC list, so it is deliberately
 * one number at a time and admin-only.
 */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const body = (await req.json()) as Record<string, unknown>;

    const fromNumber = String(body.from_number ?? "").trim();
    const rawTo = String(body.to_number ?? "").trim();
    const agentId = String(body.agent_id ?? "").trim();
    const name = String(body.name ?? "").trim();

    if (!fromNumber || !rawTo) {
      return NextResponse.json(
        { message: "Pick a number to call from, and enter a number to call" },
        { status: 400 }
      );
    }

    const toNumber = normalisePhone(rawTo, String(body.country_code ?? "44"));
    if (!toNumber) {
      return NextResponse.json({ message: "That doesn't look like a valid number" }, { status: 400 });
    }

    if (toNumber === fromNumber) {
      return NextResponse.json(
        { message: "The number you're calling is the same as the number you're calling from" },
        { status: 400 }
      );
    }

    const retell = getRetell();
    const call = await retell.call.createPhoneCall({
      from_number: fromNumber,
      to_number: toNumber,
      // Only override when a specific agent is picked; otherwise the number's
      // own outbound agent handles it, which is what a real campaign call does.
      override_agent_id: agentId || undefined,
      metadata: { source: "quick_dialer" },
      retell_llm_dynamic_variables: {
        customer_name: name || "there",
        customer_phone: toNumber,
        customer_email: String(body.email ?? "").trim(),
        attempt: "1",
      },
    });

    return NextResponse.json({
      call_id: call.call_id,
      to_number: toNumber,
      status: (call as unknown as Record<string, unknown>).call_status ?? "registered",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Call failed";
    return NextResponse.json(
      {
        message: /agent/i.test(message)
          ? `${message} — check the number has an outbound agent bound on the Phone Numbers page.`
          : message,
      },
      { status: 500 }
    );
  }
}
