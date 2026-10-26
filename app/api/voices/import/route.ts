import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { importVoiceById } from "@/lib/retell-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const providerVoiceId = String(body.provider_voice_id ?? "").trim();
    const voiceName = String(body.voice_name ?? "").trim();

    if (!providerVoiceId || !voiceName) {
      return NextResponse.json(
        { message: "Both the ElevenLabs voice ID and a name for it are required" },
        { status: 400 }
      );
    }

    const voice = await importVoiceById({
      providerVoiceId,
      voiceName,
      publicUserId: String(body.public_user_id ?? "").trim(),
    });

    return NextResponse.json({ voice });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json(
      {
        message: /public_user_id|owner/i.test(message)
          ? `${message} — a private ElevenLabs voice usually needs the owner's ElevenLabs user ID, found on their ElevenLabs profile page.`
          : message,
      },
      { status: 500 }
    );
  }
}
