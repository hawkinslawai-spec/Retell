import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getRetell } from "@/lib/retell-client";
import { amyAgentIds } from "@/lib/hawkins/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Rec = Record<string, unknown>;

/**
 * Read-only: how each version of Amy was set up — voice, voice tuning, model
 * and the start of her prompt — so a change in how she sounds can be traced
 * to the version that introduced it.
 */
export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const retell = getRetell();
    const agentId = req.nextUrl.searchParams.get("agent_id") || (await amyAgentIds())[0];
    if (!agentId) return NextResponse.json({ message: "No Amy agent found" }, { status: 404 });

    const list = (await retell.agent.listVersions(agentId)) as unknown as { items?: Rec[] } | Rec[];
    const items = (Array.isArray(list) ? list : list.items || []) as Rec[];

    const out = [];
    const newestFirst = [...items].sort((a, b) => Number(b.version) - Number(a.version));
    for (const item of newestFirst.slice(0, 12)) {
      const version = Number(item.version);
      const a = (await retell.agent.retrieve(agentId, { version })) as unknown as Rec;
      const engine = (a.response_engine || {}) as Rec;
      let llm: Rec = {};
      if (engine.llm_id) {
        llm = (await retell.llm
          .retrieve(String(engine.llm_id), typeof engine.version === "number" ? { version: engine.version } : undefined)
          .catch(() => ({}))) as unknown as Rec;
      }
      const pick = (o: Rec, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
      out.push({
        version,
        is_published: a.is_published ?? item.is_published,
        modified: a.last_modification_timestamp,
        ...pick(a, [
          "voice_id",
          "voice_model",
          "voice_temperature",
          "voice_speed",
          "volume",
          "responsiveness",
          "interruption_sensitivity",
          "enable_backchannel",
          "backchannel_frequency",
          "ambient_sound",
          "ambient_sound_volume",
          "language",
          "normalize_for_speech",
          "denoising_mode",
          "stt_mode",
          "fallback_voice_ids",
        ]),
        llm_model: llm.model ?? null,
        llm_temperature: llm.model_temperature ?? null,
        llm_high_priority: llm.model_high_priority ?? null,
        begin_message: llm.begin_message ?? null,
        prompt_start: String(llm.general_prompt ?? "").slice(0, 120),
      });
    }

    return NextResponse.json({ agentId, versions: out });
  } catch (err) {
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
