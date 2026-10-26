import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

/**
 * Page-level gate. API routes do their own checking, so they're excluded —
 * the Retell webhooks authenticate by signature, not by cookie.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
};

export function middleware(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return NextResponse.next();

  const cookie = req.cookies.get(ADMIN_COOKIE)?.value || "";
  if (cookie === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
