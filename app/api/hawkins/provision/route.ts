import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { appBaseUrl } from "@/lib/retell-agents";
import { amyTools } from "@/lib/hawkins/agent";
import { amyPrompt } from "@/lib/hawkins/prompt";
import { officeStatus } from "@/lib/hawkins/hours";
import { rebuildAmy } from "@/lib/hawkins/rebuild";
import { getAmySettings } from "@/lib/hawkins/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Build or rebuild Amy in Retell, then publish her.
 *
 * The work is in lib/hawkins/rebuild.ts, shared with the Amy settings page so
 * both go live the same way. The prompt and tools are written together
 * because they have to agree — a prompt that says "call transfer_to_aqeel"
 * against an agent with no such tool is a silent failure on a live call.
 *
 * POST /api/hawkins/provision              finds Amy by name and updates her
 * POST /api/hawkins/provision?agent_id=…   updates that agent
 */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as {
    agent_id?: string;
    voice_id?: string;
    screen_agent_id?: string;
  };

  try {
    const r = await rebuildAmy({
      agentId: body.agent_id || req.nextUrl.searchParams.get("agent_id") || "",
      voiceId: body.voice_id,
      screenAgentId: body.screen_agent_id,
    });

    const status = await officeStatus();
    if (status.holidaysStale) {
      r.warnings.push(
        "The GOV.UK bank holiday feed could not be read, so the fallback list is in use. Check it covers the year ahead."
      );
    }

    return NextResponse.json(
      {
        ok: r.ok,
        message: r.message,
        agent_id: r.agentId,
        llm_id: r.llmId,
        screen_agent_id: r.screenAgentId,
        published_version: r.publishedVersion,
        screener_version: r.screenerVersion,
        numbers_repointed: r.numbersUpdated,
        removed_screening_agents: r.removedScreeners,
        tools: r.tools,
        inbound_webhook_url: `${appBaseUrl()}/api/retell/inbound`,
        office_status: status,
        warnings: r.warnings,
      },
      { status: r.agentId ? 200 : 400 }
    );
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

  const settings = await getAmySettings({ fresh: true });
  return NextResponse.json({
    prompt: amyPrompt(settings),
    staff: settings.staff.map((s) => ({ id: s.id, name: s.fullName, email: s.email })),
    tools: (amyTools("preview", settings.staff) || []).map(
      (t: { name?: string; type?: string }) => `${t.name} (${t.type})`
    ),
    office_status: await officeStatus(),
  });
}
