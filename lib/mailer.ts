/**
 * The one place this app sends email from.
 *
 * There used to be two: lib/email.ts for call summaries, and a private copy
 * inside lib/hawkins/messages.ts for Amy's messages and account-readout
 * records. Fixes made to one never reached the other, so the health check
 * (which used the first) could pass while every message Amy took failed.
 * Both now call sendMail() here.
 *
 * Two ways to send, chosen by configuration:
 *
 *   Microsoft Graph, with OAuth (client credentials)
 *     Used when MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET are set.
 *     The app asks Microsoft for a short-lived token and posts the message to
 *     the Graph sendMail API. No mailbox password exists anywhere, it works
 *     with MFA and Security Defaults left on, and it is unaffected by
 *     Microsoft retiring password-based SMTP (end of December 2026).
 *
 *   SMTP
 *     Used otherwise — Gmail with an app password, or any SMTP provider.
 *
 * Nothing is persisted. The token is held in memory until shortly before it
 * expires.
 */

import nodemailer, { Transporter } from "nodemailer";

export type MailInput = {
  /** Display name shown to recipients, e.g. "Hawkins Law reception". */
  fromName: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
};

export type MailMethod = "graph" | "smtp" | "none";

const GRAPH = "https://graph.microsoft.com/v1.0";

function graphCreds(): { tenant: string; clientId: string; secret: string } | null {
  const tenant = (process.env.MS_TENANT_ID || "").trim();
  const clientId = (process.env.MS_CLIENT_ID || "").trim();
  const secret = (process.env.MS_CLIENT_SECRET || "").trim();
  return tenant && clientId && secret ? { tenant, clientId, secret } : null;
}

/** The mailbox messages are sent from. */
export function senderAddress(): string {
  return (process.env.MAIL_FROM || process.env.SMTP_USER || "").trim();
}

export function mailMethod(): MailMethod {
  if (graphCreds() && senderAddress()) return "graph";
  if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) return "smtp";
  return "none";
}

export function isMailConfigured(): boolean {
  return mailMethod() !== "none";
}

// --------------------------------------------------------------------- Graph

let token: { value: string; expiresAt: number } | null = null;

/**
 * Microsoft's sign-in errors are numbered (AADSTS…) and read like stack
 * traces. Translate the ones a firm's admin is actually likely to hit.
 */
function explainTokenError(raw: string): string {
  if (/AADSTS7000215|invalid_client.*secret|Invalid client secret/i.test(raw)) {
    return "Microsoft rejected the client secret. Copy the secret's *Value*, not its Secret ID, and check it hasn't expired.";
  }
  if (/AADSTS700016|application.*was not found/i.test(raw)) {
    return "Microsoft doesn't recognise MS_CLIENT_ID in this tenant. Use the Application (client) ID from the app registration's Overview page.";
  }
  if (/AADSTS90002|AADSTS900023|tenant.*not found|invalid tenant/i.test(raw)) {
    return "MS_TENANT_ID isn't a valid tenant. Use the Directory (tenant) ID from the app registration's Overview page.";
  }
  return raw;
}

async function graphToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;

  const creds = graphCreds();
  if (!creds) throw new Error("MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET are not all set");

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(creds.tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.secret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    }
  );

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    const raw = json.error_description || json.error || `token request failed (${res.status})`;
    throw new Error(explainTokenError(raw));
  }

  // Refresh a minute early so a send never races an expiring token.
  token = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(60, (json.expires_in || 3600) - 60) * 1000,
  };
  return token.value;
}

/** The application permissions Microsoft granted, read from the token itself. */
function grantedRoles(accessToken: string): string[] {
  try {
    const payload = accessToken.split(".")[1] || "";
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      roles?: string[];
    };
    return Array.isArray(json.roles) ? json.roles : [];
  } catch {
    return [];
  }
}

function explainGraphError(status: number, code: string, message: string): string {
  if (code === "ErrorAccessDenied" || status === 403) {
    return (
      "Microsoft Graph refused to send (access denied). Either admin consent for Mail.Send " +
      "hasn't been granted, or the app is scoped to a different mailbox than " +
      senderAddress() +
      "."
    );
  }
  if (code === "ResourceNotFound" || code === "ErrorInvalidUser" || status === 404) {
    return `Microsoft Graph can't find the mailbox ${senderAddress()}. Check MAIL_FROM / SMTP_USER is a real mailbox in this tenant.`;
  }
  if (code === "MailboxNotEnabledForRESTAPI") {
    return `${senderAddress()} isn't an Exchange Online mailbox (it may be on-premises or unlicensed).`;
  }
  return `${code || `HTTP ${status}`}: ${message}`;
}

async function sendViaGraph(input: MailInput): Promise<void> {
  const accessToken = await graphToken();
  const from = senderAddress();
  const people = (list: string[] = []) =>
    list.filter(Boolean).map((address) => ({ emailAddress: { address } }));

  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: input.html
          ? { contentType: "HTML", content: input.html }
          : { contentType: "Text", content: input.text },
        toRecipients: people(input.to),
        ccRecipients: people(input.cc),
        from: { emailAddress: { address: from, name: input.fromName } },
      },
      // Keeps a copy in reception@'s Sent Items — a paper trail the firm can
      // search without opening this console.
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  // Graph answers 202 Accepted with an empty body on success.
  if (res.status === 202 || res.ok) return;

  const json = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  throw new Error(explainGraphError(res.status, json.error?.code || "", json.error?.message || ""));
}

// ---------------------------------------------------------------------- SMTP

let smtp: Transporter | null = null;

function smtpHost(): string {
  return process.env.SMTP_HOST || "smtp.gmail.com";
}

function smtpTransport(): Transporter {
  if (smtp) return smtp;

  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASSWORD || "";
  if (!user || !pass) throw new Error("SMTP_USER / SMTP_PASSWORD not set");

  const parsed = Number(process.env.SMTP_PORT);
  const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 465;

  smtp = nodemailer.createTransport({
    host: smtpHost(),
    port,
    // 465 is implicit TLS; 587 and 25 upgrade with STARTTLS, which is then
    // required so the password can never travel unencrypted.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: {
      user,
      // Gmail shows app passwords as "abcd efgh ijkl mnop" and rejects the
      // spaces, so strip them for Gmail only. Any other provider's password
      // may legitimately contain spaces; trim only stray ends from pasting.
      pass: /gmail\.com$/i.test(smtpHost()) ? pass.replace(/\s+/g, "") : pass.trim(),
    },
  });
  return smtp;
}

// -------------------------------------------------------------------- public

export async function sendMail(input: MailInput): Promise<void> {
  const to = input.to.filter(Boolean);
  if (to.length === 0) throw new Error("No recipients");

  const method = mailMethod();
  if (method === "graph") return sendViaGraph({ ...input, to });

  if (method === "smtp") {
    await smtpTransport().sendMail({
      from: `"${input.fromName.replace(/"/g, "")}" <${senderAddress()}>`,
      to: to.join(", "),
      cc: input.cc && input.cc.length > 0 ? input.cc.join(", ") : undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return;
  }

  throw new Error("Email is not configured");
}

export type VerifyResult = {
  ok: boolean;
  method: MailMethod;
  detail: string;
  error?: string;
};

/**
 * Prove the credentials work without sending anything.
 *
 * For Graph that means obtaining a token *and* confirming Microsoft put
 * Mail.Send in it — a token without that role is the classic half-finished
 * setup where admin consent was never clicked, and every send would fail.
 */
export async function verifyMail(): Promise<VerifyResult> {
  const method = mailMethod();
  const sender = senderAddress();

  if (method === "none") {
    return { ok: false, method, detail: "Not configured", error: "No email method is configured" };
  }

  if (method === "graph") {
    try {
      const roles = grantedRoles(await graphToken());
      if (!roles.includes("Mail.Send")) {
        return {
          ok: false,
          method,
          detail: `Signed in to Microsoft, but the token has no Mail.Send permission (has: ${
            roles.join(", ") || "none"
          })`,
          error: "Mail.Send not granted",
        };
      }
      return { ok: true, method, detail: `Microsoft Graph (OAuth), sending as ${sender}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, method, detail: message, error: message };
    }
  }

  try {
    await smtpTransport().verify();
    return { ok: true, method, detail: `SMTP, signed in as ${sender}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      method,
      detail: `${message} — signing in as ${sender || "(SMTP_USER empty)"} via ${smtpHost()}:${
        process.env.SMTP_PORT || "465"
      }`,
      error: message,
    };
  }
}
