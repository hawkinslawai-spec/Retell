import nodemailer, { Transporter } from "nodemailer";
import { BRAND_NAME } from "./config";

/**
 * Call summaries by email, sent through Gmail's SMTP server.
 *
 * Why SMTP and not the Gmail API: sending as a Gmail user through the API
 * needs a service account with domain-wide delegation, which only exists on
 * Google Workspace. A personal Gmail account can never grant it, and this
 * deployment has no Google credentials at all by design.
 *
 * So the client generates a 16-character App Password instead:
 *   myaccount.google.com -> Security -> 2-Step Verification -> App passwords
 * That requires 2FA to be on. It is free, needs no domain, and is capped at
 * roughly 500 recipients a day, which is far above what call summaries use.
 *
 * If a client would rather not use Gmail at all, set SMTP_HOST/SMTP_PORT to
 * any other provider and the rest of this file is unchanged.
 */

let cached: Transporter | null = null;

function host(): string {
  return process.env.SMTP_HOST || "smtp.gmail.com";
}

function port(): number {
  const parsed = Number(process.env.SMTP_PORT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 465;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function getTransport(): Transporter {
  if (cached) return cached;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Missing SMTP_USER or SMTP_PASSWORD environment variable");
  }

  const p = port();
  cached = nodemailer.createTransport({
    host: host(),
    port: p,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards
    // produces a connection that hangs rather than a clear error.
    secure: p === 465,
    auth: {
      user,
      // Google shows app passwords as "abcd efgh ijkl mnop". The spaces are
      // display formatting and are rejected if pasted through, so strip them.
      pass: pass.replace(/\s+/g, ""),
    },
  });

  return cached;
}

/** Verify credentials without sending anything. Used by /setup diagnostics. */
export async function verifyEmail(): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "SMTP_USER / SMTP_PASSWORD not set" };
  }
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type CallSummaryEmail = {
  to: string;
  callId: string;
  agentName: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  startedAt: string;
  durationSeconds: number | string;
  disconnectReason: string;
  sentiment: string;
  successful: string;
  summary: string;
  transcript: string;
  recordingUrl: string;
  /** Set when the caller asked for a human. */
  transferOutcome?: string;
};

/**
 * One readable email per finished call.
 *
 * Deliberately plain: the client reads these on a phone, and an HTML table of
 * call metadata is easier to scan there than a wall of prose. The transcript
 * goes last because it's the longest part and usually only read when something
 * went wrong.
 */
export async function sendCallSummaryEmail(input: CallSummaryEmail): Promise<boolean> {
  if (!isEmailConfigured() || !input.to) return false;

  const rows: [string, string][] = [
    ["Direction", input.direction || "—"],
    ["From", input.fromNumber || "—"],
    ["To", input.toNumber || "—"],
    ["Started", input.startedAt || "—"],
    ["Duration", input.durationSeconds === "" ? "—" : `${input.durationSeconds}s`],
    ["Outcome", input.successful || "—"],
    ["Sentiment", input.sentiment || "—"],
    ["Ended because", input.disconnectReason || "—"],
  ];

  if (input.transferOutcome) {
    rows.push(["Human transfer", input.transferOutcome]);
  }

  rows.push(["Agent", input.agentName || "—"], ["Call ID", input.callId || "—"]);

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;white-space:nowrap">${escapeHtml(
          label
        )}</td><td style="padding:4px 0;color:#111827">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  const subjectWho = input.direction === "inbound" ? input.fromNumber : input.toNumber;
  const subject = `${BRAND_NAME} — call summary ${subjectWho || input.callId}`.trim();

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;color:#111827;max-width:640px">
  <h2 style="font-size:17px;margin:0 0 14px">Call summary</h2>

  ${
    input.summary
      ? `<div style="background:#f9fafb;border-left:3px solid #2563eb;padding:12px 14px;margin:0 0 18px;white-space:pre-wrap">${escapeHtml(
          input.summary
        )}</div>`
      : `<p style="color:#6b7280;margin:0 0 18px">No summary was generated for this call.</p>`
  }

  <table style="border-collapse:collapse;margin:0 0 18px">${tableRows}</table>

  ${
    input.recordingUrl
      ? `<p style="margin:0 0 18px"><a href="${encodeURI(
          input.recordingUrl
        )}" style="color:#2563eb">Listen to the recording</a></p>`
      : ""
  }

  ${
    input.transcript
      ? `<details style="margin:0 0 10px">
           <summary style="cursor:pointer;color:#374151;font-weight:600">Full transcript</summary>
           <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#f9fafb;padding:12px;border-radius:6px;margin:10px 0 0">${escapeHtml(
             input.transcript
           )}</pre>
         </details>`
      : ""
  }

  <p style="color:#9ca3af;font-size:12px;margin:18px 0 0">Sent automatically by ${escapeHtml(
    BRAND_NAME
  )}.</p>
</div>`.trim();

  const textParts = [
    "CALL SUMMARY",
    "",
    input.summary || "No summary was generated for this call.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    input.recordingUrl ? `\nRecording: ${input.recordingUrl}` : "",
    input.transcript ? `\n--- TRANSCRIPT ---\n${input.transcript}` : "",
  ];

  try {
    await getTransport().sendMail({
      from: `"${BRAND_NAME}" <${process.env.SMTP_USER}>`,
      // Comma-separated lists work, so one agent can notify several people.
      to: input.to,
      subject,
      text: textParts.filter(Boolean).join("\n"),
      html,
    });
    return true;
  } catch (err) {
    // Never throw from here. This runs inside after(), long past the point
    // where the caller could be told, and a bounced summary must not be
    // allowed to look like a failed call.
    console.error("[email] send failed:", err);
    return false;
  }
}
