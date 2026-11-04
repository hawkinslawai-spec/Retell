import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getRetell } from "@/lib/retell-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retell's voices, British female first — Section 3 requires one. */
export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const rows = (await getRetell().voice.list()) as unknown as Record<string, unknown>[];
    const voices = (Array.isArray(rows) ? rows : []).map((v) => ({
      id: String(v.voice_id ?? ""),
      name: String(v.voice_name ?? ""),
      provider: String(v.provider ?? ""),
      gender: String(v.gender ?? ""),
      accent: String(v.accent ?? ""),
      age: String(v.age ?? ""),
      preview: String(v.preview_audio_url ?? ""),
    }));

    const british = (a: string) => /brit|english|\buk\b|london|scot|irish|welsh|\brp\b/i.test(a);
    voices.sort((a, b) => {
      const score = (v: (typeof voices)[number]) =>
        (british(v.accent) ? 0 : 2) + (v.gender === "female" ? 0 : 1);
      return score(a) - score(b) || a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      voices: voices.map((v) => ({ ...v, recommended: british(v.accent) && v.gender === "female" })),
    });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Could not list voices" },
      { status: 500 }
    );
  }
}
