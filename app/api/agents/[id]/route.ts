import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getAgent, updateAgent, deleteAgent } from "@/lib/retell-agents";
import { getAgentSettings, saveAgentSettings } from "@/lib/agent-settings";
import { deleteScreenAgent } from "@/lib/screening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;
  try {
    const [agent, settings] = await Promise.all([getAgent(id), getAgentSettings(id)]);
    return NextResponse.json({ agent, settings });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Agent not found" },
      { status: 404 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // The screening agent's ID is provisioned server-side, never sent by the
    // browser. saveAgentSettings writes every column it is given and nulls the
    // rest, so read the current value and hand it back or the screener gets
    // orphaned in Retell on the next save and a new one is built each time.
    const existing = await getAgentSettings(id);

    // Settings first: updateAgent regenerates tools from what's stored.
    await saveAgentSettings({
      agentId: id,
      screenAgentId: existing.screenAgentId,
      agentName: String(body.agent_name ?? "").trim(),
      alertNumber: String(body.alert_number ?? "").trim(),
      alertOnBook: body.alert_on_book !== false,
      alertOnLead: body.alert_on_lead !== false,
      customLogs: body.custom_logs,
      transferNumber: String(body.transfer_number ?? "").trim(),
      transferMode: String(body.transfer_mode ?? "warm"),
      transferNote: String(body.transfer_note ?? "").trim(),
      screenPrompt: String(body.screen_prompt ?? "").trim(),
      screenRingSeconds: Number(body.screen_ring_seconds ?? 25),
      screenDecideSeconds: Number(body.screen_decide_seconds ?? 30),
      screenOnTimeout: String(body.screen_on_timeout ?? "cancel"),
      summaryEmail: String(body.summary_email ?? "").trim(),
      emailEveryCall: body.email_every_call === true,
      emailOnTransfer: body.email_on_transfer !== false,
    });

    await updateAgent(id, String(body.llm_id ?? ""), {
      agentName: String(body.agent_name ?? "").trim(),
      voiceId: String(body.voice_id ?? "").trim(),
      language: String(body.language ?? "en-US"),
      model: String(body.model ?? "gpt-4.1"),
      generalPrompt: String(body.general_prompt ?? ""),
      beginMessage: String(body.begin_message ?? ""),
      temperature: Number(body.model_temperature ?? 0.6),
    });

    const [agent, settings] = await Promise.all([getAgent(id), getAgentSettings(id)]);
    return NextResponse.json({ agent, settings });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to save agent" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;
  try {
    // Take the screener with it. Otherwise every deleted agent leaves a
    // "— screener" behind cluttering the Retell dashboard forever.
    const settings = await getAgentSettings(id);
    if (settings.screenAgentId) await deleteScreenAgent(settings.screenAgentId);

    await deleteAgent(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
