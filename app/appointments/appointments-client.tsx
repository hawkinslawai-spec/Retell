"use client";

import { useEffect, useState } from "react";
import {
  C,
  FONT_SERIF,
  btn,
  hint,
  numeric,
  pageSub,
  pageTitle,
  stateText,
} from "@/lib/ui";

type Appointment = {
  id: string;
  callId: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  notes: string;
  startIso: string;
  startLabel: string;
  dayLabel: string;
  status: string;
  createdByAgent: boolean;
};

export default function AppointmentsClient() {
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [days, setDays] = useState(30);
  const [busyId, setBusyId] = useState("");

  async function load(ahead = days) {
    setLoading(true);
    setNote("");
    try {
      const res = await fetch(`/api/appointments?days=${ahead}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Couldn't load appointments");
      setRows(json.appointments || []);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't load appointments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function cancel(id: string, name: string) {
    if (!confirm(`Cancel the appointment for ${name}?`)) return;

    setBusyId(id);
    try {
      const res = await fetch(`/api/appointments?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Cancel failed");
      await load(days);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusyId("");
    }
  }

  // Grouped by day, so the page reads like a court list rather than a
  // flat table where you have to re-read the date on every row.
  const byDay = new Map<string, Appointment[]>();
  for (const row of rows) {
    const list = byDay.get(row.dayLabel) || [];
    list.push(row);
    byDay.set(row.dayLabel, list);
  }

  const now = Date.now();
  const upcoming = rows.filter((r) => new Date(r.startIso).getTime() >= now).length;

  return (
    <main style={{ padding: "34px 38px", maxWidth: 1060 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
          borderBottom: `1px solid ${C.border}`,
          paddingBottom: 18,
        }}
      >
        <div>
          <h1 style={pageTitle}>Appointments</h1>
          <p style={pageSub}>
            Everything the phone agent has booked. Cancelling here frees the slot straight away,
            so the agent can offer it to the next caller.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{
              background: C.well,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.text,
              padding: "8px 11px",
              fontSize: 13.5,
            }}
          >
            <option value={7}>Next 7 days</option>
            <option value={30}>Next 30 days</option>
            <option value={90}>Next 90 days</option>
          </select>
          <button onClick={() => load(days)} style={btn()} disabled={loading}>
            {loading ? "Loading" : "Refresh"}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 34, padding: "20px 0 4px" }}>
          <div>
            <div style={{ ...numeric, fontFamily: FONT_SERIF, fontSize: 25, fontWeight: 600 }}>
              {upcoming}
            </div>
            <div style={{ fontSize: 12.5, color: C.dim }}>Still to come</div>
          </div>
          <div>
            <div style={{ ...numeric, fontFamily: FONT_SERIF, fontSize: 25, fontWeight: 600 }}>
              {rows.length}
            </div>
            <div style={{ fontSize: 12.5, color: C.dim }}>In this period</div>
          </div>
        </div>
      )}

      {note && (
        <div
          style={{
            marginTop: 20,
            borderLeft: `2px solid ${C.oxblood}`,
            paddingLeft: 14,
            color: C.oxbloodText,
            fontSize: 13.5,
          }}
        >
          {note}
        </div>
      )}

      {!loading && rows.length === 0 && !note && (
        <div style={{ marginTop: 40 }}>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 17, color: C.text }}>
            Nothing booked yet
          </div>
          <p style={{ ...hint, marginTop: 8 }}>
            Appointments appear here the moment the phone agent books one. If a caller booked and
            nothing showed up, open Setup checks — a failing signing key stops every booking
            without the caller ever hearing a problem.
          </p>
        </div>
      )}

      {[...byDay.entries()].map(([day, items]) => {
        const isPast = new Date(items[0].startIso).getTime() < now;

        return (
          <section key={day} style={{ marginTop: 30 }}>
            <h2
              style={{
                fontFamily: FONT_SERIF,
                fontSize: 15,
                fontWeight: 600,
                color: isPast ? C.faint : C.text,
                margin: "0 0 2px",
              }}
            >
              {day}
            </h2>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {items.map((a) => {
                  const past = new Date(a.startIso).getTime() < now;
                  return (
                    <tr key={a.id}>
                      {/* Time column: tabular so every row's time aligns. */}
                      <td
                        style={{
                          width: 162,
                          padding: "13px 16px 13px 12px",
                          borderBottom: `1px solid ${C.hairline}`,
                          borderLeft: `2px solid ${past ? C.border : C.brass}`,
                          ...numeric,
                          color: past ? C.faint : C.text,
                          whiteSpace: "nowrap",
                          verticalAlign: "top",
                        }}
                      >
                        {a.startLabel}
                      </td>

                      <td
                        style={{
                          padding: "13px 16px 13px 0",
                          borderBottom: `1px solid ${C.hairline}`,
                          verticalAlign: "top",
                        }}
                      >
                        <div style={{ color: past ? C.dim : C.text, fontWeight: 500 }}>
                          {a.name}
                        </div>
                        {a.service && (
                          <div style={{ fontSize: 13, color: C.dim, marginTop: 2 }}>
                            {a.service}
                          </div>
                        )}
                        {a.notes && (
                          <div style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>
                            {a.notes}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "13px 16px 13px 0",
                          borderBottom: `1px solid ${C.hairline}`,
                          ...numeric,
                          color: C.dim,
                          whiteSpace: "nowrap",
                          verticalAlign: "top",
                        }}
                      >
                        {a.phone && <div>{a.phone}</div>}
                        {a.email && (
                          <div style={{ fontSize: 13, color: C.faint, marginTop: 2 }}>
                            {a.email}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "13px 0",
                          borderBottom: `1px solid ${C.hairline}`,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          verticalAlign: "top",
                        }}
                      >
                        {a.createdByAgent && (
                          <span style={{ ...stateText("settled"), marginRight: 14 }}>
                            Booked by agent
                          </span>
                        )}
                        {!past && (
                          <button
                            onClick={() => cancel(a.id, a.name)}
                            disabled={busyId === a.id}
                            style={{
                              ...btn("danger"),
                              padding: "6px 12px",
                              fontSize: 13,
                            }}
                          >
                            {busyId === a.id ? "Cancelling" : "Cancel"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}
