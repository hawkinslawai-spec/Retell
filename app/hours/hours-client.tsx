"use client";

import { useCallback, useEffect, useState } from "react";
import { C, pageTitle } from "@/lib/ui";

type Day = {
  weekday: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  callingEnabled: boolean;
  callStart: string;
  callEnd: string;
};

type Closure = { date: string; note: string };

type Payload = {
  days: Day[];
  closures: Closure[];
  usingDefaults: boolean;
  error?: string;
  status?: { officeOpen: boolean; reason: string; nowSpoken: string; nextWorkingDaySpoken: string };
  calling?: { allowed: boolean; reason: string; windowSpoken: string };
};

const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

const card: React.CSSProperties = {
  background: C.slate,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: "18px 20px",
  marginBottom: 16,
};

const time: React.CSSProperties = {
  background: C.well,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.text,
  padding: "7px 9px",
  fontSize: 13,
  width: 108,
  boxSizing: "border-box",
  fontVariantNumeric: "tabular-nums",
};

const txt: React.CSSProperties = { ...time, width: "100%" };

const btn = (active = false): React.CSSProperties => ({
  background: active ? "#1b2b45" : "transparent",
  border: `1px solid ${C.border}`,
  color: active ? C.brassText : C.text,
  borderRadius: 8,
  padding: "8px 15px",
  fontSize: 13,
  cursor: "pointer",
});

const lbl: React.CSSProperties = { fontSize: 11.5, color: C.faint, display: "block", marginBottom: 4 };

export default function HoursClient() {
  const [days, setDays] = useState<Day[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [meta, setMeta] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [authed, setAuthed] = useState(false);
  // Edits live only in the page until Save is pressed. Without a visible
  // marker, changing a time and refreshing looks exactly like the change
  // "reverting" — which is how this was reported.
  const [dirty, setDirty] = useState(false);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);
    return json as Payload & { message?: string };
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const json = await api("/api/hawkins/hours");
      setDays(json.days || []);
      setClosures(json.closures || []);
      setMeta(json);
      setAuthed(true);
      setDirty(false);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not load hours");
      setBad(true);
      setAuthed(false);
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  function patch(weekday: number, change: Partial<Day>) {
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...change } : d)));
    setDirty(true);
  }

  function editClosures(update: (prev: Closure[]) => Closure[]) {
    setClosures(update);
    setDirty(true);
  }

  // The browser's own "leave site?" prompt on refresh or close while there
  // are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setBusy(true);
    setNote("");
    try {
      const json = await api("/api/hawkins/hours", {
        method: "PUT",
        body: JSON.stringify({ days, closures: closures.filter((c) => c.date) }),
      });
      setDays(json.days || []);
      setClosures(json.closures || []);
      setMeta(json);
      setDirty(false);
      setNote("Saved. Amy uses these from her next call.");
      setBad(false);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save");
      setBad(true);
    } finally {
      setBusy(false);
    }
  }

  if (!authed && !busy) {
    return (
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={pageTitle}>Opening hours</h1>
        <p style={{ color: C.red, fontSize: 13 }}>{note}</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "48px 20px 80px" }}>
      <h1 style={pageTitle}>Opening hours</h1>
      <p style={{ color: C.dim, marginTop: 0, fontSize: 14, lineHeight: 1.6, maxWidth: "64ch" }}>
        Opening hours decide whether Amy attempts a transfer at all &mdash; outside them she takes a
        message instead. Calling hours are separate, and only limit outbound campaigns.
      </p>
      <p
        style={{
          color: C.brassText,
          marginTop: 10,
          fontSize: 13,
          lineHeight: 1.6,
          maxWidth: "64ch",
        }}
      >
        All times are UK time (London). Enter the firm&apos;s hours as they are in London, not
        your local time &mdash; GMT and British Summer Time are handled automatically.
      </p>

      {note ? (
        <div style={{ ...card, borderColor: bad ? C.red : C.green }}>
          <p style={{ margin: 0, fontSize: 13, color: bad ? C.red : C.green, lineHeight: 1.6 }}>
            {note}
          </p>
        </div>
      ) : null}

      {meta?.usingDefaults ? (
        <div style={{ ...card, borderColor: C.brass }}>
          <p style={{ margin: 0, fontSize: 13, color: C.brassText, lineHeight: 1.7 }}>
            Showing built-in defaults, not the firm&apos;s own hours
            {meta.error ? ` — ${meta.error}` : ""}. Saving will store them properly.
          </p>
        </div>
      ) : null}

      {meta?.status ? (
        <div style={card}>
          <div style={{ display: "flex", gap: 26, flexWrap: "wrap", fontSize: 13 }}>
            <div>
              <span style={lbl}>Time in London</span>
              <span style={{ color: C.text }}>{meta.status.nowSpoken}</span>
            </div>
            <div>
              <span style={lbl}>Right now</span>
              <span style={{ color: meta.status.officeOpen ? C.green : C.oxbloodText }}>
                {meta.status.officeOpen ? "Open" : `Closed — ${meta.status.reason}`}
              </span>
            </div>
            <div>
              <span style={lbl}>Outbound calling</span>
              <span style={{ color: meta.calling?.allowed ? C.green : C.faint }}>
                {meta.calling?.allowed ? "Allowed" : `Not now — ${meta.calling?.reason ?? ""}`}
              </span>
            </div>
            <div>
              <span style={lbl}>Next working day</span>
              <span style={{ color: C.dim }}>{meta.status.nextWorkingDaySpoken}</span>
            </div>
          </div>
        </div>
      ) : null}

      <div style={card}>
        {days.map((d, i) => (
          <div
            key={d.weekday}
            style={{
              display: "flex",
              gap: 16,
              alignItems: "flex-end",
              flexWrap: "wrap",
              padding: "12px 0",
              borderTop: i === 0 ? "none" : `1px solid ${C.hairline}`,
            }}
          >
            <div style={{ width: 128 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={d.isOpen}
                  onChange={(e) => patch(d.weekday, { isOpen: e.target.checked })}
                />
                <span style={{ fontSize: 13.5, color: d.isOpen ? C.text : C.faint }}>
                  {DAY_NAMES[d.weekday]}
                </span>
              </label>
            </div>

            <div style={{ opacity: d.isOpen ? 1 : 0.35 }}>
              <span style={lbl}>Opens</span>
              <input
                style={time}
                type="time"
                value={d.openTime}
                disabled={!d.isOpen}
                onChange={(e) => patch(d.weekday, { openTime: e.target.value })}
              />
            </div>
            <div style={{ opacity: d.isOpen ? 1 : 0.35 }}>
              <span style={lbl}>Closes</span>
              <input
                style={time}
                type="time"
                value={d.closeTime}
                disabled={!d.isOpen}
                onChange={(e) => patch(d.weekday, { closeTime: e.target.value })}
              />
            </div>

            <div style={{ width: 1, alignSelf: "stretch", background: C.hairline, margin: "0 4px" }} />

            <div style={{ width: 92 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={d.callingEnabled}
                  onChange={(e) => patch(d.weekday, { callingEnabled: e.target.checked })}
                />
                <span style={{ fontSize: 12.5, color: d.callingEnabled ? C.dim : C.faint }}>
                  Calling
                </span>
              </label>
            </div>
            <div style={{ opacity: d.callingEnabled ? 1 : 0.35 }}>
              <span style={lbl}>From</span>
              <input
                style={time}
                type="time"
                value={d.callStart}
                disabled={!d.callingEnabled}
                onChange={(e) => patch(d.weekday, { callStart: e.target.value })}
              />
            </div>
            <div style={{ opacity: d.callingEnabled ? 1 : 0.35 }}>
              <span style={lbl}>To</span>
              <input
                style={time}
                type="time"
                value={d.callEnd}
                disabled={!d.callingEnabled}
                onChange={(e) => patch(d.weekday, { callEnd: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13.5, color: C.text, marginBottom: 6 }}>Closure dates</div>
        <p style={{ fontSize: 12, color: C.faint, margin: "0 0 14px", lineHeight: 1.7, maxWidth: "62ch" }}>
          One-off days the firm is shut &mdash; a Christmas shutdown, an Eid day, a training
          afternoon. UK bank holidays are already handled automatically and don&apos;t need adding.
        </p>

        {closures.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
            <input
              style={{ ...time, width: 150 }}
              type="date"
              value={c.date}
              onChange={(e) =>
                editClosures((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, date: e.target.value } : x))
                )
              }
            />
            <input
              style={txt}
              placeholder="Reason (optional)"
              value={c.note}
              onChange={(e) =>
                editClosures((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, note: e.target.value } : x))
                )
              }
            />
            <button
              style={{ ...btn(), color: C.red, flexShrink: 0 }}
              onClick={() => editClosures((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          style={{ ...btn(), marginTop: 6 }}
          onClick={() => editClosures((prev) => [...prev, { date: "", note: "" }])}
        >
          Add a closure date
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
        <button style={btn(true)} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save hours"}
        </button>
        {dirty ? (
          <span style={{ fontSize: 12.5, color: C.brassText }}>
            Unsaved changes &mdash; they&apos;ll be lost if you leave or refresh.
          </span>
        ) : null}
      </div>

      <p style={{ color: C.faint, fontSize: 12, marginTop: 24, lineHeight: 1.7, maxWidth: "64ch" }}>
        A call already in progress keeps the status it started with. A caller who reaches Amy at
        17:29 is still treated as in-hours even if the transfer happens at 17:31.
      </p>
    </main>
  );
}
