"use client";

import { useMemo, useState } from "react";
import { C, FONT_SERIF, btn, fld, hint, lbl, pageSub, pageTitle } from "@/lib/ui";

type Status = "pass" | "fail" | "warn";
type Check = { id: string; label: string; status: Status; detail: string; fix?: string };
type Health = {
  ready?: boolean;
  passed?: number;
  failed?: number;
  warned?: number;
  checked_at?: string;
  checks?: Check[];
  message?: string;
  disabled?: boolean;
  write_test_run?: boolean;
};

type Agent = { agent_id: string; agent_name: string };

const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
  "Asia/Dubai",
  "Asia/Karachi",
];

const DAYS: [string, string][] = [
  ["1", "Mon"],
  ["2", "Tue"],
  ["3", "Wed"],
  ["4", "Thu"],
  ["5", "Fri"],
  ["6", "Sat"],
  ["7", "Sun"],
];

/** Monospace only where the content genuinely is code — env vars. */
const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12.5,
};

function Section({
  title,
  blurb,
  first,
  children,
}: {
  title: string;
  blurb?: string;
  /** The page header already draws a rule, so the first section skips its own. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginTop: first ? 28 : 34,
        paddingTop: first ? 0 : 26,
        borderTop: first ? "none" : `1px solid ${C.border}`,
      }}
    >
      <h2 style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
      {blurb && <p style={{ ...hint, margin: "7px 0 18px" }}>{blurb}</p>}
      {children}
    </section>
  );
}

export default function SetupPage() {
  // Nothing here is persisted. It builds the env block for Vercel and nothing
  // more — no secret typed on this page is ever sent to the server.
  const [brand, setBrand] = useState("Hawkins Law");
  const [bizName, setBizName] = useState("Hawkins Law");
  const [tz, setTz] = useState("Europe/London");
  const [openHour, setOpenHour] = useState("9");
  const [closeHour, setCloseHour] = useState("17");
  const [apptMin, setApptMin] = useState("30");
  const [stepMin, setStepMin] = useState("30");
  const [leadMin, setLeadMin] = useState("60");
  const [maxDays, setMaxDays] = useState("60");
  const [maxSlots, setMaxSlots] = useState("3");
  const [days, setDays] = useState<string[]>(["1", "2", "3", "4", "5"]);

  const [smtpUser, setSmtpUser] = useState("");
  const [summaryEmail, setSummaryEmail] = useState("");

  const [token, setToken] = useState("");
  const [writeTest, setWriteTest] = useState(false);
  const [copied, setCopied] = useState(false);

  const [health, setHealth] = useState<Health | null>(null);
  const [running, setRunning] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [toolAgent, setToolAgent] = useState("");
  const [tools, setTools] = useState<Health | null>(null);
  const [toolBusy, setToolBusy] = useState(false);

  const envText = useMemo(() => {
    return [
      "# ---------- Retell ----------",
      "# Settings -> API Keys. Use the key with the WEBHOOK BADGE beside it.",
      "RETELL_API_KEY=key_...",
      "",
      "# ---------- This deployment ----------",
      "APP_BASE_URL=https://your-project.vercel.app",
      `BRAND_NAME=${brand || "Hawkins Law"}`,
      `BUSINESS_NAME=${bizName || brand || "Hawkins Law"}`,
      "",
      "# ---------- Database ----------",
      "# Supabase -> Project Settings -> Data API, and API Keys.",
      "# The service_role key, NOT the anon key.",
      "SUPABASE_URL=https://xxxxxxxx.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...",
      "",
      "# ---------- Call summary email ----------",
      "# Gmail needs an App Password, not the account password.",
      `SMTP_USER=${smtpUser || "client@gmail.com"}`,
      "SMTP_PASSWORD=abcdefghijklmnop",
      summaryEmail ? `SUMMARY_EMAIL=${summaryEmail}` : "# SUMMARY_EMAIL=owner@gmail.com",
      "",
      "# ---------- Access ----------",
      "ADMIN_TOKEN=pick-a-long-random-string",
      "CRON_SECRET=another-long-random-string",
      `SETUP_TOKEN=${token || "a-third-long-random-string"}`,
      "",
      "# ---------- Appointments ----------",
      `BUSINESS_TIMEZONE=${tz}`,
      `BUSINESS_START_HOUR=${openHour}`,
      `BUSINESS_END_HOUR=${closeHour}`,
      `WORKING_DAYS=${days.join(",")}`,
      `APPOINTMENT_MINUTES=${apptMin}`,
      `SLOT_STEP_MINUTES=${stepMin}`,
      `MIN_LEAD_MINUTES=${leadMin}`,
      `MAX_DAYS_AHEAD=${maxDays}`,
      `MAX_SLOTS_RETURNED=${maxSlots}`,
      "",
      "# ---------- Optional: text alerts ----------",
      "# TWILIO_ACCOUNT_SID=AC...",
      "# TWILIO_AUTH_TOKEN=...",
      "# TWILIO_SMS_FROM=+441234567890",
      "# ALERT_NUMBER=+447700000000",
      "",
      "# ---------- Optional: transfer fallback ----------",
      "# TRANSFER_NUMBER=+441234567890",
    ].join("\n");
  }, [
    brand,
    bizName,
    smtpUser,
    summaryEmail,
    token,
    tz,
    openHour,
    closeHour,
    days,
    apptMin,
    stepMin,
    leadMin,
    maxDays,
    maxSlots,
  ]);

  async function copyEnv() {
    await navigator.clipboard.writeText(envText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function loadAgents() {
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      const json = await res.json();
      setAgents(json.agents || []);
      if (!toolAgent && json.agents?.[0]) setToolAgent(json.agents[0].agent_id);
    } catch {
      setAgents([]);
    }
  }

  async function runDiagnostics() {
    setRunning(true);
    setHealth(null);
    try {
      const res = await fetch("/api/health", {
        headers: { "x-setup-token": token },
        cache: "no-store",
      });
      setHealth((await res.json()) as Health);
    } catch {
      setHealth({ message: "Couldn't reach /api/health." });
    } finally {
      setRunning(false);
    }
  }

  async function runToolTest() {
    setToolBusy(true);
    setTools(null);
    try {
      const res = await fetch(
        `/api/test-tools?agent_id=${encodeURIComponent(toolAgent)}${writeTest ? "&write=1" : ""}`,
        { cache: "no-store" }
      );
      setTools((await res.json()) as Health);
    } catch {
      setTools({ message: "Couldn't reach /api/test-tools." });
    } finally {
      setToolBusy(false);
    }
  }

  const statusColour = (s: Status) =>
    s === "pass" ? C.brassText : s === "warn" ? C.dim : C.oxbloodText;

  function Results({ data }: { data: Health }) {
    if (data.disabled || (!data.checks && data.message)) {
      return (
        <div
          style={{
            marginTop: 16,
            borderLeft: `2px solid ${C.oxblood}`,
            paddingLeft: 14,
            color: C.oxbloodText,
            fontSize: 13.5,
          }}
        >
          {data.message}
        </div>
      );
    }

    if (!data.checks) return null;

    return (
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 12 }}>
          {data.passed} passed, {data.failed} failed, {data.warned} to review
          {data.checked_at ? ` — ${data.checked_at}` : ""}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {data.checks.map((check) => (
              <tr key={check.id}>
                <td
                  style={{
                    padding: "11px 14px 11px 12px",
                    borderBottom: `1px solid ${C.hairline}`,
                    borderLeft: `2px solid ${
                      check.status === "pass"
                        ? C.brass
                        : check.status === "warn"
                        ? C.border
                        : C.oxblood
                    }`,
                    verticalAlign: "top",
                    width: 190,
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{check.label}</div>
                  <div style={{ fontSize: 12.5, color: statusColour(check.status), marginTop: 2 }}>
                    {check.status === "pass"
                      ? "Pass"
                      : check.status === "warn"
                      ? "Review"
                      : "Needs fixing"}
                  </div>
                </td>
                <td
                  style={{
                    padding: "11px 0",
                    borderBottom: `1px solid ${C.hairline}`,
                    verticalAlign: "top",
                  }}
                >
                  <div style={{ fontSize: 13.5, color: C.text, wordBreak: "break-word" }}>
                    {check.detail}
                  </div>
                  {check.fix && (
                    <div style={{ fontSize: 13, color: C.dim, marginTop: 5, lineHeight: 1.55 }}>
                      {check.fix}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main style={{ padding: "34px 38px 90px", maxWidth: 860 }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 18 }}>
        <h1 style={pageTitle}>Setup checks</h1>
        <p style={pageSub}>
          Build the environment variables for this deployment, then run the checks to confirm the
          agent can actually book, record and email. Nothing typed on this page is sent anywhere —
          it only assembles text for you to paste into Vercel.
        </p>
      </div>

      <Section
        first
        title="Appointment rules"
        blurb="How the agent decides what to offer a caller. Appointments are kept in this app's own database, so there is no calendar to connect."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px,1fr))",
            gap: 14,
          }}
        >
          <div>
            <span style={lbl}>Firm name</span>
            <input style={fld} value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Name used on records</span>
            <input style={fld} value={bizName} onChange={(e) => setBizName(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Timezone</span>
            <select style={fld} value={tz} onChange={(e) => setTz(e.target.value)}>
              {TIMEZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span style={lbl}>Opens at</span>
            <input style={fld} value={openHour} onChange={(e) => setOpenHour(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Closes at</span>
            <input style={fld} value={closeHour} onChange={(e) => setCloseHour(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Appointment length (min)</span>
            <input style={fld} value={apptMin} onChange={(e) => setApptMin(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Slots start every (min)</span>
            <input style={fld} value={stepMin} onChange={(e) => setStepMin(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Minimum notice (min)</span>
            <input style={fld} value={leadMin} onChange={(e) => setLeadMin(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Book up to (days ahead)</span>
            <input style={fld} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
          </div>
          <div>
            <span style={lbl}>Times to offer per call</span>
            <input style={fld} value={maxSlots} onChange={(e) => setMaxSlots(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <span style={lbl}>Open on</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {DAYS.map(([value, label]) => {
              const on = days.includes(value);
              return (
                <button
                  key={value}
                  onClick={() =>
                    setDays((prev) =>
                      prev.includes(value)
                        ? prev.filter((d) => d !== value)
                        : [...prev, value].sort()
                    )
                  }
                  style={{
                    background: on ? C.oxblood : "transparent",
                    border: `1px solid ${on ? C.oxblood : C.border}`,
                    color: on ? "#FBF7F2" : C.dim,
                    borderRadius: 6,
                    padding: "7px 13px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {days.length === 0 && (
            <p style={{ ...hint, color: C.oxbloodText, marginTop: 9 }}>
              With no days selected the agent can never offer an appointment.
            </p>
          )}
        </div>
      </Section>

      <Section
        title="Call summaries"
        blurb="Summaries go out by email after each call. Gmail requires an App Password, which only appears once 2-Step Verification is switched on — the account password will be rejected."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px,1fr))",
            gap: 14,
          }}
        >
          <div>
            <span style={lbl}>Gmail address that sends</span>
            <input
              style={fld}
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="reception@hawkinslaw.com"
            />
          </div>
          <div>
            <span style={lbl}>Who receives summaries</span>
            <input
              style={fld}
              value={summaryEmail}
              onChange={(e) => setSummaryEmail(e.target.value)}
              placeholder="partner@hawkinslaw.com"
            />
          </div>
        </div>
        <p style={{ ...hint, marginTop: 12 }}>
          The password itself isn&apos;t typed here. Paste it straight into Vercel as
          SMTP_PASSWORD — spaces and all, they&apos;re stripped automatically.
        </p>
      </Section>

      <Section
        title="Environment variables"
        blurb="Paste this into Vercel under Settings → Environment Variables, then redeploy. After the redeploy, press Save on every agent so its tool URLs are rebuilt against the live address."
      >
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={copyEnv} style={btn("primary")}>
            {copied ? "Copied" : "Copy all"}
          </button>
        </div>
        <pre
          style={{
            ...mono,
            background: C.well,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "14px 16px",
            overflowX: "auto",
            color: C.dim,
            lineHeight: 1.65,
            margin: 0,
          }}
        >
          {envText}
        </pre>
      </Section>

      <Section
        title="Run the checks"
        blurb="Confirms the database has every table, the email credentials work, and the opening hours make sense. Needs the SETUP_TOKEN you set in Vercel."
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <span style={lbl}>Setup token</span>
            <input
              style={fld}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="The SETUP_TOKEN value from Vercel"
            />
          </div>
          <button onClick={runDiagnostics} style={btn("primary")} disabled={running || !token}>
            {running ? "Checking" : "Run checks"}
          </button>
        </div>

        {health && <Results data={health} />}
      </Section>

      <Section
        title="Test one agent's tools"
        blurb="Runs the same code the phone agent runs — availability lookup, the booking write, the records tables, and the screening agent if screened transfer is on."
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <span style={lbl}>Agent</span>
            <select
              style={fld}
              value={toolAgent}
              onChange={(e) => setToolAgent(e.target.value)}
              onFocus={loadAgents}
            >
              <option value="">
                {agents.length === 0 ? "Click to load agents" : "Deployment defaults"}
              </option>
              {agents.map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.agent_name}
                </option>
              ))}
            </select>
          </div>
          <button onClick={runToolTest} style={btn("primary")} disabled={toolBusy}>
            {toolBusy ? "Testing" : "Test tools"}
          </button>
        </div>

        <label
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, fontSize: 13.5 }}
        >
          <input
            type="checkbox"
            checked={writeTest}
            onChange={(e) => setWriteTest(e.target.checked)}
          />
          Also book and cancel a test appointment
        </label>
        <p style={{ ...hint, marginTop: 7 }}>
          The test appointment is made 400 days out and cancelled immediately, so it never collides
          with a real one. Worth running once on a new deployment to prove the database accepts
          writes.
        </p>

        {tools && <Results data={tools} />}
      </Section>

      <Section
        title="Before going live"
        blurb="Two things that fail quietly rather than loudly."
      >
        <ul style={{ ...hint, paddingLeft: 20, margin: 0 }}>
          <li style={{ marginBottom: 9 }}>
            Remove SETUP_TOKEN from Vercel. While it is set, this page and its checks are reachable
            by anyone who knows the token.
          </li>
          <li>
            Confirm RETELL_API_KEY is the key with the webhook badge. With the wrong key the agent
            still answers and talks normally, but every booking, record and summary email fails
            silently with a 401 that only shows in Retell&apos;s call log.
          </li>
        </ul>
      </Section>
    </main>
  );
}
