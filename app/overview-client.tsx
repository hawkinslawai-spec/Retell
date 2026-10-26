"use client";

import { useCallback, useEffect, useState } from "react";
import { C, FONT_SERIF, numeric, pageSub, pageTitle } from "@/lib/ui";

type RecentCall = {
  callId: string;
  toNumber: string;
  fromNumber: string;
  direction: string;
  startedAt: number;
  durationMs: number;
  status: string;
  successful: boolean | null;
};

type Overview = {
  callsToday: number;
  totalCalls: number;
  minutesUsed: number;
  costUsd: number;
  activeAgents: number;
  activeCampaigns: number;
  leadsCaptured: number;
  appointmentsBooked: number;
  answerRate: number | null;
  avgDurationSec: number | null;
  perDay: { day: string; calls: number; minutes: number }[];
  recent: RecentCall[];
  warnings: string[];
};


const card: React.CSSProperties = {
  background: C.slate,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: "18px 20px",
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

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: C.dim, marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.6, color: tint || C.text }}>
        {value}
      </div>
    </div>
  );
}

function Action({ label, href, tint }: { label: string; href: string; tint: string }) {
  return (
    <a
      href={href}
      style={{
        ...card,
        display: "flex",
        alignItems: "center",
        gap: 13,
        textDecoration: "none",
        color: C.text,
        fontSize: 14.5,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: tint,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        ›
      </span>
      {label}
    </a>
  );
}

/** Small inline chart — no charting library, so nothing extra in the bundle. */
function Chart({
  points,
  color,
  fill,
}: {
  points: { day: string; value: number }[];
  color: string;
  fill: boolean;
}) {
  const w = 520;
  const h = 150;
  const pad = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;

  const xy = points.map((p, i) => ({
    x: pad + i * step,
    y: h - pad - (p.value / max) * (h - pad * 2),
  }));

  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${xy[xy.length - 1]?.x ?? pad},${h - pad} L${pad},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 150 }} role="img">
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={pad}
          x2={w - pad}
          y1={h - pad - t * (h - pad * 2)}
          y2={h - pad - t * (h - pad * 2)}
          stroke={C.border}
          strokeWidth="1"
        />
      ))}
      {fill ? <path d={area} fill={color} opacity="0.14" /> : null}
      {fill ? (
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      ) : (
        points.map((p, i) => {
          const barW = Math.max(8, step * 0.45);
          const barH = Math.max(1, (p.value / max) * (h - pad * 2));
          return (
            <rect
              key={i}
              x={pad + i * step - barW / 2}
              y={h - pad - barH}
              width={barW}
              height={barH}
              rx="3"
              fill={color}
              opacity="0.85"
            />
          );
        })
      )}
      {points.map((p, i) => (
        <text
          key={i}
          x={pad + i * step}
          y={h - 8}
          fill={C.faint}
          fontSize="11"
          textAnchor="middle"
        >
          {p.day}
        </text>
      ))}
      <text x={pad} y={16} fill={C.faint} fontSize="11">
        {max}
      </text>
    </svg>
  );
}

function when(ms: number): string {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function dur(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export default function OverviewClient() {
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/overview", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to load");
      setData(json);
      setAuthed(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
      setAuthed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!authed) return;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [authed, load]);

  const d = data;

  return (
    <main style={{ maxWidth: 1120, padding: "36px 32px 80px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <h1 style={pageTitle}>Overview</h1>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: (d?.activeAgents ?? 0) > 0 ? C.green : C.faint,
            }}
          />
          <span style={{ fontSize: 13.5, color: (d?.activeAgents ?? 0) > 0 ? C.green : C.faint }}>
            {(d?.activeAgents ?? 0) > 0 ? "Agent live" : "No agents"}
          </span>
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Action label="New agent" href="/agents" tint="linear-gradient(135deg,#4d7fe0,#8b5fd6)" />
        <Action label="Start campaign" href="/campaigns" tint="linear-gradient(135deg,#8b5fd6,#c46fd0)" />
        <Action label="Phone numbers" href="/phone-numbers" tint="linear-gradient(135deg,#3f8bd8,#4d7fe0)" />
        <Action label="Diagnostics" href="/setup" tint="linear-gradient(135deg,#3a7a63,#3ddc97)" />
      </div>

      {d?.warnings.length ? (
        <div
          style={{
            ...card,
            borderColor: C.oxbloodText,
            marginBottom: 14,
            fontSize: 13.5,
            color: C.oxbloodText,
            lineHeight: 1.7,
          }}
        >
          {d.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Stat label="Calls today" value={String(d?.callsToday ?? 0)} tint={C.brassText} />
        <Stat label="Active agents" value={String(d?.activeAgents ?? 0)} tint={C.dim} />
        <Stat label="Appointments booked" value={String(d?.appointmentsBooked ?? 0)} tint={C.green} />
        <Stat label="Leads captured" value={String(d?.leadsCaptured ?? 0)} tint={C.brassText} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <Stat label="Total calls" value={String(d?.totalCalls ?? 0)} />
        <Stat label="Minutes used" value={String(d?.minutesUsed ?? 0)} />
        <Stat label="Retell cost" value={`$${(d?.costUsd ?? 0).toFixed(2)}`} tint={C.dim} />
        <Stat
          label="Answer rate"
          value={d?.answerRate === null || d?.answerRate === undefined ? "—" : `${d.answerRate}%`}
          tint={C.green}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <div style={card}>
          <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: 10 }}>Calls per day</div>
          <Chart
            points={(d?.perDay ?? []).map((p) => ({ day: p.day, value: p.calls }))}
            color={C.brassText}
            fill
          />
        </div>
        <div style={card}>
          <div style={{ fontSize: 14.5, fontWeight: 500, marginBottom: 10 }}>Minutes consumed</div>
          <Chart
            points={(d?.perDay ?? []).map((p) => ({ day: p.day, value: p.minutes }))}
            color={C.dim}
            fill={false}
          />
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Recent calls</span>
          <span style={{ fontSize: 13, color: C.faint }}>
            avg {d?.avgDurationSec ? `${d.avgDurationSec}s` : "—"}
          </span>
          <button
            onClick={load}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.text,
              borderRadius: 9,
              padding: "7px 14px",
              fontSize: 13,
              cursor: "pointer",
            }}
            disabled={busy}
          >
            {busy ? "…" : "Refresh"}
          </button>
        </div>

        {(d?.recent ?? []).length === 0 ? (
          <p style={{ color: C.faint, fontSize: 13.5 }}>No calls yet.</p>
        ) : null}

        {(d?.recent ?? []).map((c) => (
          <div
            key={c.callId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              padding: "12px 0",
              borderTop: `1px solid ${C.border}`,
              fontSize: 13.5,
            }}
          >
            <span style={{ fontFamily: "ui-monospace, monospace", minWidth: 140 }}>
              {c.direction === "inbound" ? c.fromNumber : c.toNumber}
            </span>
            <span style={{ color: C.faint }}>{when(c.startedAt)}</span>
            <span style={{ color: C.dim }}>{dur(c.durationMs)}</span>
            <span
              style={{
                marginLeft: "auto",
                color:
                  c.successful === true ? C.green : c.successful === false ? C.oxbloodText : C.faint,
              }}
            >
              {c.status}
            </span>
          </div>
        ))}
      </div>

      <p style={{ color: C.faint, fontSize: 12.5, marginTop: 22, lineHeight: 1.7 }}>
        Refreshes every 60 seconds. Costs are Retell&apos;s own charges and exclude Twilio carrier
        fees.
      </p>
    </main>
  );
}
