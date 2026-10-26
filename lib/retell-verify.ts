import { createHmac, timingSafeEqual } from "crypto";
import { VERIFY_SIGNATURE } from "./config";

export type VerifyResult = { ok: boolean; reason: string };

/**
 * Verify the X-Retell-Signature header.
 *
 * Retell sends "v=<unix_ms_timestamp>,d=<hex_digest>", where the digest is
 * HMAC-SHA256 over (raw body + timestamp) keyed with your API key.
 *
 * IMPORTANT: only the API key carrying the webhook badge in the Retell
 * dashboard can verify signatures. A different key produces a valid-looking
 * request that fails every check — which surfaces as a blanket 401 on every
 * tool call and webhook.
 */
export function verifySignature(rawBody: string, signature: string | null): VerifyResult {
  if (!VERIFY_SIGNATURE) return { ok: true, reason: "verification disabled" };

  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) return { ok: false, reason: "RETELL_API_KEY is not set on the server" };
  if (!signature) return { ok: false, reason: "no x-retell-signature header on the request" };

  const match = signature.match(/v=(\d+),d=([a-fA-F0-9]+)/);

  if (match) {
    const timestamp = match[1];
    const digest = match[2].toLowerCase();

    const expected = createHmac("sha256", apiKey)
      .update(rawBody + timestamp)
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(digest, "utf8");
    const matches = a.length === b.length && timingSafeEqual(a, b);

    if (!matches) {
      return {
        ok: false,
        reason:
          "signature did not match — RETELL_API_KEY is almost certainly not the key with the webhook badge in the Retell dashboard",
      };
    }

    // Freshness. Checked after the digest so a clock problem is never reported
    // as a key problem.
    const age = Math.abs(Date.now() - Number(timestamp));
    if (age > 10 * 60 * 1000) {
      return { ok: false, reason: `signature is ${Math.round(age / 1000)}s old — server clock drift` };
    }

    return { ok: true, reason: "ok" };
  }

  return {
    ok: false,
    reason: `unrecognised signature format: ${signature.slice(0, 24)}…`,
  };
}

/** Back-compatible wrapper for the existing endpoints. */
export async function verifyRetellSignature(
  rawBody: string,
  signature: string | null
): Promise<boolean> {
  const result = verifySignature(rawBody, signature);
  if (!result.ok) console.error("[retell] signature rejected:", result.reason);
  return result.ok;
}

/** Returns the reason too, so endpoints can report it back to Retell's call log. */
export function verifyWithReason(rawBody: string, signature: string | null): VerifyResult {
  const result = verifySignature(rawBody, signature);
  if (!result.ok) console.error("[retell] signature rejected:", result.reason);
  return result;
}

export type RetellPayload = {
  name?: string;
  args: Record<string, unknown>;
  call: Record<string, unknown>;
};

/**
 * Retell sends either { name, call, args } or — when "Payload: args only" is
 * switched on — just the bare arguments object. Handles both.
 */
export function parseRetellBody(rawBody: string): RetellPayload {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const hasWrapper =
    typeof parsed.args === "object" && parsed.args !== null && !Array.isArray(parsed.args);

  return {
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    args: hasWrapper ? (parsed.args as Record<string, unknown>) : parsed,
    call:
      typeof parsed.call === "object" && parsed.call !== null
        ? (parsed.call as Record<string, unknown>)
        : {},
  };
}

export function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
