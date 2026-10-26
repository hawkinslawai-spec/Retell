import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/auth";
import { updateContact, deleteContact } from "@/lib/crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    return NextResponse.json({ contact: await updateContact(id, body) });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { id } = await ctx.params;
  try {
    await deleteContact(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
