"use client";

import { useCallback, useEffect, useState } from "react";
import { C, panel, fld, btn, when, dur, pageTitle } from "@/lib/ui";

type Call = {
  callId: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  startedAt: number;
  durationMs: number;
  status: string;
  disconnectReason: string;
  successful: boolean | null;
  sentiment: string;
  summary: string;
  recordingUrl: string;
  costUsd: number;
};

type Turn = { role: string; content: string };
type Detail = Call & { transcript: Turn[]; transcriptText: string };

export default function CallsClient() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/calls?limit=100", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to load");
      setCalls(json.calls || []);
      setNote("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCall = useCallback(
    async (id: string) => {
      if (openId === id) {
        setOpenId(null);
        setDetail(null);
        return;
      }
      setOpenId(id);
      setDetail(null);
      try {
        const res = await fetch(`/api/calls/${id}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || "Failed to load call");
        setDetail(json.call);
      } catch (e) {
        setNote(e instanceof Error ? e.message : "Failed to load call");
      }
    },
    [openId]
  );

  const q = search.trim().toLowerCase();
  const shown = q
    ? calls.filter((c) =>
        `${c.fromNumber} ${c.toNumber} ${c.summary} ${c.disconnectReason}`.toLowerCase().includes(q)
      )
    : calls;

  return (
    <main style={{ maxWidth: 1000, padding: "40px 32px 80px" }}>
      <h1 style={pageTitle}>
        Call History
      </h1>
      <p style={{ color: C.dim, marginTop: 0, fontSize: 14.5, lineHeight: 1.6 }}>
        Every call with its summary, transcript and recording. Click a row to expand it.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "24px 0 16px" }}>
        <input
          style={{ ...fld, maxWidth: 320 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number or summary…"
        />
        <span style={{ fontSize: 13.5, color: C.dim }}>
          {shown.length} of {calls.length}
        </span>
        <button
          style={{ ...btn(), marginLeft: "auto", fontSize: 13, padding: "9px 16px" }}
          onClick={load}
          disabled={busy}
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      {note ? (
        <div style={{ ...panel, borderColor: C.oxbloodText, marginBottom: 14 }}>
          <span style={{ fontSize: 13.5, color: C.oxbloodText }}>{note}</span>
        </div>
      ) : null}

      {shown.length === 0 && !busy ? (
        <p style={{ color: C.faint, fontSize: 14 }}>No calls yet.</p>
      ) : null}

      {shown.map((c) => {
        const isOpen = c.callId === openId;
        return (
          <div key={c.callId} style={{ ...panel, marginBottom: 10 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer" }}
              onClick={() => openCall(c.callId)}
            >
              <span
                style={{
                  fontSize: 11.5,
                  color: c.direction === "inbound" ? C.brassText : C.dim,
                  border: `1px solid ${C.border}`,
                  borderRadius: 99,
                  padding: "3px 9px",
                }}
              >
                {c.direction || "call"}
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13.5, minWidth: 140 }}>
                {c.direction === "inbound" ? c.fromNumber : c.toNumber}
              </span>
              <span style={{ fontSize: 13, color: C.faint }}>{when(c.startedAt)}</span>
              <span style={{ fontSize: 13, color: C.dim }}>{dur(c.durationMs)}</span>
              {c.sentiment ? (
                <span style={{ fontSize: 12.5, color: C.faint }}>{c.sentiment}</span>
              ) : null}
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 13,
                  color: c.successful === true ? C.green : c.successful === false ? C.oxbloodText : C.faint,
                }}
              >
                {c.disconnectReason || c.status}
              </span>
            </div>

            {c.summary && !isOpen ? (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 13,
                  color: C.dim,
                  lineHeight: 1.6,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.summary}
              </p>
            ) : null}

            {isOpen ? (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
                {!detail ? (
                  <p style={{ color: C.faint, fontSize: 13.5, margin: 0 }}>Loading…</p>
                ) : (
                  <>
                    {detail.recordingUrl ? (
                      <audio
                        controls
                        src={detail.recordingUrl}
                        style={{ width: "100%", height: 38, marginBottom: 16 }}
                      />
                    ) : (
                      <p style={{ color: C.faint, fontSize: 13, marginTop: 0 }}>
                        No recording — check that call recording is enabled on the agent.
                      </p>
                    )}

                    {detail.summary ? (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 7 }}>Summary</div>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 13.5,
                            lineHeight: 1.7,
                            background: C.well,
                            borderRadius: 9,
                            padding: "13px 15px",
                          }}
                        >
                          {detail.summary}
                        </p>
                      </div>
                    ) : null}

                    <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 8 }}>
                      Transcript · ${detail.costUsd.toFixed(3)}
                    </div>
                    <div
                      style={{
                        maxHeight: 340,
                        overflowY: "auto",
                        background: C.well,
                        borderRadius: 9,
                        padding: "12px 15px",
                      }}
                    >
                      {detail.transcript.length === 0 ? (
                        <p style={{ margin: 0, fontSize: 13, color: C.faint, whiteSpace: "pre-wrap" }}>
                          {detail.transcriptText || "No transcript available."}
                        </p>
                      ) : (
                        detail.transcript.map((t, i) => (
                          <div key={i} style={{ marginBottom: 11 }}>
                            <span
                              style={{
                                fontSize: 11.5,
                                color: t.role === "agent" ? C.dim : C.brassText,
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                              }}
                            >
                              {t.role}
                            </span>
                            <p style={{ margin: "3px 0 0", fontSize: 13.5, lineHeight: 1.65 }}>
                              {t.content}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </main>
  );
}
