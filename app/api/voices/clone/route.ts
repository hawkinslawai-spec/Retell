import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { cloneVoiceFromAudio } from "@/lib/retell-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 25;

export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const form = await req.formData();
    const voiceName = String(form.get("voice_name") ?? "").trim();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);

    if (!voiceName) {
      return NextResponse.json({ message: "Name the voice before uploading" }, { status: 400 });
    }
    if (files.length === 0) {
      return NextResponse.json({ message: "Attach at least one audio file" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ message: `Up to ${MAX_FILES} files` }, { status: 400 });
    }

    const oversized = files.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      return NextResponse.json(
        { message: `${oversized.name} is over 25MB — trim it down first` },
        { status: 400 }
      );
    }

    const prepared = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        type: f.type || "audio/mpeg",
        data: Buffer.from(await f.arrayBuffer()),
      }))
    );

    const voice = await cloneVoiceFromAudio({ voiceName, files: prepared });
    return NextResponse.json({ voice });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Clone failed" },
      { status: 500 }
    );
  }
}
