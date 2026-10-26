import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { listNumbers, listAgents, importNumber } from "@/lib/retell-numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const [numbers, agents] = await Promise.all([listNumbers(), listAgents()]);
    return NextResponse.json({ numbers, agents });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load phone numbers" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const body = (await req.json()) as Record<string, unknown>;

    const phoneNumber = String(body.phone_number ?? "").trim();
    const terminationUri = String(body.termination_uri ?? "").trim();

    if (!phoneNumber || !terminationUri) {
      return NextResponse.json(
        { message: "phone_number and termination_uri are both required" },
        { status: 400 }
      );
    }

    if (!/^\+\d{7,15}$/.test(phoneNumber)) {
      return NextResponse.json(
        { message: "phone_number must be E.164, e.g. +14157774444" },
        { status: 400 }
      );
    }

    const result = await importNumber({
      phoneNumber,
      terminationUri,
      sipUsername: String(body.sip_username ?? "").trim(),
      sipPassword: String(body.sip_password ?? "").trim(),
      nickname: String(body.nickname ?? "").trim(),
      inboundAgentId: String(body.inbound_agent_id ?? "").trim(),
      outboundAgentId: String(body.outbound_agent_id ?? "").trim(),
    });

    return NextResponse.json({ imported: true, number: result });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
