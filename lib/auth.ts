import { NextRequest } from "next/server";

export const ADMIN_COOKIE = "ht_admin";

/**
 * Guards the console API. Accepts either the cookie set at login or an
 * x-admin-token header, so scripts and curl still work.
 */
export function checkAdmin(req: NextRequest): { ok: boolean; status: number; message: string } {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return { ok: false, status: 503, message: "ADMIN_TOKEN is not configured on this server" };
  }

  const header = req.headers.get("x-admin-token") || "";
  const cookie = req.cookies.get(ADMIN_COOKIE)?.value || "";

  if (header !== expected && cookie !== expected) {
    return { ok: false, status: 401, message: "Not signed in" };
  }
  return { ok: true, status: 200, message: "" };
}

/** Guards the cron endpoint. Header, bearer token or query param all work. */
export function checkCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get("x-cron-secret") || "";
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const query = req.nextUrl.searchParams.get("secret") || "";

  return header === expected || bearer === expected || query === expected;
}
