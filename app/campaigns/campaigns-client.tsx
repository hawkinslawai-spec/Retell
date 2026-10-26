"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { C, FONT_SERIF, numeric, pageSub, pageTitle } from "@/lib/ui";

type Stats = {
  total: number;
  pending: number;
  queued: number;
  answered: number;
  no_answer: number;
  failed: number;
  suppressed: number;
};

type Campaign = {
  id: string;
  name: string;
  from_number: string;
  agent_label: string | null;
  status: "draft" | "active" | "paused" | "completed";
  timezone: string;
  window_start_min: number;
  window_end_min: number;
  call_days: string[];
  batch_size: number;
  max_attempts: number;
  retry_after_minutes: number;
  daily_cap: number;
  start_date: string | null;
  end_date: string | null;
  auto_sync_leads: boolean;
  stats: Stats;
};

type RetellNumber = { phone_number: string; nickname: string; outbound_agent_id: string };


const panel: React.CSSProperties = {
  background: C.slate,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: "22px 24px",
};

const fld: React.CSSProperties = {
  width: "100%",
  background: C.well,
  border: `1px solid ${C.border}`,
  borderRadius: 9,
  color: C.text,
  padding: "10px 12px",
  fontSize: 14,
  boxSizing: "border-box",
};

const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, color: C.dim, marginBottom: 6 };

const btn = (kind: "primary" | "ghost" | "danger" = "ghost"): React.CSSProperties => ({
  background: kind === "primary" ? "linear-gradient(135deg,#4d7fe0,#8b5fd6)" : "transparent",
  border: kind === "primary" ? "none" : `1px solid ${C.border}`,
  color: kind === "primary" ? "#fff" : kind === "danger" ? C.red : C.text,
  borderRadius: 10,
  padding: "11px 20px",
  fontSize: 14,
  fontWeight: kind === "primary" ? 500 : 400,
  cursor: "pointer",
});

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
  "Australia/Adelaide",
  "Asia/Dubai",
  "Asia/Karachi",
];

function hhmm(v: number) {
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

function localTimeIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return "";
  }
}

const BLANK = {
  name: "",
  from_number: "",
  timezone: "America/New_York",
  window_start_min: 540,
  window_end_min: 1020,
  call_days: DAYS.slice(0, 5),
  batch_size: 25,
  max_attempts: 3,
  retry_after_minutes: 240,
  daily_cap: 200,
  start_date: "",
  end_date: "",
  auto_sync_leads: false,
};

export default function CampaignsClient() {
  const [authed, setAuthed] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [numbers, setNumbers] = useState<RetellNumber[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteBad, setNoteBad] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [fileName, setFileName] = useState("");
  const [testNumber, setTestNumber] = useState("");
  const [testName, setTestName] = useState("");
  const [testAgent, setTestAgent] = useState("");
  const [agents, setAgents] = useState<{ agent_id: string; agent_name: string }[]>([]);
  const [dialing, setDialing] = useState(false);

  async function testCall() {
    setDialing(true);
    setNote("");
    try {
      const json = await api("/api/test-call", {
        method: "POST",
        body: JSON.stringify({
          from_number: form.from_number,
          to_number: testNumber,
          agent_id: testAgent,
          name: testName,
          country_code: "44",
        }),
      });
      flash(`Calling ${json.to_number} now — it should ring within a few seconds.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Test call failed", true);
    } finally {
      setDialing(false);
    }
  }

  /** Parse a CSV or Excel file in the browser, then post plain rows. */
  async function importFile(file: File) {
    if (!active) return;
    setBusy(true);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const pick = (row: Record<string, unknown>, ...names: string[]) => {
        for (const key of Object.keys(row)) {
          const k = key.toLowerCase().trim();
          if (names.some((n) => k.includes(n))) return String(row[key] ?? "").trim();
        }
        return "";
      };

      const rows = raw
        .map((r) => ({
          phone: pick(r, "phone", "mobile", "number", "tel") || String(Object.values(r)[0] ?? "").trim(),
          name: pick(r, "name", "contact", "business", "company"),
          email: pick(r, "email", "e-mail"),
          interest: pick(r, "interest", "note", "service", "reason"),
        }))
        .filter((r) => r.phone);

      if (rows.length === 0) {
        flash("No phone numbers found in that file. Check there's a column header like 'phone'.", true);
        return;
      }

      await importLeads({ rows, country_code: "44" });
    } catch (err) {
      flash(err instanceof Error ? err.message : "Couldn't read that file", true);
    } finally {
      setBusy(false);
    }
  }

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);
      return json;
    },
    []
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const json = await api("/api/campaigns");
      const list: Campaign[] = json.campaigns || [];
      setCampaigns(list);
      setAuthed(true);
      setActiveId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null));
      try {
        const nums = await api("/api/phone-numbers");
        setNumbers(nums.numbers || []);
        setAgents(nums.agents || []);
      } catch {
        setNumbers([]);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Failed to load");
      setNoteBad(true);
      setAuthed(false);
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!authed) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [authed, load]);

  const active = useMemo(
    () => campaigns.find((c) => c.id === activeId) || null,
    [campaigns, activeId]
  );

  useEffect(() => {
    if (creating) {
      setForm({ ...BLANK, from_number: numbers[0]?.phone_number || "" });
    } else if (active) {
      setForm({
        name: active.name,
        from_number: active.from_number,
        timezone: active.timezone,
        window_start_min: active.window_start_min,
        window_end_min: active.window_end_min,
        call_days: active.call_days,
        batch_size: active.batch_size,
        max_attempts: active.max_attempts,
        retry_after_minutes: active.retry_after_minutes,
        daily_cap: active.daily_cap,
        start_date: active.start_date || "",
        end_date: active.end_date || "",
        auto_sync_leads: active.auto_sync_leads,
      });
    }
  }, [creating, active, numbers]);

  function set<K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function flash(msg: string, bad = false) {
    setNote(msg);
    setNoteBad(bad);
  }

  async function save() {
    setBusy(true);
    try {
      const body = {
        ...form,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        agent_label:
          numbers.find((n) => n.phone_number === form.from_number)?.nickname || null,
      };
      if (creating) {
        const json = await api("/api/campaigns", { method: "POST", body: JSON.stringify(body) });
        setCreating(false);
        setActiveId(json.campaign?.id ?? null);
        flash("Campaign created. Add contacts before starting.");
      } else if (active) {
        await api(`/api/campaigns/${active.id}`, { method: "PATCH", body: JSON.stringify(body) });
        flash("Settings saved.");
      }
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", true);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    if (!active) return;
    setBusy(true);
    try {
      const json = await api(`/api/campaigns/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const t = json.first_tick;
      if (t) {
        flash(
          t.error
            ? `Started, but the first batch failed: ${t.error}`
            : t.skipped
              ? `Started — waiting: ${t.skipped}`
              : `Started — ${t.queued} calls queued${t.suppressed ? `, ${t.suppressed} on DNC` : ""}`,
          Boolean(t.error)
        );
      } else {
        flash(status === "paused" ? "Paused. Batches already sent to Retell will still dial." : "Updated.");
      }
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Update failed", true);
    } finally {
      setBusy(false);
    }
  }

  async function importLeads(payload: Record<string, unknown>) {
    if (!active) return;
    setBusy(true);
    try {
      const json = await api(`/api/campaigns/${active.id}/leads`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      flash(
        `Imported ${json.imported}` +
          (json.skipped_existing ? `, ${json.skipped_existing} already here` : "") +
          (json.invalid ? `, ${json.invalid} invalid skipped` : "")
      );
      setImportText("");
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Import failed", true);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!active) return;
    setBusy(true);
    try {
      await api(`/api/campaigns/${active.id}`, { method: "DELETE" });
      setActiveId(null);
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", true);
    } finally {
      setBusy(false);
    }
  }

  const selectedNumber = numbers.find((n) => n.phone_number === form.from_number);
  const windowBad = form.window_end_min <= form.window_start_min;

  return (
    <main style={{ maxWidth: 1000, padding: "40px 32px 80px" }}>
      <h1 style={pageTitle}>
        Outbound Calls
      </h1>
      <p style={{ color: C.dim, marginTop: 0, fontSize: 14.5, lineHeight: 1.6 }}>
        Run as many campaigns as you like &mdash; each with its own contact list, number, schedule
        and limits.
      </p>

      {/* campaign tabs */}
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "26px 0 20px" }}>
        {campaigns.map((c) => {
          const on = c.id === activeId && !creating;
          const left = c.stats.pending + c.stats.queued;
          return (
            <button
              key={c.id}
              onClick={() => {
                setActiveId(c.id);
                setCreating(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                background: on ? "linear-gradient(135deg,#4d7fe0,#8b5fd6)" : C.slate,
                border: on ? "none" : `1px solid ${C.border}`,
                color: on ? "#fff" : C.dim,
                borderRadius: 11,
                padding: "10px 17px",
                fontSize: 14,
                fontWeight: on ? 500 : 400,
                cursor: "pointer",
              }}
            >
              {c.status === "active" ? (
                <span
                  style={{ width: 7, height: 7, borderRadius: 99, background: C.green }}
                />
              ) : null}
              {c.name}
              <span style={{ opacity: 0.62, fontSize: 13 }}>{left}</span>
            </button>
          );
        })}
        <button
          onClick={() => setCreating(true)}
          style={{
            background: "transparent",
            border: `1px dashed ${C.border}`,
            color: creating ? C.brassText : C.dim,
            borderRadius: 11,
            padding: "10px 17px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          + New campaign
        </button>
      </div>

      {note ? (
        <div
          style={{
            border: `1px solid ${noteBad ? C.red : C.green}`,
            background: C.slate,
            borderRadius: 11,
            padding: "12px 16px",
            marginBottom: 18,
          }}
        >
          <span style={{ fontSize: 13.5, color: noteBad ? C.red : C.green }}>{note}</span>
        </div>
      ) : null}

      {!active && !creating ? (
        <p style={{ color: C.faint, fontSize: 14 }}>No campaigns yet — create one to get started.</p>
      ) : null}

      {active || creating ? (
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
            <input
              style={{ ...fld, fontSize: 16, fontWeight: 500 }}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Campaign name"
            />
            {!creating ? (
              <button style={{ ...btn("danger"), whiteSpace: "nowrap" }} onClick={remove} disabled={busy}>
                Delete
              </button>
            ) : null}
          </div>
          <p style={{ color: C.faint, fontSize: 13, margin: "0 0 22px", lineHeight: 1.6 }}>
            Runs on Retell&apos;s servers — start it, close the tab, and calling continues within
            your window.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 18,
            }}
          >
            <div>
              <span style={lbl}>Calls from</span>
              {numbers.length > 0 ? (
                <select
                  style={fld}
                  value={form.from_number}
                  onChange={(e) => set("from_number", e.target.value)}
                >
                  <option value="">Select a number</option>
                  {numbers.map((n) => (
                    <option key={n.phone_number} value={n.phone_number}>
                      {n.nickname ? `${n.nickname} (${n.phone_number})` : n.phone_number}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  style={fld}
                  value={form.from_number}
                  onChange={(e) => set("from_number", e.target.value)}
                  placeholder="+14157774444"
                />
              )}
              {selectedNumber && !selectedNumber.outbound_agent_id ? (
                <p style={{ fontSize: 12, color: C.oxbloodText, margin: "7px 0 0", lineHeight: 1.5 }}>
                  No outbound agent bound to this number — calls will fail.
                </p>
              ) : null}
            </div>

            <div>
              <span style={lbl}>Calls per batch</span>
              <input
                style={fld}
                type="number"
                min={1}
                max={500}
                value={form.batch_size}
                onChange={(e) => set("batch_size", Number(e.target.value))}
              />
            </div>

            <div>
              <span style={lbl}>Max calls per day</span>
              <input
                style={fld}
                type="number"
                min={1}
                max={5000}
                value={form.daily_cap}
                onChange={(e) => set("daily_cap", Number(e.target.value))}
              />
            </div>

            <div>
              <span style={lbl}>Start date (optional)</span>
              <input
                style={fld}
                type="date"
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
              />
            </div>

            <div>
              <span style={lbl}>End date (optional)</span>
              <input
                style={fld}
                type="date"
                value={form.end_date}
                onChange={(e) => set("end_date", e.target.value)}
              />
            </div>

            <div>
              <span style={lbl}>Max attempts per contact</span>
              <input
                style={fld}
                type="number"
                min={1}
                max={6}
                value={form.max_attempts}
                onChange={(e) => set("max_attempts", Number(e.target.value))}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              marginTop: 22,
            }}
          >
            <span style={{ fontSize: 14, color: C.text }}>Only call between</span>
            <input
              style={{ ...fld, width: 96 }}
              type="number"
              min={0}
              max={23}
              value={Math.floor(form.window_start_min / 60)}
              onChange={(e) => set("window_start_min", Number(e.target.value) * 60)}
            />
            <span style={{ fontSize: 14, color: C.dim }}>to</span>
            <input
              style={{ ...fld, width: 96 }}
              type="number"
              min={1}
              max={24}
              value={Math.floor(form.window_end_min / 60)}
              onChange={(e) => set("window_end_min", Number(e.target.value) * 60)}
            />
            <span style={{ fontSize: 13, color: C.faint }}>(24-hour)</span>
          </div>

          <div style={{ marginTop: 18, maxWidth: 420 }}>
            <span style={lbl}>Timezone of the people you&apos;re calling</span>
            <select style={fld} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 12.5, color: C.faint, margin: "8px 0 0", lineHeight: 1.6 }}>
              Calls only go out between {hhmm(form.window_start_min)} and {hhmm(form.window_end_min)}{" "}
              <span style={{ color: C.dim }}>local time for them</span> — currently{" "}
              {localTimeIn(form.timezone)} there.
            </p>
            {windowBad ? (
              <p style={{ fontSize: 12.5, color: C.red, margin: "7px 0 0" }}>
                The window must end after it starts — Retell rejects cross-midnight windows.
              </p>
            ) : null}
          </div>

          <div style={{ marginTop: 20 }}>
            <span style={lbl}>Calling days</span>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {DAYS.map((d) => {
                const on = form.call_days.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() =>
                      set(
                        "call_days",
                        on ? form.call_days.filter((x) => x !== d) : [...form.call_days, d]
                      )
                    }
                    style={{
                      background: on ? "#1b2b45" : "transparent",
                      border: `1px solid ${on ? "#2d4468" : C.border}`,
                      color: on ? C.brassText : C.dim,
                      borderRadius: 9,
                      padding: "7px 14px",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {d.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 22,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.auto_sync_leads}
              onChange={(e) => set("auto_sync_leads", e.target.checked)}
            />
            Automatically call new enquiries as they come in
          </label>

          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 26,
              paddingTop: 22,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            {!creating && active ? (
              active.status === "active" ? (
                <button style={btn()} onClick={() => setStatus("paused")} disabled={busy}>
                  Pause campaign
                </button>
              ) : (
                <button
                  style={btn("primary")}
                  onClick={() => setStatus("active")}
                  disabled={busy || active.stats.total === 0 || windowBad}
                >
                  Start campaign ({active.stats.pending})
                </button>
              )
            ) : null}

            <button
              style={btn()}
              onClick={save}
              disabled={busy || !form.name || !form.from_number || windowBad}
            >
              {creating ? "Create campaign" : "Save settings"}
            </button>

            {!creating && active ? (
              <span style={{ fontSize: 13.5, color: C.faint }}>
                {active.stats.answered + active.stats.failed + active.stats.suppressed} /{" "}
                {active.stats.total} done · cap {active.daily_cap}/day
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* quick dialer */}
      {active && !creating ? (
        <div style={{ ...panel, marginTop: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Quick dialer</div>
          <p style={{ color: C.faint, fontSize: 13, margin: "0 0 16px", lineHeight: 1.6 }}>
            Call one number right now to hear the agent before committing a list to it. Ignores the
            calling window, the daily cap and the DNC list — so use your own number.
          </p>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14 }}
          >
            <div>
              <span style={lbl}>Number to call</span>
              <input
                style={fld}
                value={testNumber}
                onChange={(e) => setTestNumber(e.target.value)}
                placeholder="+447700900123"
              />
            </div>
            <div>
              <span style={lbl}>Their name (optional)</span>
              <input
                style={fld}
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="fills {{customer_name}}"
              />
            </div>
            <div>
              <span style={lbl}>Agent</span>
              <select style={fld} value={testAgent} onChange={(e) => setTestAgent(e.target.value)}>
                <option value="">The number&apos;s own outbound agent</option>
                {agents.map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>
                    {a.agent_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
            <button
              style={btn("primary")}
              onClick={testCall}
              disabled={dialing || !testNumber.trim() || !form.from_number}
            >
              {dialing ? "Dialling…" : "Call now"}
            </button>
            <span style={{ fontSize: 12.5, color: C.faint }}>
              from {form.from_number || "no number selected"}
            </span>
          </div>
        </div>
      ) : null}

      {/* contacts */}
      {active && !creating ? (
        <div style={{ ...panel, marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>Contacts</span>
            <span style={{ fontSize: 13.5, color: C.faint }}>{active.stats.total} total</span>
            <button
              style={{ ...btn(), marginLeft: "auto", padding: "9px 16px", fontSize: 13.5 }}
              onClick={() => setShowImport(!showImport)}
            >
              {showImport ? "Close" : "Add contacts"}
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 22,
              flexWrap: "wrap",
              fontSize: 13.5,
              color: C.dim,
              marginTop: 18,
            }}
          >
            <span>waiting {active.stats.pending}</span>
            <span>calling {active.stats.queued}</span>
            <span style={{ color: C.green }}>answered {active.stats.answered}</span>
            <span style={{ color: C.oxbloodText }}>no answer {active.stats.no_answer}</span>
            <span style={{ color: C.red }}>failed {active.stats.failed}</span>
            {active.stats.suppressed ? <span>dnc {active.stats.suppressed}</span> : null}
          </div>

          {showImport ? (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
              <span style={lbl}>Upload a CSV or Excel file</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.tsv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f);
                  e.target.value = "";
                }}
                disabled={busy}
                style={{ ...fld, padding: "9px 12px", cursor: "pointer" }}
              />
              <p style={{ fontSize: 12.5, color: C.faint, margin: "7px 0 0", lineHeight: 1.6 }}>
                Columns are matched by header name — phone, name, email, interest. If there&apos;s no
                recognisable header, the first column is used as the number.
                {fileName ? ` Last file: ${fileName}` : ""}
              </p>

              <div style={{ marginTop: 18 }}>
                <button
                  style={btn()}
                  onClick={() => importLeads({ source: "leads" })}
                  disabled={busy}
                >
                  Pull from Enquiries
                </button>
                <p style={{ fontSize: 12.5, color: C.faint, margin: "7px 0 0", lineHeight: 1.6 }}>
                  Adds every enquiry the inbound agent marked as interested. Opt-outs are left out,
                  and anyone already in this campaign is skipped.
                </p>
              </div>

              <div style={{ marginTop: 18 }}>
                <span style={lbl}>Or paste — one per line: phone, name, email</span>
                <textarea
                  style={{
                    ...fld,
                    minHeight: 110,
                    resize: "vertical",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 13,
                  }}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={"+14155551234, Jane Doe, jane@acme.com\n+14155555678, John Smith"}
                />
                <button
                  style={{ ...btn("primary"), marginTop: 12 }}
                  onClick={() => importLeads({ text: importText, country_code: "44" })}
                  disabled={busy || !importText.trim()}
                >
                  Import pasted
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <p style={{ color: C.faint, fontSize: 12.5, marginTop: 26, lineHeight: 1.7 }}>
        Refreshes every 30 seconds. Batches are handed to Retell by the cron job — point
        cron-job.org at /api/cron/campaign-tick every 5 minutes.
      </p>
    </main>
  );
}
