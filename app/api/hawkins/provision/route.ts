import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getRetell } from "@/lib/retell-client";
import { appBaseUrl } from "@/lib/retell-agents";
import { upsertScreener, amyTools } from "@/lib/hawkins/agent";
import { amyPrompt } from "@/lib/hawkins/prompt";
import { STAFF } from "@/lib/hawkins/firm";
import { officeStatus } from "@/lib/hawkins/hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Build or rebuild Amy in Retell from the specification.
 *
 * Everything about Amy lives in code, so this endpoint is the deploy step:
 * press it and the screening agent, all six transfer tools, the message tool,
 * the client account tool and the prompt are all written to Retell together.
 * That matters because the prompt and the tools have to agree — a prompt that
 * says "call transfer_to_aqeel" against an agent that has no such tool is a
 * silent failure that only shows up on a live call.
 *
 * POST /api/hawkins/provision          creates Amy
 * POST /api/hawkins/provision?agent_id=…  updates an existing agent in place
 */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const base = appBaseUrl();
  if (!base) {
    return NextResponse.json(
      {
        message:
          "APP_BASE_URL is not set, so the tool URLs would point nowhere. Set it, redeploy, then try again.",
      },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    agent_id?: string;
    voice_id?: string;
    screen_agent_id?: string;
  };

  const agentId = body.agent_id || req.nextUrl.searchParams.get("agent_id") || "";
  // A British female voice is a requirement of Section 3, not a preference.
  const voiceId = body.voice_id || process.env.AMY_VOICE_ID || "";

  if (!voiceId) {
    return NextResponse.json(
      {
        message:
          "No voice chosen. Pass voice_id, or set AMY_VOICE_ID. Section 3 requires a natural female British English voice — filter the voice list by British before choosing.",
      },
      { status: 400 }
    );
  }

  const retell = getRetell();
  const warnings: string[] = [];

  try {
    // 1. The screening agent that does the whisper.
    const screenAgentId = await upsertScreener(body.screen_agent_id || "", voiceId);
    if (!screenAgentId) {
      warnings.push(
        "The screening agent could not be created, so transfers fall back to a plain warm transfer " +
          "with NO keypress guard. Section 7 requires the keypress — do not go live like this."
      );
    }

    // 2. Amy's tools and prompt.
    const tools = amyTools(screenAgentId);
    const prompt = amyPrompt();

    let amyId = agentId;
    let llmId = "";

    if (agentId) {
      const existing = (await retell.agent.retrieve(agentId)) as unknown as Record<string, unknown>;
      const engine = (existing.response_engine || {}) as Record<string, unknown>;
      llmId = String(engine.llm_id ?? "");

      if (!llmId) {
        return NextResponse.json(
          { message: "That agent isn't a Retell LLM agent, so its prompt can't be updated here." },
          { status: 400 }
        );
      }

      await retell.llm.update(llmId, {
        model: (process.env.AMY_MODEL || "gpt-5.4") as never,
        general_prompt: prompt,
        begin_message: null,
        // Low, because almost everything Amy says is prescribed wording and
        // the guardrails must not be paraphrased into something softer.
        model_temperature: 0.3,
        general_tools: tools as never,
      });

      await retell.agent.update(agentId, {
        agent_name: "Amy — Hawkins Law reception",
        voice_id: voiceId,
        language: "en-GB" as never,
        webhook_url: `${base}/api/retell/webhook`,
      } as never);
    } else {
      const llm = await retell.llm.create({
        model: (process.env.AMY_MODEL || "gpt-5.4") as never,
        general_prompt: prompt,
        begin_message: null,
        model_temperature: 0.3,
        general_tools: tools as never,
      });
      llmId = llm.llm_id;

      const agent = await retell.agent.create({
        agent_name: "Amy — Hawkins Law reception",
        voice_id: voiceId,
        language: "en-GB" as never,
        response_engine: { type: "retell-llm", llm_id: llm.llm_id },
        webhook_url: `${base}/api/retell/webhook`,
      });
      amyId = agent.agent_id;
    }

    const status = await officeStatus();
    if (status.holidaysStale) {
      warnings.push(
        "The GOV.UK bank holiday feed could not be read, so the fallback list is in use. " +
          "Check it covers the year ahead."
      );
    }

    return NextResponse.json({
      agent_id: amyId,
      llm_id: llmId,
      screen_agent_id: screenAgentId,
      transfer_tools: STAFF.map((s) => `transfer_to_${s.id}`),
      inbound_webhook_url: `${base}/api/retell/inbound`,
      office_status: status,
      warnings,
      next_steps: [
        `Set the Inbound Webhook URL on the phone number in Retell to ${base}/api/retell/inbound — without it Amy has no office_open value and will assume the office is closed.`,
        "Set this agent as the number's inbound agent.",
        "Check RETELL_API_KEY is the key with the webhook badge, or every tool call returns 401.",
        "Test each staff name's pronunciation in the chosen voice with the person themselves (Section 3).",
      ],
    });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Could not build Amy" },
      { status: 500 }
    );
  }
}

/** What would be written, without writing it. */
export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  return NextResponse.json({
    prompt: amyPrompt(),
    staff: STAFF.map((s) => ({ id: s.id, name: s.fullName, email: s.email })),
    tools: (amyTools("preview") || []).map(
      (t: { name?: string; type?: string }) => `${t.name} (${t.type})`
    ),
    office_status: await officeStatus(),
  });
}
