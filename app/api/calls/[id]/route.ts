import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { getCall } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;
  try {
    return NextResponse.json({ call: await getCall(id) });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Call not found" },
      { status: 404 }
    );
  }
}
