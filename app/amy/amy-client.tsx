"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, pageTitle, pageSub, sectionTitle, fld, lbl, hint, btn, when } from "@/lib/ui";

type Staff = {
  id: string;
  firstName: string;
  fullName: string;
  directLine: string;
  email: string;
  variants: string[];
};

type RouteKey = "new_enquiry" | "unknown_handler" | "third_party" | "complaint";
type Routes = Record<RouteKey, string[]>;

type Firm = {
  name: string;
  address: string;
  websiteSpoken: string;
  emailSpoken: string;
  practiceAreasSpoken: string;
  descriptionSpoken: string;
};

type Settings = {
  staff: Staff[];
  routes: Routes;
  generalEmail: string;
  firm: Firm;
  nameGuidance: string;
  voiceId: string;
  usingDefaults?: boolean;
  updatedAt?: string;
  error?: string;
};

type Live = {
  agentId: string;
  voiceId: string;
  latestVersion?: number;
  latestIsPublished?: boolean;
  publishedVersion?: number;
  publishedAt?: number;
  numbers: { phoneNumber: string; nickname: string; version: string }[];
  tools: { expected: string[]; missing: string[]; present: string[] };
  error?: string;
};

type Voice = {
  id: string;
  name: string;
  provider: string;
  gender: string;
  accent: string;
  preview: string;
  recommended: boolean;
};

type Row = Staff & { key: string; isNew: boolean; variantsText: string };

const ROUTE_ORDER: RouteKey[] = ["new_enquiry", "unknown_handler", "third_party", "complaint"];

const card: React.CSSProperties = {
  background: C.slate,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "20px 22px",
  marginBottom: 18,
};

const small: React.CSSProperties = { ...fld, padding: "8px 10px", fontSize: 13 };

let keySeq = 0;
const nextKey = () => `r${++keySeq}`;

function idFromName(firstName: string): string {
  return (firstName || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase()
    .slice(0, 24);
}

/** Show +442035041612 as 020 3504 1612 — how staff recognise their own number. */
function displayNumber(e164: string): string {
  if (!e164.startsWith("+44")) return e164;
  const n = "0" + e164.slice(3);
  if (n.startsWith("02") && n.length === 11) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;
  if (n.startsWith("07") && n.length === 11) return `${n.slice(0, 5)} ${n.slice(5)}`;
  return n;
}

function toRows(staff: Staff[]): Row[] {
  return staff.map((s) => ({
    ...s,
    directLine: displayNumber(s.directLine),
    key: nextKey(),
    isNew: false,
    variantsText: s.variants.join(", "),
  }));
}

export default function AmyClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [routes, setRoutes] = useState<Routes>({
    new_enquiry: [],
    unknown_handler: [],
    third_party: [],
    complaint: [],
  });
  const [routeLabels, setRouteLabels] = useState<Record<string, string>>({});
  const [generalEmail, setGeneralEmail] = useState("");
  const [firm, setFirm] = useState<Firm | null>(null);
  const [nameGuidance, setNameGuidance] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [meta, setMeta] = useState<Settings | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [prompt, setPrompt] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "saving" | "publishing">("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const apply = useCallback((s: Settings, l?: Live) => {
    setRows(toRows(s.staff));
    setRoutes({ ...s.routes });
    setGeneralEmail(s.generalEmail);
    setFirm({ ...s.firm });
    setNameGuidance(s.nameGuidance);
    setVoiceId(s.voiceId);
    setMeta(s);
    if (l) setLive(l);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hawkins/amy", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `Could not load (${res.status})`);
      setRouteLabels(json.routeLabels || {});
      apply(json.settings, json.live);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load Amy's settings");
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    load();
    fetch("/api/hawkins/amy/voices", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setVoices(Array.isArray(j.voices) ? j.voices : []))
      .catch(() => setVoices([]));
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => setDirty(true);

  // ------------------------------------------------------------- staff edits

  function editRow(key: string, change: Partial<Row>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.key === key ? { ...r, ...change } : r));
      const row = next.find((r) => r.key === key);
      // A new person's id follows their first name until it's saved; keep
      // the routing lists pointing at it as it changes.
      if (row && row.isNew && change.firstName !== undefined) {
        const taken = new Set(next.filter((r) => r.key !== key).map((r) => r.id));
        let id = idFromName(row.firstName) || "staff";
        let n = 2;
        while (taken.has(id)) id = `${idFromName(row.firstName) || "staff"}${n++}`;
        const oldId = row.id;
        row.id = id;
        if (oldId && oldId !== id) {
          setRoutes((r) => {
            const out = { ...r };
            for (const k of ROUTE_ORDER) out[k] = r[k].map((x) => (x === oldId ? id : x));
            return out;
          });
        }
      }
      return [...next];
    });
    touch();
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: nextKey(),
        isNew: true,
        id: "",
        firstName: "",
        fullName: "",
        directLine: "",
        email: "",
        variants: [],
        variantsText: "",
      },
    ]);
    touch();
  }

  function removeRow(row: Row) {
    const name = row.fullName || row.firstName || "this person";
    const inRoutes = ROUTE_ORDER.filter((k) => routes[k].includes(row.id));
    const extra = inRoutes.length
      ? `\n\nThey will also be taken out of: ${inRoutes.map((k) => routeLabels[k] || k).join("; ")}.`
      : "";
    if (!window.confirm(`Remove ${name}? Amy will no longer be able to put calls through to them.${extra}`)) return;
    setRows((prev) => prev.filter((r) => r.key !== row.key));
    setRoutes((r) => {
      const out = { ...r };
      for (const k of ROUTE_ORDER) out[k] = r[k].filter((x) => x !== row.id);
      return out;
    });
    touch();
  }

  // ------------------------------------------------------------ route edits

  const staffById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  function moveInRoute(k: RouteKey, i: number, dir: -1 | 1) {
    setRoutes((r) => {
      const list = [...r[k]];
      const j = i + dir;
      if (j < 0 || j >= list.length) return r;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...r, [k]: list };
    });
    touch();
  }

  function removeFromRoute(k: RouteKey, id: string) {
    setRoutes((r) => ({ ...r, [k]: r[k].filter((x) => x !== id) }));
    touch();
  }

  function addToRoute(k: RouteKey, id: string) {
    if (!id) return;
    setRoutes((r) => (r[k].includes(id) ? r : { ...r, [k]: [...r[k], id] }));
    touch();
  }

  // ------------------------------------------------------------------- save

  async function save() {
    if (!firm) return;
    setBusy("saving");
    setNote(null);

    const body = {
      staff: rows.map((r) => ({
        id: r.id,
        firstName: r.firstName,
        fullName: r.fullName,
        directLine: r.directLine,
        email: r.email,
        variants: r.variantsText
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      })),
      routes,
      generalEmail,
      firm,
      nameGuidance,
      voiceId,
    };

    // The server saves, then rebuilds and publishes; the second half is the
    // slow part, so say so.
    const slow = setTimeout(() => setBusy("publishing"), 900);
    try {
      const res = await fetch("/api/hawkins/amy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));

      if (json.stage === "validate" || json.stage === "save" || (!res.ok && !json.saved)) {
        setNote({ text: json.message || `Could not save (${res.status})`, bad: true });
        return;
      }

      // Saved. Reload what's stored so the page shows what Amy will use.
      const fresh = await fetch("/api/hawkins/amy", { cache: "no-store" }).then((r) => r.json());
      apply(fresh.settings, json.live || fresh.live);

      if (json.stage === "done") {
        const r = json.result || {};
        const bits = [
          `Saved and published — Amy is now on version ${r.publishedVersion}.`,
          `All ${r.tools?.expected?.length ?? ""} of her tools are in place.`,
        ];
        if (r.numbersUpdated?.length) bits.push(`Moved ${r.numbersUpdated.join(", ")} onto the new version.`);
        if (r.warnings?.length) bits.push(r.warnings.join(" "));
        setNote({ text: bits.join(" "), bad: false });
      } else {
        setNote({
          text:
            (json.message || "Saved, but publishing did not finish.") +
            " Your changes are stored — press Publish again to retry.",
          bad: true,
        });
      }
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Could not save", bad: true });
    } finally {
      clearTimeout(slow);
      setBusy("");
    }
  }

  async function republish() {
    setBusy("publishing");
    setNote(null);
    try {
      const res = await fetch("/api/hawkins/amy", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (json.live) setLive(json.live);
      if (res.ok && json.stage === "done") {
        setNote({ text: `Published — Amy is on version ${json.result?.publishedVersion}, all tools in place.`, bad: false });
      } else {
        setNote({ text: json.message || `Publish failed (${res.status})`, bad: true });
      }
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Publish failed", bad: true });
    } finally {
      setBusy("");
    }
  }

  async function togglePrompt() {
    if (prompt) {
      setPrompt("");
      return;
    }
    const json = await fetch("/api/hawkins/amy?prompt=1", { cache: "no-store" }).then((r) => r.json());
    setPrompt(json.prompt || "");
  }

  function playVoice(url: string) {
    if (!url) return;
    audio.current?.pause();
    audio.current = new Audio(url);
    audio.current.play().catch(() => undefined);
  }

  // ------------------------------------------------------------------ render

  if (loading && !meta) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={pageTitle}>Amy</h1>
        <p style={{ color: C.faint, fontSize: 13 }}>Loading…</p>
      </main>
    );
  }

  if (loadError && !meta) {
    return (
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={pageTitle}>Amy</h1>
        <p style={{ color: C.red, fontSize: 13 }}>{loadError}</p>
      </main>
    );
  }

  const shownVoices = showAllVoices ? voices : voices.filter((v) => v.recommended || v.id === voiceId);
  const currentVoice = voices.find((v) => v.id === voiceId);
  const toolsOk = live && live.tools.missing.length === 0 && !live.error;
  const draftAhead =
    live &&
    live.latestVersion !== undefined &&
    live.publishedVersion !== undefined &&
    live.latestVersion > live.publishedVersion &&
    !live.latestIsPublished;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 20px 120px" }}>
      <h1 style={pageTitle}>Amy</h1>
      <p style={pageSub}>
        Who Amy can put calls through to, who she rings first, how she sounds and what she says
        about the firm. Saving rebuilds her, publishes the new version and checks her tools &mdash;
        there is nothing to do in Retell afterwards.
      </p>

      {/* ---------------------------------------------------------- live */}
      <div style={{ ...card, marginTop: 24, borderColor: toolsOk ? C.border : C.oxblood }}>
        <div style={{ display: "flex", gap: 30, flexWrap: "wrap", fontSize: 13 }}>
          <div>
            <span style={{ ...lbl, fontSize: 11.5 }}>Answering calls</span>
            <span style={{ color: C.text }}>
              {live?.publishedVersion !== undefined ? `Version ${live.publishedVersion}` : "—"}
            </span>
            {live?.publishedAt ? (
              <span style={{ color: C.faint }}> · {when(live.publishedAt)}</span>
            ) : null}
          </div>
          <div>
            <span style={{ ...lbl, fontSize: 11.5 }}>Tools</span>
            <span style={{ color: toolsOk ? C.green : C.oxbloodText }}>
              {live?.error
                ? live.error
                : toolsOk
                ? `All ${live?.tools.expected.length} in place`
                : `Missing ${live?.tools.missing.join(", ")}`}
            </span>
          </div>
          <div>
            <span style={{ ...lbl, fontSize: 11.5 }}>Numbers</span>
            <span style={{ color: C.dim }}>
              {live?.numbers.length
                ? live.numbers
                    .map((n) => `${n.nickname || n.phoneNumber}${/^\d+$/.test(n.version) ? ` (v${n.version})` : ""}`)
                    .join(", ")
                : "None point at Amy"}
            </span>
          </div>
          <div>
            <span style={{ ...lbl, fontSize: 11.5 }}>Settings</span>
            <span style={{ color: meta?.usingDefaults ? C.brassText : C.dim }}>
              {meta?.usingDefaults
                ? "Built-in defaults — not saved yet"
                : meta?.updatedAt
                ? `Saved ${when(Date.parse(meta.updatedAt))}`
                : "Saved"}
            </span>
          </div>
        </div>
        {meta?.error && meta.usingDefaults ? (
          <p style={{ ...hint, color: C.brassText, margin: "12px 0 0" }}>{meta.error}</p>
        ) : null}
        {draftAhead || !toolsOk ? (
          <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: C.oxbloodText }}>
              {!toolsOk
                ? "The version answering calls is missing tools — transfers or messages may fail."
                : `There's an unpublished draft (version ${live?.latestVersion}) — probably an edit made in Retell.`}
            </span>
            <button style={btn()} onClick={republish} disabled={!!busy}>
              Rebuild &amp; publish from these settings
            </button>
          </div>
        ) : null}
      </div>

      {note ? (
        <div style={{ ...card, borderColor: note.bad ? C.red : C.green }}>
          <p style={{ margin: 0, fontSize: 13, color: note.bad ? C.red : C.green, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {note.text}
          </p>
        </div>
      ) : null}

      {/* --------------------------------------------------------- staff */}
      <div style={card}>
        <h2 style={sectionTitle}>Staff</h2>
        <p style={{ ...hint, margin: "6px 0 16px" }}>
          Each person gets their own transfer. Direct lines are used only to ring them &mdash; Amy
          never reads one out. &ldquo;Also answers to&rdquo; is how callers might say or mishear
          the name, comma-separated; Amy still confirms the full name before putting anyone
          through.
        </p>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 860 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "110px 160px 150px 200px 1fr 70px",
                gap: 10,
                fontSize: 11.5,
                color: C.faint,
                paddingBottom: 6,
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span>First name</span>
              <span>Full name</span>
              <span>Direct line</span>
              <span>Email</span>
              <span>Also answers to</span>
              <span />
            </div>
            {rows.map((r) => (
              <div
                key={r.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 160px 150px 200px 1fr 70px",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: `1px solid ${C.hairline}`,
                  alignItems: "start",
                }}
              >
                <div>
                  <input
                    style={small}
                    value={r.firstName}
                    placeholder="Bilkis"
                    onChange={(e) => editRow(r.key, { firstName: e.target.value })}
                  />
                  <span style={{ display: "block", fontSize: 10.5, color: C.faint, marginTop: 4 }}>
                    {r.id ? `transfer_to_${r.id}` : ""}
                  </span>
                </div>
                <input
                  style={small}
                  value={r.fullName}
                  placeholder="Bilkis Mahmood"
                  onChange={(e) => editRow(r.key, { fullName: e.target.value })}
                />
                <input
                  style={small}
                  value={r.directLine}
                  placeholder="020 3504 1612"
                  inputMode="tel"
                  onChange={(e) => editRow(r.key, { directLine: e.target.value })}
                />
                <input
                  style={small}
                  value={r.email}
                  placeholder="name@hawkinslaw.co.uk"
                  inputMode="email"
                  onChange={(e) => editRow(r.key, { email: e.target.value })}
                />
                <input
                  style={small}
                  value={r.variantsText}
                  placeholder="bilquis, bilqis, mahmood"
                  onChange={(e) => editRow(r.key, { variantsText: e.target.value })}
                />
                <button
                  style={{ ...btn("danger"), padding: "8px 10px", fontSize: 12.5 }}
                  onClick={() => removeRow(r)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
        <button style={{ ...btn(), marginTop: 14 }} onClick={addRow}>
          Add a person
        </button>
      </div>

      {/* -------------------------------------------------------- routing */}
      <div style={card}>
        <h2 style={sectionTitle}>Who Amy rings</h2>
        <p style={{ ...hint, margin: "6px 0 16px" }}>
          In order, during opening hours. Each person rings for 30 seconds; if nobody accepts, Amy
          takes a message and emails it to everyone on the list. A caller who names their handler
          is always put through to that person only.
        </p>

        {ROUTE_ORDER.map((k) => {
          const list = routes[k] || [];
          const available = rows.filter((r) => r.id && !list.includes(r.id));
          return (
            <div key={k} style={{ padding: "12px 0", borderTop: `1px solid ${C.hairline}` }}>
              <div style={{ fontSize: 13.5, color: C.text, marginBottom: 8 }}>{routeLabels[k] || k}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {list.map((id, i) => {
                  const s = staffById.get(id);
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        border: `1px solid ${s ? C.border : C.oxblood}`,
                        borderRadius: 6,
                        padding: "5px 6px 5px 10px",
                        fontSize: 13,
                        color: s ? C.text : C.oxbloodText,
                        background: C.well,
                      }}
                    >
                      <span style={{ color: C.faint, fontSize: 11.5 }}>{i + 1}.</span>
                      {s ? s.fullName || s.firstName : `${id} (not on staff list)`}
                      <button title="Earlier" style={chip} onClick={() => moveInRoute(k, i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button
                        title="Later"
                        style={chip}
                        onClick={() => moveInRoute(k, i, 1)}
                        disabled={i === list.length - 1}
                      >
                        ↓
                      </button>
                      <button title="Remove" style={chip} onClick={() => removeFromRoute(k, id)}>
                        ✕
                      </button>
                    </span>
                  );
                })}
                {list.length < 4 && available.length > 0 ? (
                  <select
                    style={{ ...small, width: "auto" }}
                    value=""
                    onChange={(e) => addToRoute(k, e.target.value)}
                  >
                    <option value="">+ Add…</option>
                    {available.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.fullName || r.firstName}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          );
        })}

        <div style={{ paddingTop: 14, borderTop: `1px solid ${C.hairline}`, maxWidth: 420 }}>
          <label style={lbl}>Copied on every message, and used when nobody else fits</label>
          <input
            style={small}
            value={generalEmail}
            onChange={(e) => {
              setGeneralEmail(e.target.value);
              touch();
            }}
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- voice */}
      <div style={card}>
        <h2 style={sectionTitle}>Voice</h2>
        <p style={{ ...hint, margin: "6px 0 14px" }}>
          The specification calls for a natural female British English voice. After changing it,
          ring Amy and listen to how she says each member of staff&apos;s name.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select
            style={{ ...small, width: 380 }}
            value={voiceId}
            onChange={(e) => {
              setVoiceId(e.target.value);
              touch();
            }}
          >
            {!currentVoice && voiceId ? <option value={voiceId}>{voiceId}</option> : null}
            {shownVoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {[v.gender, v.accent, v.provider].filter(Boolean).join(", ")}
              </option>
            ))}
          </select>
          {currentVoice?.preview ? (
            <button style={btn()} onClick={() => playVoice(currentVoice.preview)}>
              ▶ Listen
            </button>
          ) : null}
          <label style={{ fontSize: 12.5, color: C.dim, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={showAllVoices} onChange={(e) => setShowAllVoices(e.target.checked)} />
            Show all voices
          </label>
        </div>
        <span style={{ display: "block", fontSize: 11.5, color: C.faint, marginTop: 6 }}>{voiceId}</span>
      </div>

      {/* ----------------------------------------------------- firm wording */}
      {firm ? (
        <div style={card}>
          <h2 style={sectionTitle}>What Amy says about the firm</h2>
          <p style={{ ...hint, margin: "6px 0 16px" }}>
            These are the only facts about the firm she may state. Write them the way they should
            be said aloud &mdash; &ldquo;hawkinslaw dot co dot uk&rdquo;, not a web address.
            Anything not covered here she answers by offering a call back.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Firm name" value={firm.name} onChange={(v) => { setFirm({ ...firm, name: v }); touch(); }} />
            <Field label="Address" value={firm.address} onChange={(v) => { setFirm({ ...firm, address: v }); touch(); }} />
            <Field label="Website, as spoken" value={firm.websiteSpoken} onChange={(v) => { setFirm({ ...firm, websiteSpoken: v }); touch(); }} />
            <Field label="Email, as spoken" value={firm.emailSpoken} onChange={(v) => { setFirm({ ...firm, emailSpoken: v }); touch(); }} />
          </div>
          <div style={{ marginTop: 14 }}>
            <Field
              label="Practice areas"
              multiline
              value={firm.practiceAreasSpoken}
              onChange={(v) => { setFirm({ ...firm, practiceAreasSpoken: v }); touch(); }}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <Field
              label="Anything else approved to say about the firm (fees, services)"
              multiline
              value={firm.descriptionSpoken}
              onChange={(v) => { setFirm({ ...firm, descriptionSpoken: v }); touch(); }}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <Field
              label="Extra guidance on names (optional)"
              multiline
              value={nameGuidance}
              onChange={(v) => { setNameGuidance(v); touch(); }}
            />
            <span style={{ display: "block", fontSize: 11.5, color: C.faint, marginTop: 4 }}>
              For names that sound alike. Shared surnames such as Patel are handled automatically
              &mdash; Amy always asks which one.
            </span>
          </div>
        </div>
      ) : null}

      {/* -------------------------------------------------------- locked */}
      <div style={{ ...card, background: "transparent" }}>
        <h2 style={{ ...sectionTitle, fontSize: 15 }}>Fixed in code, not editable here</h2>
        <p style={{ ...hint, margin: "8px 0 0" }}>
          Her rules &mdash; no legal advice, no fees, never confirming who is a client &mdash; the
          client account script and bank-fraud warning, the whisper to staff and the keypress
          before connecting, ring and decision times, and urgency triggers. A wrong edit to any of
          these could cost a client money or breach confidentiality, so changing them is a code
          change. Opening hours are on their own page.
        </p>
        <button style={{ ...btn(), marginTop: 12 }} onClick={togglePrompt}>
          {prompt ? "Hide her instructions" : "View her instructions as saved"}
        </button>
        {prompt ? (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: C.well,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: 14,
              fontSize: 12,
              lineHeight: 1.55,
              color: C.dim,
              marginTop: 12,
              maxHeight: 480,
              overflow: "auto",
            }}
          >
            {prompt}
          </pre>
        ) : null}
      </div>

      {/* ----------------------------------------------------- save bar */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: C.ink,
          borderTop: `1px solid ${C.border}`,
          padding: "14px 0",
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button style={btn("primary")} onClick={save} disabled={!!busy}>
          {busy === "saving"
            ? "Saving…"
            : busy === "publishing"
            ? "Publishing to Retell…"
            : "Save & publish"}
        </button>
        {dirty ? (
          <span style={{ fontSize: 12.5, color: C.brassText }}>
            Unsaved changes &mdash; Amy is still using the last published version.
          </span>
        ) : (
          <span style={{ fontSize: 12.5, color: C.faint }}>No unsaved changes.</span>
        )}
        {dirty ? (
          <button
            style={{ ...btn(), padding: "8px 12px", fontSize: 12.5 }}
            onClick={() => {
              if (window.confirm("Discard your unsaved changes?")) load();
            }}
            disabled={!!busy}
          >
            Discard changes
          </button>
        ) : null}
      </div>
    </main>
  );
}

const chip: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.dim,
  cursor: "pointer",
  fontSize: 12,
  padding: "0 3px",
};

function Field(props: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <label style={lbl}>{props.label}</label>
      {props.multiline ? (
        <textarea
          style={{ ...fld, fontSize: 13, minHeight: 72, resize: "vertical", lineHeight: 1.5 }}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input style={{ ...fld, fontSize: 13, padding: "8px 10px" }} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </div>
  );
}
