import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { isEmailConfigured, verifyEmail } from "@/lib/email";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { isSmsConfigured } from "@/lib/sms";
import { checkAdmin } from "@/lib/auth";
import { appBaseUrl } from "@/lib/retell-agents";
import { TIMEZONE, BRAND_NAME } from "@/lib/config";
import { officeStatus } from "@/lib/hawkins/hours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Status = "pass" | "fail" | "warn";
type Check = { id: string; label: string; status: Status; detail: string; fix?: string };

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Does this table exist and can we read it?
 *
 * A head-only count is the cheapest probe that still proves the table is
 * there and the service_role key can reach it. Postgres error 42P01 is
 * "relation does not exist", which in practice always means a migration
 * hasn't been run.
 */
async function probeTable(table: string): Promise<{ ok: boolean; count: number; error?: string; missing?: boolean }> {
  try {
    const { count, error } = await getSupabase()
      .from(table)
      .select("*", { count: "exact", head: true });

    if (error) {
      return {
        ok: false,
        count: 0,
        // Supabase sometimes returns an empty message with only a code, which
        // reads as a blank failure and tells you nothing.
        error: error.message || error.code || "unknown error",
        missing: error.code === "42P01" || /does not exist/i.test(error.message || ""),
      };
    }
    return { ok: true, count: count ?? 0 };
  } catch (err) {
    return { ok: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: NextRequest) {
  const expected = process.env.SETUP_TOKEN;

  // Two ways in: the setup token, or an ordinary signed-in admin session.
  //
  // The token exists so these checks can be run before anyone has logged in,
  // and it is meant to be deleted once the firm is live. Accepting the admin
  // cookie as well means the checks stay usable afterwards — otherwise the
  // only way to verify SMTP on a live deployment is to re-add a token that
  // the setup guide tells you to remove.
  const signedIn = checkAdmin(req).ok;
  const provided = req.headers.get("x-setup-token") || "";

  if (!signedIn) {
    if (!expected) {
      return NextResponse.json(
        {
          disabled: true,
          message:
            "Diagnostics are switched off. Sign in to the console, or add a SETUP_TOKEN environment variable in Vercel.",
        },
        { status: 404 }
      );
    }

    if (provided !== expected) {
      return NextResponse.json({ message: "Invalid setup token" }, { status: 401 });
    }
  }

  const checks: Check[] = [];

  // ---------------------------------------------------------------- Retell
  const retellKey = process.env.RETELL_API_KEY || "";
  checks.push({
    id: "retell_key",
    label: "Retell API key",
    status: retellKey ? "pass" : "fail",
    detail: retellKey ? mask(retellKey) : "RETELL_API_KEY is not set",
    fix: retellKey
      ? undefined
      : "Retell dashboard → Settings → API Keys. Use the key that has the webhook badge next to it.",
  });

  if (retellKey) {
    // Every tool call and webhook is signed with this key. Retell issues more
    // than one and only one of them signs webhooks — using the wrong one gives
    // a 401 on every single tool call while the agent still talks normally,
    // which is the single most confusing failure mode in this whole app.
    checks.push({
      id: "retell_webhook_key",
      label: "Signing key",
      status: "warn",
      detail: "Can't be verified from here — only a real call proves it",
      fix: "If tool calls return 401 in Retell's call log, this is why. Retell shows a webhook badge beside one key in Settings → API Keys. RETELL_API_KEY must be that one.",
    });
  }

  const base = appBaseUrl();
  const localish = /localhost|127\.0\.0\.1|\.local/i.test(base);
  checks.push({
    id: "app_base_url",
    label: "Public URL",
    status: base && !localish ? "pass" : "fail",
    detail: base || "Not set and no Vercel URL to fall back on",
    fix:
      base && !localish
        ? undefined
        : "Set APP_BASE_URL to this deployment's https URL, redeploy, then press Save on each agent so its tool URLs are rebuilt.",
  });

  // -------------------------------------------------------------- Database
  if (!isSupabaseConfigured()) {
    checks.push({
      id: "supabase",
      label: "Database",
      status: "fail",
      detail: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing",
      fix: "Supabase → Project Settings → Data API for the URL, and API Keys for the service_role key. Use service_role, not anon.",
    });
  } else {
    const required: [string, string][] = [
      ["appointments", "Appointments"],
      ["leads", "Leads"],
      ["log_entries", "Custom logs"],
      ["contacts", "Contacts"],
      ["agent_settings", "Agent settings"],
      ["campaigns", "Campaigns"],
      ["campaign_leads", "Campaign leads"],
      ["dnc_list", "Do-not-call list"],
    ];

    const results = await Promise.all(required.map(([table]) => probeTable(table)));

    const missing = required
      .map(([table], i) => ({ table, result: results[i] }))
      .filter((r) => r.result.missing)
      .map((r) => r.table);

    const broken = required
      .map(([table], i) => ({ table, result: results[i] }))
      .filter((r) => !r.result.ok && !r.result.missing);

    if (missing.length > 0) {
      checks.push({
        id: "supabase_tables",
        label: "Database tables",
        status: "fail",
        detail: `Missing: ${missing.join(", ")}`,
        fix: missing.some((t) => ["appointments", "leads", "log_entries"].includes(t))
          ? "Run supabase-migration-12.sql in the Supabase SQL editor. That's the one that creates the appointments, leads and log_entries tables."
          : "Run database-schema.sql, then every supabase-migration-*.sql in order, in the Supabase SQL editor.",
      });
    } else if (broken.length > 0) {
      checks.push({
        id: "supabase_tables",
        label: "Database tables",
        status: "fail",
        detail: broken.map((b) => `${b.table}: ${b.result.error}`).join(" · "),
        fix: "The tables exist but can't be read. Check you're using the service_role key — the anon key is blocked by row level security.",
      });
    } else {
      const counts = required
        .map(([table, label], i) => `${label}: ${results[i].count}`)
        .join(" · ");
      checks.push({
        id: "supabase_tables",
        label: "Database tables",
        status: "pass",
        detail: counts,
      });
    }

    // Migration 11 added the screening and email columns. Probing for one of
    // them separately tells the client to run 11 rather than leaving them to
    // wonder why saving an agent silently loses the email address.
    const { error: colError } = await getSupabase()
      .from("agent_settings")
      .select("summary_email, screen_agent_id")
      .limit(1);

    checks.push({
      id: "supabase_migration_11",
      label: "Screening + email columns",
      status: colError ? "fail" : "pass",
      detail: colError ? colError.message : "agent_settings is up to date",
      fix: colError
        ? "Run supabase-migration-11.sql in the Supabase SQL editor. Without it, screened transfers and summary email addresses can't be saved."
        : undefined,
    });
  }

  // ---------------------------------------------------------------- Email
  if (!isEmailConfigured()) {
    checks.push({
      id: "email",
      label: "Call summary email",
      status: "fail",
      detail: "No email method is configured",
      fix: "Microsoft 365: set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and SMTP_USER (the sending mailbox) for Microsoft Graph. Gmail: set SMTP_USER and a 16-character App Password as SMTP_PASSWORD.",
    });
  } else {
    const result = await verifyEmail();
    const err = result.error || "";
    const graph = result.method === "graph";

    let fix: string | undefined;
    if (!result.ok) {
      if (graph) {
        fix = /Mail\.Send not granted|no Mail\.Send/i.test(err)
          ? "The app registration exists but can't send yet. In Entra: App registrations → the app → API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Send → Add, then click 'Grant admin consent'. It can take a few minutes to apply."
          : "Check the three values in Vercel against the app registration's Overview page: Directory (tenant) ID → MS_TENANT_ID, Application (client) ID → MS_CLIENT_ID, and the client secret's Value (not its Secret ID) → MS_CLIENT_SECRET. Redeploy after changing them.";
      } else if (/office365|outlook/i.test(process.env.SMTP_HOST || "")) {
        fix = /disabled for the tenant/i.test(err)
          ? "SMTP is switched off for the firm's Microsoft 365 organisation. Rather than turn it on, use Microsoft Graph: set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET from an app registration with the Mail.Send permission."
          : "Microsoft rejected the SMTP sign-in — a wrong password, or MFA / Security Defaults on the account. Microsoft Graph avoids passwords entirely: set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET from an app registration with Mail.Send.";
      } else if (/invalid login|username and password not accepted|535|534/i.test(err)) {
        fix = "Gmail rejected the login. It needs an App Password, not the account password — and App Passwords only appear once 2-Step Verification is on.";
      } else {
        fix = "Check SMTP_HOST and SMTP_PORT. Port 465 needs implicit TLS, 587 needs STARTTLS; the defaults (smtp.gmail.com / 465) are right for Gmail.";
      }
    }

    checks.push({
      id: "email",
      label: "Call summary email",
      status: result.ok ? "pass" : "fail",
      detail: result.detail || err || "Email check failed",
      fix,
    });
  }

  // ------------------------------------------------------------------ SMS
  checks.push({
    id: "sms",
    label: "Text alerts",
    status: isSmsConfigured() ? "pass" : "warn",
    detail: isSmsConfigured()
      ? `Sending from ${process.env.TWILIO_SMS_FROM}`
      : "Not configured — no text alerts will be sent",
    fix: isSmsConfigured()
      ? undefined
      : "Optional. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM if the firm wants a text the moment someone books.",
  });

  // -------------------------------------------------------- Business rules
  // Amy's hours come from lib/hawkins/hours.ts, not the environment, so this
  // reports what she will actually tell a caller.
  const status = await officeStatus();
  checks.push({
    id: "business_hours",
    label: "Opening hours",
    status: "pass",
    detail: `Monday to Friday, 9:30am to 5:30pm, bank holidays closed. Right now: ${
      status.officeOpen ? "open" : `closed (${status.reason})`
    }. Next working day: ${status.nextWorkingDaySpoken}.`,
  });

  checks.push({
    id: "bank_holidays",
    label: "Bank holiday feed",
    status: status.holidaysExpired ? "fail" : status.holidaysStale ? "warn" : "pass",
    detail: status.holidaysExpired
      ? "The GOV.UK feed is unreachable and the fallback list has run out — the office may show as open on a bank holiday"
      : status.holidaysStale
      ? "Using a cached or fallback list; the GOV.UK feed could not be read just now"
      : "Live from gov.uk, england-and-wales",
    fix: status.holidaysExpired
      ? "Update FALLBACK_HOLIDAYS in lib/hawkins/hours.ts and redeploy."
      : undefined,
  });

  const zoneValid = DateTime.now().setZone(TIMEZONE).isValid;
  checks.push({
    id: "timezone",
    label: "Timezone",
    status: zoneValid ? "pass" : "fail",
    detail: zoneValid
      ? `${TIMEZONE} — local time is ${DateTime.now().setZone(TIMEZONE).toFormat("h:mm a")}`
      : `"${TIMEZONE}" is not a valid IANA timezone`,
    fix: zoneValid
      ? undefined
      : "Use an IANA name such as Europe/London or America/New_York, not an abbreviation like GMT or EST.",
  });

  // ------------------------------------------------------------- Branding
  checks.push({
    id: "brand",
    label: "Brand name",
    status: BRAND_NAME ? "pass" : "warn",
    detail: BRAND_NAME || "Not set",
    fix: BRAND_NAME ? undefined : "Set BRAND_NAME — it appears in the sidebar, the login page and every summary email.",
  });

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;

  return NextResponse.json({
    ready: failed === 0,
    failed,
    warned,
    passed: checks.filter((c) => c.status === "pass").length,
    checked_at: DateTime.now().setZone(TIMEZONE).toFormat("yyyy-LL-dd HH:mm:ss ZZZZ"),
    checks,
  });
}
