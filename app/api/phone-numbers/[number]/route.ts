import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { deleteNumber } from "@/lib/retell-numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ number: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { number } = await ctx.params;

  try {
    // The number arrives URL-encoded because "+" is meaningful in a path.
    await deleteNumber(decodeURIComponent(number));
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
