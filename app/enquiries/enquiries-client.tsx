"use client";

import { useCallback, useEffect, useState } from "react";
import {
  C,
  FONT_SERIF,
  btn,
  fld,
  hint,
  numeric,
  pageSub,
  pageTitle,
  stateText,
  table,
  td,
  th,
} from "@/lib/ui";

type Lead = {
  id: string;
  createdLabel: string;
  name: string;
  phone: string;
  email: string;
  interest: string;
  notes: string;
  interested: boolean;
  callId: string;
};

type LogEntry = {
  id: string;
  createdLabel: string;
  logLabel: string;
  phone: string;
  callId: string;
  data: Record<string, string>;
};

type Kind = { key: string; label: string; count: number };

/** Turn a field key back into something readable: delivery_date -> Delivery date. */
function humanise(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function EnquiriesClient() {
  const [kind, setKind] = useState("leads");
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const load = useCallback(async (which: string, q: string) => {
    setLoading(true);
    setNote("");
    try {
      const res = await fetch(
        `/api/enquiries?kind=${encodeURIComponent(which)}&q=${encodeURIComponent(q)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Couldn't load enquiries");

      setKinds(json.kinds || []);
      setLeads(json.leads || []);
      setEntries(json.entries || []);
      setColumns(json.columns || []);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't load enquiries");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(kind, search);
    // Deliberately not re-running on every keystroke — the search box
    // submits on Enter or on the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const tabs = [{ key: "leads", label: "Enquiries", count: leads.length }, ...kinds];

  return (
    <main style={{ padding: "34px 38px", maxWidth: 1180 }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 18 }}>
        <h1 style={pageTitle}>Enquiries</h1>
        <p style={pageSub}>
          Details the phone agent took down from callers who didn&apos;t book — plus anything
          recorded through a custom log you&apos;ve set up on an agent.
        </p>
      </div>

      {/* Tab strip. A rule under the active tab, not a filled pill — the
          strip stays quiet when there are several custom logs. */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginTop: 22,
          borderBottom: `1px solid ${C.border}`,
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => {
          const active = t.key === kind;
          return (
            <button
              key={t.key}
              onClick={() => setKind(t.key)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: active ? `2px solid ${C.oxblood}` : "2px solid transparent",
                color: active ? C.text : C.dim,
                fontWeight: active ? 500 : 400,
                padding: "9px 14px",
                marginBottom: -1,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              {t.label}
              {t.count > 0 && (
                <span style={{ ...numeric, color: C.faint, marginLeft: 7, fontSize: 12.5 }}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {kind === "leads" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(kind, search);
          }}
          style={{ display: "flex", gap: 9, marginTop: 20, maxWidth: 480 }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, number, email or subject"
            style={fld}
          />
          <button type="submit" style={{ ...btn(), whiteSpace: "nowrap" }}>
            Search
          </button>
        </form>
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

      {/* --------------------------------------------------------- enquiries */}
      {kind === "leads" && (
        <>
          {!loading && leads.length === 0 && !note && (
            <div style={{ marginTop: 40 }}>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 17, color: C.text }}>
                {search ? "Nothing matches that search" : "No enquiries yet"}
              </div>
              <p style={{ ...hint, marginTop: 8 }}>
                {search
                  ? "Try a partial number, or clear the search to see everything."
                  : "The agent saves an enquiry whenever a caller leaves their details without booking. Callbacks, price questions and opt-outs all land here."}
              </p>
            </div>
          )}

          {leads.length > 0 && (
            <table style={{ ...table, marginTop: 22 }}>
              <thead>
                <tr>
                  <th style={{ ...th, paddingLeft: 12 }}>Taken</th>
                  <th style={th}>Name</th>
                  <th style={th}>Contact</th>
                  <th style={th}>Subject</th>
                  <th style={th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  // An opt-out is the one row a person must not call back, so
                  // it gets the attention marker rather than blending in.
                  const optedOut = /do not call|dnc/i.test(lead.notes);
                  const state = optedOut ? "attention" : lead.interested ? "settled" : "neutral";

                  return (
                    <tr key={lead.id}>
                      <td
                        style={{
                          ...td,
                          ...numeric,
                          paddingLeft: 12,
                          borderLeft: `2px solid ${
                            state === "attention"
                              ? C.oxblood
                              : state === "settled"
                              ? C.brass
                              : C.border
                          }`,
                          color: C.dim,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {lead.createdLabel}
                      </td>
                      <td style={{ ...td, fontWeight: 500 }}>{lead.name}</td>
                      <td style={{ ...td, ...numeric, color: C.dim, whiteSpace: "nowrap" }}>
                        {lead.phone && <div>{lead.phone}</div>}
                        {lead.email && (
                          <div style={{ fontSize: 13, color: C.faint }}>{lead.email}</div>
                        )}
                      </td>
                      <td style={{ ...td, color: C.dim }}>{lead.interest || "—"}</td>
                      <td style={{ ...td, color: C.dim, maxWidth: 340 }}>
                        {optedOut ? (
                          <span style={stateText("attention")}>Asked not to be called again</span>
                        ) : (
                          lead.notes || "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* ------------------------------------------------------- custom logs */}
      {kind !== "leads" && (
        <>
          {!loading && entries.length === 0 && !note && (
            <div style={{ marginTop: 40 }}>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 17, color: C.text }}>
                Nothing recorded under this log yet
              </div>
              <p style={{ ...hint, marginTop: 8 }}>
                Entries appear once the agent calls this log&apos;s tool on a live call. If the
                agent is talking but nothing lands here, check the log&apos;s fields are set on
                the agent and that Setup checks pass.
              </p>
            </div>
          )}

          {entries.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 22 }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={{ ...th, paddingLeft: 12 }}>Recorded</th>
                    {columns.map((col) => (
                      <th key={col} style={th}>
                        {humanise(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td
                        style={{
                          ...td,
                          ...numeric,
                          paddingLeft: 12,
                          borderLeft: `2px solid ${C.border}`,
                          color: C.dim,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.createdLabel}
                      </td>
                      {columns.map((col) => (
                        <td key={col} style={{ ...td, color: entry.data[col] ? C.text : C.faint }}>
                          {entry.data[col] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
