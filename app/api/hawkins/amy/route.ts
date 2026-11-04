import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import {
  getAmySettings,
  parseSettings,
  saveAmySettings,
  defaultSettings,
  ROUTE_LABELS,
} from "@/lib/hawkins/settings";
import { amyLiveStatus, rebuildAmy } from "@/lib/hawkins/rebuild";
import { amyPrompt } from "@/lib/hawkins/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Amy settings page's API.
 *
 * GET  what is saved, plus what Retell is actually running.
 * PUT  validate → save → rebuild → publish → read the tools back.
 *      Nothing is saved if validation fails; if the rebuild fails after a
 *      save, the response says so and the page offers to try again.
 */
export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const settings = await getAmySettings({ fresh: true });
  const live = await amyLiveStatus(settings);

  // With no voice saved yet, show the one she is using rather than a blank.
  const voiceId = settings.voiceId || live.voiceId;

  const preview = req.nextUrl.searchParams.get("prompt") === "1";

  return NextResponse.json({
    settings: { ...settings, voiceId },
    defaults: defaultSettings(),
    routeLabels: ROUTE_LABELS,
    live,
    prompt: preview ? amyPrompt(settings) : undefined,
  });
}

export async function PUT(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const parsed = parseSettings(body);
  if (!parsed.ok) return NextResponse.json({ stage: "validate", message: parsed.message }, { status: 400 });

  const saved = await saveAmySettings(parsed.value);
  if (!saved.ok) return NextResponse.json({ stage: "save", message: saved.message }, { status: 400 });

  try {
    const result = await rebuildAmy({ settings: parsed.value });
    const live = await amyLiveStatus(parsed.value);
    return NextResponse.json(
      { stage: result.ok ? "done" : "publish", saved: true, result, live, message: result.message },
      { status: result.ok ? 200 : 502 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        stage: "publish",
        saved: true,
        message: `Saved, but rebuilding Amy failed: ${err instanceof Error ? err.message : String(err)}. Press Save & publish again.`,
      },
      { status: 502 }
    );
  }
}

/** Rebuild and publish from what is already saved, without changing anything. */
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  try {
    const settings = await getAmySettings({ fresh: true });
    const result = await rebuildAmy({ settings });
    const live = await amyLiveStatus(settings);
    return NextResponse.json(
      { stage: result.ok ? "done" : "publish", result, live, message: result.message },
      { status: result.ok ? 200 : 502 }
    );
  } catch (err) {
    return NextResponse.json(
      { stage: "publish", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
