import { NextRequest, NextResponse } from "next/server";
import { DateTime } from "luxon";
import { checkAdmin } from "@/lib/auth";
import { getAgentSettings } from "@/lib/agent-settings";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { appBaseUrl } from "@/lib/retell-agents";
import { getRetell } from "@/lib/retell-client";
import { isSmsConfigured } from "@/lib/sms";
import { isEmailConfigured } from "@/lib/email";
import { STAFF, GENERAL_EMAIL } from "@/lib/hawkins/firm";
import { amyAgentIds } from "@/lib/hawkins/agent";
import { createAppointment, cancelAppointment, getBusyIntervals } from "@/lib/appointments";
import { businessWindow, generateOpenSlots, now as businessNow } from "@/lib/slots";
import { VERIFY_SIGNATURE, TIMEZONE, APPOINTMENT_MINUTES } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Check = { id: string; label: string; status: "pass" | "fail" | "warn"; detail: string; fix?: string };

function errText(err: unknown): string {
  const e = err as { code?: number; status?: number; message?: string };
  const code = e?.code ?? e?.status;
  const msg = e?.message || String(err);
  return code ? `${code}: ${msg}` : msg;
}

/**
 * Runs the exact code paths the voice endpoints use, for one specific agent.
 *
 * The point is to separate "the agent never called the tool" from "the tool
 * ran and something refused it" — the caller hears the same apology either
 * way, so guessing from the transcript is hopeless.
 */
export async function GET(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const agentId = req.nextUrl.searchParams.get("agent_id") || "";
  const runWrite = req.nextUrl.searchParams.get("write") === "1";
  const checks: Check[] = [];

  const settings = await getAgentSettings(agentId);

  /**
   * Is this Amy?
   *
   * Amy's staff, routing, transfer behaviour and message recipients all live
   * in lib/hawkins/*, not in the agent_settings table — deliberately, so a
   * law firm's routing can't be changed by whoever can reach the console.
   *
   * The per-agent checks below read agent_settings, so without this they
   * report a confident FAIL on a perfectly healthy Amy ("screening is on but
   * no transfer number is set") purely because she has no row. A diagnostic
   * that cries wolf on the production agent is worse than no diagnostic.
   */
  const isAmy = (await amyAgentIds()).includes(agentId);

  // ------------------------------------------------------- what's configured
  checks.push({
    id: "resolved",
    label: "Resolved settings",
    status: "pass",
    detail: isAmy
      ? `Amy — configured in code (lib/hawkins). Staff: ${STAFF.length}. Timezone: Europe/London.`
      : [
          `timezone: ${settings.timezone}`,
          `transfer: ${settings.transferMode}${settings.transferNumber ? ` → ${settings.transferNumber}` : " (no number)"}`,
          `summary email: ${settings.summaryEmail || "(none)"}`,
          `custom logs: ${settings.customLogs.map((l) => l.label).join(", ") || "(none)"}`,
        ].join(" · "),
  });

  const base = appBaseUrl();
  checks.push({
    id: "base_url",
    label: "Tool URLs",
    status: base ? "pass" : "fail",
    detail: base ? `${base}/api/retell/…` : "No APP_BASE_URL and no Vercel URL",
    fix: base
      ? undefined
      : "Set APP_BASE_URL, redeploy, then press Save on this agent so its tools are rebuilt with the right host.",
  });

  checks.push({
    id: "signature",
    label: "Signature checking",
    status: VERIFY_SIGNATURE ? "pass" : "warn",
    detail: VERIFY_SIGNATURE ? "On" : "OFF — RETELL_VERIFY_SIGNATURE is set to false",
    fix: VERIFY_SIGNATURE
      ? undefined
      : "Fine while testing with curl. Remove RETELL_VERIFY_SIGNATURE before this goes live, or anyone who finds these URLs can write to the database.",
  });

  // ------------------------------------------------------------- the diary
  if (!isSupabaseConfigured()) {
    checks.push({
      id: "diary",
      label: "Diary",
      status: "fail",
      detail: "Supabase is not configured, so nothing can be booked or saved",
      fix: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    });
  } else {
    // Read path: exactly what check_availability does.
    try {
      const today = businessNow().toISODate();
      const window = today ? businessWindow(today) : null;

      if (!window) {
        checks.push({
          id: "availability",
          label: "Availability lookup",
          status: "fail",
          detail: "Couldn't build today's business window",
          fix: "Check BUSINESS_START_HOUR, BUSINESS_END_HOUR and BUSINESS_TIMEZONE.",
        });
      } else {
        const busy = await getBusyIntervals(window.start, window.end);
        const open = generateOpenSlots(window, busy);
        checks.push({
          id: "availability",
          label: "Availability lookup",
          status: "pass",
          detail: `${open.length} slot(s) open today, ${busy.length} already booked`,
        });
      }
    } catch (err) {
      checks.push({
        id: "availability",
        label: "Availability lookup",
        status: "fail",
        detail: errText(err),
        fix: "Run supabase-migration-12.sql — this reads the appointments table.",
      });
    }

    // Write path: book a real appointment far in the future, then cancel it.
    // Only on demand, because it briefly occupies a slot.
    if (runWrite) {
      const probeStart = businessNow().plus({ days: 400 }).set({ hour: 3, minute: 0, second: 0, millisecond: 0 });
      const probeCallId = `selftest-${Date.now()}`;

      try {
        const result = await createAppointment({
          callId: probeCallId,
          agentId: agentId || "selftest",
          name: "Setup self-test",
          phone: "",
          email: "",
          service: "Automated check — safe to ignore",
          notes: "Created and removed by /setup diagnostics",
          start: probeStart,
          end: probeStart.plus({ minutes: APPOINTMENT_MINUTES }),
        });

        if (result.ok) {
          await cancelAppointment(result.id);
          checks.push({
            id: "diary_write",
            label: "Booking write test",
            status: "pass",
            detail: "Booked a test appointment 400 days out and cancelled it again",
          });
        } else {
          checks.push({
            id: "diary_write",
            label: "Booking write test",
            status: "fail",
            detail: `${result.reason}${result.detail ? `: ${result.detail}` : ""}`,
            fix: "Check the service_role key is in SUPABASE_SERVICE_ROLE_KEY — the anon key can read nothing and write nothing here.",
          });
        }
      } catch (err) {
        checks.push({
          id: "diary_write",
          label: "Booking write test",
          status: "fail",
          detail: errText(err),
          fix: "Run supabase-migration-12.sql if the appointments table is missing.",
        });
      }
    }

    // Tables the tools write to.
    for (const [table, label] of [
      ["leads", "Leads table"],
      ["log_entries", "Custom log table"],
      ["contacts", "Contacts table"],
    ] as [string, string][]) {
      const { error, count } = await getSupabase()
        .from(table)
        .select("*", { count: "exact", head: true });

      checks.push({
        id: `db_${table}`,
        label,
        status: error ? "fail" : "pass",
        detail: error ? error.message : `${count ?? 0} row(s)`,
        fix: error ? "Run supabase-migration-12.sql in the Supabase SQL editor." : undefined,
      });
    }
  }

  // --------------------------------------------------------- screened transfer
  if (isAmy) {
    // Amy's six transfer tools and her screening agent are what matter, not
    // a transfer_number column she never reads.
    try {
      const agent = (await getRetell().agent.retrieve(agentId)) as unknown as Record<string, unknown>;
      const engine = (agent.response_engine || {}) as Record<string, unknown>;
      const llmId = String(engine.llm_id ?? "");
      const llm = llmId
        ? ((await getRetell().llm.retrieve(llmId)) as unknown as Record<string, unknown>)
        : {};
      const tools = Array.isArray(llm.general_tools) ? llm.general_tools : [];
      const names = tools.map((t) => String((t as Record<string, unknown>).name ?? ""));

      const expected = [
        "note_caller_details",
        ...STAFF.map((st) => `transfer_to_${st.id}`),
        "send_message",
        "get_client_account_details",
        "end_call",
      ];
      const missing = expected.filter((n) => !names.includes(n));

      checks.push({
        id: "amy_tools",
        label: "Amy's tools",
        status: missing.length === 0 ? "pass" : "fail",
        detail:
          missing.length === 0
            ? `All ${expected.length} present`
            : `Missing: ${missing.join(", ")}`,
        fix:
          missing.length === 0
            ? undefined
            : "POST /api/hawkins/provision with this agent_id to rebuild the tool set.",
      });

      // The keypress guard. Without a transfer agent behind the transfer
      // tools, a call can be bridged into voicemail — which Section 7 of the
      // specification exists to prevent.
      const transferTool = tools.find((t) =>
        String((t as Record<string, unknown>).name ?? "").startsWith("transfer_to_")
      ) as Record<string, unknown> | undefined;
      const option = (transferTool?.transfer_option || {}) as Record<string, unknown>;
      const agentic = String(option.type ?? "") === "agentic_warm_transfer";

      checks.push({
        id: "screen",
        label: "Whisper and keypress",
        status: agentic ? "pass" : "fail",
        detail: agentic
          ? "Transfers screen the staff member and require a keypress before bridging"
          : `Transfers are "${String(option.type ?? "not set")}" — no keypress guard, so a call could be bridged into voicemail`,
        fix: agentic
          ? undefined
          : "Re-run POST /api/hawkins/provision. If the screening agent still fails to build, check the logs for [hawkins].",
      });
    } catch (err) {
      checks.push({
        id: "amy_tools",
        label: "Amy's tools",
        status: "fail",
        detail: errText(err),
        fix: "Check RETELL_API_KEY and that the agent id is right.",
      });
    }
  } else if (settings.transferMode === "screen") {
    if (!settings.transferNumber) {
      checks.push({
        id: "screen",
        label: "Screened transfer",
        status: "fail",
        detail: "Screening is on but no transfer number is set",
        fix: "Add the number to ring on this agent's settings, then press Save.",
      });
    } else if (!settings.screenAgentId) {
      checks.push({
        id: "screen",
        label: "Screened transfer",
        status: "fail",
        detail: "No screening agent has been created",
        fix: "Press Save on this agent. That's what creates the screener in Retell. If it still doesn't appear, check the server logs for [screening].",
      });
    } else {
      try {
        const screener = (await getRetell().agent.retrieve(settings.screenAgentId)) as unknown as Record<
          string,
          unknown
        >;
        checks.push({
          id: "screen",
          label: "Screened transfer",
          status: "pass",
          detail: `"${String(screener.agent_name ?? settings.screenAgentId)}" will ring ${settings.transferNumber} and ask`,
        });
      } catch (err) {
        checks.push({
          id: "screen",
          label: "Screened transfer",
          status: "fail",
          detail: `Screening agent ${settings.screenAgentId} can't be read: ${errText(err)}`,
          fix: "It was probably deleted in the Retell dashboard. Press Save on this agent to rebuild it.",
        });
      }
    }
  }

  // ------------------------------------------------------------- notifications
  checks.push({
    id: "email_target",
    label: isAmy ? "Message email" : "Summary email",
    status: isAmy
      ? isEmailConfigured()
        ? "pass"
        : "fail"
      : settings.summaryEmail && isEmailConfigured()
      ? "pass"
      : "warn",
    detail: !isEmailConfigured()
      ? isAmy
        ? "SMTP is not configured — every message Amy takes would fail to reach anyone"
        : "SMTP is not configured — no summaries will be sent"
      : isAmy
      ? `Messages route to the staff in lib/hawkins/firm.ts, cc ${GENERAL_EMAIL}`
      : settings.summaryEmail
      ? `${settings.summaryEmail} · ${settings.emailEveryCall ? "every call" : settings.emailOnTransfer ? "transfers only" : "nothing selected"}`
      : "No recipient set for this agent",
    fix: !isEmailConfigured()
      ? "Set SMTP_USER and SMTP_PASSWORD, then redeploy."
      : settings.summaryEmail
      ? undefined
      : "Add an address under Email call summaries on this agent.",
  });

  if (!isAmy) checks.push({
    id: "sms",
    label: "Text alerts",
    status: isSmsConfigured() && settings.alertNumber ? "pass" : "warn",
    detail: isSmsConfigured()
      ? `From ${process.env.TWILIO_SMS_FROM} to ${settings.alertNumber || "(no recipient set)"}`
      : "Twilio SMS is not configured",
    fix:
      isSmsConfigured() && settings.alertNumber
        ? undefined
        : "Optional. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM and an alert number on the agent.",
  });

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;

  return NextResponse.json({
    agent_id: agentId,
    ready: failed === 0,
    failed,
    warned,
    passed: checks.filter((c) => c.status === "pass").length,
    write_test_run: runWrite,
    checked_at: DateTime.now().setZone(TIMEZONE).toFormat("yyyy-LL-dd HH:mm:ss ZZZZ"),
    checks,
  });
}
