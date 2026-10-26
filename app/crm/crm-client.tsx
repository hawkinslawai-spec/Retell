"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { C, panel, fld, lbl, btn, when, pageTitle } from "@/lib/ui";

type Contact = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  last_call_at: string | null;
  last_summary: string | null;
  call_count: number;
  booked_at: string | null;
  created_at: string;
};

const STATUS_COLOR: Record<string, string> = {
  new: C.faint,
  contacted: C.brassText,
  qualified: C.dim,
  booked: C.green,
  won: C.green,
  lost: C.red,
  dnc: C.red,
};

export default function CrmClient() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Contact>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ status: filter });
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/crm?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to load");
      setContacts(json.contacts || []);
      setStatuses(json.statuses || []);
      setNote("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }, [filter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const open = useMemo(() => contacts.find((c) => c.id === openId) || null, [contacts, openId]);

  useEffect(() => {
    if (open) setDraft({ ...open });
  }, [open]);

  async function save() {
    if (!openId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/${openId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          email: draft.email,
          company: draft.company,
          status: draft.status,
          notes: draft.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Save failed");
      setNote("Saved.");
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of contacts) out[c.status] = (out[c.status] || 0) + 1;
    return out;
  }, [contacts]);

  return (
    <main style={{ maxWidth: 1080, padding: "40px 32px 80px" }}>
      <h1 style={pageTitle}>Contacts</h1>
      <p style={{ color: C.dim, marginTop: 0, fontSize: 14.5, lineHeight: 1.6 }}>
        Everyone the agent has spoken to. Contacts are created automatically from calls and
        bookings.
      </p>

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "24px 0 16px" }}>
        {["all", ...statuses].map((s) => {
          const on = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                ...btn(on ? "primary" : "ghost"),
                textTransform: "capitalize",
                fontSize: 13,
                padding: "8px 15px",
              }}
            >
              {s}
              {s !== "all" && counts[s] ? ` (${counts[s]})` : ""}
            </button>
          );
        })}
        <input
          style={{ ...fld, width: 240, marginLeft: "auto" }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email…"
        />
      </div>

      {note ? (
        <div style={{ ...panel, borderColor: C.oxbloodText, marginBottom: 14 }}>
          <span style={{ fontSize: 13.5, color: C.oxbloodText }}>{note}</span>
        </div>
      ) : null}

      {contacts.length === 0 && !busy ? (
        <p style={{ color: C.faint, fontSize: 14 }}>
          No contacts yet. They appear here once the agent takes or makes a call.
        </p>
      ) : null}

      {contacts.map((c) => {
        const isOpen = c.id === openId;
        return (
          <div key={c.id} style={{ ...panel, marginBottom: 12 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer" }}
              onClick={() => setOpenId(isOpen ? null : c.id)}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: STATUS_COLOR[c.status] || C.faint,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 14.5, fontWeight: 500, minWidth: 130 }}>
                {c.name || "Unknown"}
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: C.dim }}>
                {c.phone}
              </span>
              <span style={{ fontSize: 13, color: C.faint, textTransform: "capitalize" }}>
                {c.status}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 13, color: C.faint }}>
                {c.call_count} call{c.call_count === 1 ? "" : "s"}
                {c.last_call_at ? ` · ${when(new Date(c.last_call_at).getTime())}` : ""}
              </span>
            </div>

            {c.last_summary && !isOpen ? (
              <p
                style={{
                  margin: "10px 0 0 22px",
                  fontSize: 13,
                  color: C.dim,
                  lineHeight: 1.6,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.last_summary}
              </p>
            ) : null}

            {isOpen ? (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 14,
                  }}
                >
                  <div>
                    <span style={lbl}>Name</span>
                    <input
                      style={fld}
                      value={draft.name || ""}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <span style={lbl}>Email</span>
                    <input
                      style={fld}
                      value={draft.email || ""}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <span style={lbl}>Company</span>
                    <input
                      style={fld}
                      value={draft.company || ""}
                      onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                    />
                  </div>
                  <div>
                    <span style={lbl}>Status</span>
                    <select
                      style={fld}
                      value={draft.status || "new"}
                      onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s} style={{ textTransform: "capitalize" }}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {c.last_summary ? (
                  <div style={{ marginTop: 16 }}>
                    <span style={lbl}>Last call summary</span>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13.5,
                        color: C.dim,
                        lineHeight: 1.7,
                        background: C.well,
                        borderRadius: 9,
                        padding: "12px 14px",
                      }}
                    >
                      {c.last_summary}
                    </p>
                  </div>
                ) : null}

                <div style={{ marginTop: 16 }}>
                  <span style={lbl}>Notes</span>
                  <textarea
                    style={{ ...fld, minHeight: 90, resize: "vertical" }}
                    value={draft.notes || ""}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    placeholder="Anything worth remembering before the next call…"
                  />
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
                  <button style={btn("primary")} onClick={save} disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                  {c.booked_at ? (
                    <span style={{ fontSize: 13, color: C.green }}>
                      Booked {when(new Date(c.booked_at).getTime())}
                    </span>
                  ) : null}
                  {c.source ? (
                    <span style={{ fontSize: 12.5, color: C.faint, marginLeft: "auto" }}>
                      via {c.source}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </main>
  );
}
