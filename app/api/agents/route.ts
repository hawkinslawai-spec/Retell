import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { listAgents, listVoices, createAgent, appBaseUrl, MODELS, LANGUAGES } from "@/lib/retell-agents";
import { saveAgentSettings, getAgentSettings } from "@/lib/agent-settings";
import { parseLogs } from "@/lib/custom-logs";
import { upsertScreenAgent, defaultScreenPrompt } from "@/lib/screening";
import { BUSINESS_NAME } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const [agents, voices] = await Promise.all([listAgents(), listVoices()]);
    return NextResponse.json({
      agents,
      voices,
      models: MODELS,
      languages: LANGUAGES,
      base_url: appBaseUrl(),
    });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to load agents" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const body = (await req.json()) as Record<string, unknown>;

    const agentName = String(body.agent_name ?? "").trim();
    const voiceId = String(body.voice_id ?? "").trim();

    if (!agentName || !voiceId) {
      return NextResponse.json(
        { message: "Agent name and voice are both required" },
        { status: 400 }
      );
    }

    const customLogs = parseLogs(body.custom_logs);

    const language = String(body.language ?? "en-US");
    const transferNumber = String(body.transfer_number ?? "").trim();
    const rawMode = String(body.transfer_mode ?? "warm");
    const transferMode: "warm" | "cold" | "screen" =
      rawMode === "cold" ? "cold" : rawMode === "screen" ? "screen" : "warm";
    const screenPrompt = String(body.screen_prompt ?? "").trim();

    // Build the screener before the main agent, because the main agent's
    // transfer tool has to reference it by ID. If this fails we carry on with
    // an empty ID and buildTools degrades to a plain warm transfer — a new
    // agent that can't transfer at all would be worse.
    let screenAgentId = "";
    if (transferMode === "screen" && transferNumber) {
      screenAgentId = await upsertScreenAgent("", {
        name: `${agentName} — screener`,
        prompt: screenPrompt || defaultScreenPrompt(BUSINESS_NAME),
        voiceId,
        language,
      });
    }

    const agentId = await createAgent({
      agentName,
      voiceId,
      language,
      model: String(body.model ?? "gpt-4.1"),
      generalPrompt: String(body.general_prompt ?? ""),
      beginMessage: String(body.begin_message ?? ""),
      temperature: Number(body.model_temperature ?? 0.6),
    }, customLogs, {
      number: transferNumber,
      mode: transferMode,
      note: String(body.transfer_note ?? "").trim(),
      screenAgentId,
      ringSeconds: Number(body.screen_ring_seconds ?? 25),
      decideSeconds: Number(body.screen_decide_seconds ?? 30),
      onTimeout: String(body.screen_on_timeout ?? "cancel") === "bridge" ? "bridge" : "cancel",
    });

    await saveAgentSettings({
      agentId,
      agentName,
      alertNumber: String(body.alert_number ?? "").trim(),
      alertOnBook: body.alert_on_book !== false,
      alertOnLead: body.alert_on_lead !== false,
      customLogs,
      transferNumber,
      transferMode,
      transferNote: String(body.transfer_note ?? "").trim(),
      screenAgentId,
      screenPrompt,
      screenRingSeconds: Number(body.screen_ring_seconds ?? 25),
      screenDecideSeconds: Number(body.screen_decide_seconds ?? 30),
      screenOnTimeout: String(body.screen_on_timeout ?? "cancel"),
      summaryEmail: String(body.summary_email ?? "").trim(),
      emailEveryCall: body.email_every_call === true,
      emailOnTransfer: body.email_on_transfer !== false,
    });

    return NextResponse.json({ agent_id: agentId });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Failed to create agent" },
      { status: 500 }
    );
  }
}
