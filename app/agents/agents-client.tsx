"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { C, FONT_SERIF, numeric, pageSub, pageTitle } from "@/lib/ui";

type Agent = {
  agent_id: string;
  agent_name: string;
  voice_id: string;
  language: string;
  llm_id: string;
  engine_type: string;
};

type Detail = Agent & {
  model: string;
  general_prompt: string;
  begin_message: string;
  model_temperature: number | null;
  tool_names: string[];
  webhook_url: string;
};

type LogField = { name: string; description: string };
type CustomLog = {
  key: string;
  label: string;
  tab: string;
  description: string;
  fields: LogField[];
};

type Settings = {
  alertNumber: string;
  alertOnBook: boolean;
  alertOnLead: boolean;
  customLogs: CustomLog[];
  transferNumber: string;
  transferMode: string;
  transferNote: string;
  screenPrompt: string;
  screenRingSeconds: number;
  screenDecideSeconds: number;
  screenOnTimeout: string;
  summaryEmail: string;
  emailEveryCall: boolean;
  emailOnTransfer: boolean;
};

type Voice = {
  voice_id: string;
  voice_name: string;
  provider: string;
  gender: string;
  accent: string;
  preview_audio_url: string;
};

type Option = { id: string; label: string; group?: string };


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
const hint: React.CSSProperties = { fontSize: 12.5, color: C.faint, margin: "7px 0 0", lineHeight: 1.6 };

const btn = (kind: "primary" | "ghost" | "danger" = "ghost"): React.CSSProperties => ({
  background: kind === "primary" ? "linear-gradient(135deg,#4d7fe0,#8b5fd6)" : "transparent",
  border: kind === "primary" ? "none" : `1px solid ${C.border}`,
  color: kind === "primary" ? "#fff" : kind === "danger" ? C.red : C.text,
  borderRadius: 10,
  padding: "11px 20px",
  fontSize: 14,
  cursor: "pointer",
});

const BLANK = {
  agent_name: "",
  voice_id: "",
  language: "en-US",
  model: "gpt-4.1",
  general_prompt: "",
  begin_message: "",
  model_temperature: 0.6,
  llm_id: "",
  alert_number: "",
  alert_on_book: true,
  alert_on_lead: true,
  custom_logs: [] as CustomLog[],
  transfer_number: "",
  transfer_mode: "warm",
  transfer_note: "",
  screen_prompt: "",
  screen_ring_seconds: "25",
  screen_decide_seconds: "30",
  screen_on_timeout: "cancel",
  summary_email: "",
  email_every_call: false,
  email_on_transfer: true,
};

export default function AgentsClient() {
  const [authed, setAuthed] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [models, setModels] = useState<Option[]>([]);
  const [languages, setLanguages] = useState<Option[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteBad, setNoteBad] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState("");
  const [showClone, setShowClone] = useState(false);
  const [cloneMode, setCloneMode] = useState<"id" | "upload">("id");
  const [cloneName, setCloneName] = useState("");
  const [cloneVoiceId, setCloneVoiceId] = useState("");
  const [cloneOwnerId, setCloneOwnerId] = useState("");
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  const [cloning, setCloning] = useState(false);

  async function importById() {
    setCloning(true);
    setNote("");
    try {
      const json = await api("/api/voices/import", {
        method: "POST",
        body: JSON.stringify({
          provider_voice_id: cloneVoiceId.trim(),
          voice_name: cloneName.trim(),
          public_user_id: cloneOwnerId.trim(),
        }),
      });
      setNote(`"${cloneName.trim()}" added — pick it from the voice list below.`);
      setNoteBad(false);
      setCloneVoiceId("");
      setCloneName("");
      setShowClone(false);
      await load();
      if (json.voice?.voice_id) set("voice_id", json.voice.voice_id);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Import failed");
      setNoteBad(true);
    } finally {
      setCloning(false);
    }
  }

  async function cloneFromAudio() {
    if (cloneFiles.length === 0 || !cloneName.trim()) return;
    setCloning(true);
    setNote("");
    try {
      const form = new FormData();
      form.set("voice_name", cloneName.trim());
      cloneFiles.forEach((f) => form.append("files", f));

      const res = await fetch("/api/voices/clone", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Clone failed");

      setNote(`"${cloneName.trim()}" cloned — pick it from the voice list below.`);
      setNoteBad(false);
      setCloneFiles([]);
      setCloneName("");
      setShowClone(false);
      await load();
      if (json.voice?.voice_id) set("voice_id", json.voice.voice_id);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Clone failed");
      setNoteBad(true);
    } finally {
      setCloning(false);
    }
  }
  const [wiring, setWiring] = useState<{ tools: string[]; webhook: string } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

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
      const json = await api("/api/agents");
      setAgents(json.agents || []);
      setVoices(json.voices || []);
      setModels(json.models || []);
      setLanguages(json.languages || []);
      setBaseUrl(json.base_url || "");
      setAuthed(true);
      setActiveId((prev) => prev ?? json.agents?.[0]?.agent_id ?? null);
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

  const loadDetail = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const json = await api(`/api/agents/${id}`);
        const d: Detail = json.agent;
        const st: Settings | undefined = json.settings;
        setWiring({ tools: d.tool_names || [], webhook: d.webhook_url || "" });
        setForm({
          agent_name: d.agent_name,
          voice_id: d.voice_id,
          language: d.language || "en-US",
          model: d.model || "gpt-4.1",
          general_prompt: d.general_prompt,
          begin_message: d.begin_message,
          model_temperature: d.model_temperature ?? 0.6,
          llm_id: d.llm_id,
          alert_number: st?.alertNumber || "",
          alert_on_book: st?.alertOnBook !== false,
          alert_on_lead: st?.alertOnLead !== false,
          custom_logs: st?.customLogs || [],
          transfer_number: st?.transferNumber || "",
          transfer_mode: st?.transferMode || "warm",
          transfer_note: st?.transferNote || "",
          screen_prompt: st?.screenPrompt || "",
          screen_ring_seconds: String(st?.screenRingSeconds ?? 25),
          screen_decide_seconds: String(st?.screenDecideSeconds ?? 30),
          screen_on_timeout: st?.screenOnTimeout || "cancel",
          summary_email: st?.summaryEmail || "",
          email_every_call: st?.emailEveryCall === true,
          email_on_transfer: st?.emailOnTransfer !== false,
        });
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Failed to load agent");
        setNoteBad(true);
      } finally {
        setBusy(false);
      }
    },
    [api]
  );

  useEffect(() => {
    if (authed && activeId && !creating) loadDetail(activeId);
  }, [authed, activeId, creating, loadDetail]);

  useEffect(() => {
    if (creating) {
      setForm({ ...BLANK, voice_id: voices[0]?.voice_id || "" });
      setWiring(null);
    }
  }, [creating, voices]);

  function set<K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const grouped = useMemo(() => {
    const out: Record<string, Option[]> = {};
    for (const m of models) {
      const g = m.group || "Models";
      (out[g] ||= []).push(m);
    }
    return out;
  }, [models]);

  const shownVoices = useMemo(() => {
    const q = voiceFilter.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter((v) =>
      `${v.voice_name} ${v.provider} ${v.accent} ${v.gender}`.toLowerCase().includes(q)
    );
  }, [voices, voiceFilter]);

  function updateLog(i: number, patch: Partial<CustomLog>) {
    const next = [...form.custom_logs];
    next[i] = { ...next[i], ...patch };
    set("custom_logs", next);
  }

  function addLog() {
    set("custom_logs", [
      ...form.custom_logs,
      { key: "", label: "", tab: "", description: "", fields: [{ name: "", description: "" }] },
    ]);
  }

  function removeLog(i: number) {
    set("custom_logs", form.custom_logs.filter((_, idx) => idx !== i));
  }

  function updateField(logIndex: number, fieldIndex: number, patch: Partial<LogField>) {
    const fields = [...form.custom_logs[logIndex].fields];
    fields[fieldIndex] = { ...fields[fieldIndex], ...patch };
    updateLog(logIndex, { fields });
  }

  const selectedVoice = voices.find((v) => v.voice_id === form.voice_id);

  // Two logs with the same name collapse into one tool, because the tool name
  // is derived from the log name. Saving would silently drop the second one,
  // so say so before they press Save rather than after.
  const tabClash = (() => {
    const seen = new Set<string>();
    for (const log of form.custom_logs) {
      const key = (log.label || "").trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) return `Two logs are both called "${log.label.trim()}" — rename one`;
      seen.add(key);
    }
    return "";
  })();
  const isRealtime = form.model.startsWith("gpt-realtime");

  async function save() {
    setBusy(true);
    setNote("");
    try {
      if (creating) {
        const json = await api("/api/agents", { method: "POST", body: JSON.stringify(form) });
        setCreating(false);
        setActiveId(json.agent_id);
        setNote("Agent created.");
      } else if (activeId) {
        await api(`/api/agents/${activeId}`, { method: "PATCH", body: JSON.stringify(form) });
        setNote("Saved.");
      }
      setNoteBad(false);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Save failed");
      setNoteBad(true);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!activeId) return;
    setBusy(true);
    try {
      await api(`/api/agents/${activeId}`, { method: "DELETE" });
      setActiveId(null);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Delete failed");
      setNoteBad(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 940, padding: "40px 32px 80px" }}>
      <h1 style={pageTitle}>
        AI Agents
      </h1>
      <p style={{ color: C.dim, marginTop: 0, fontSize: 14.5, lineHeight: 1.6 }}>
        Create as many agents as you like — assign them to phone numbers and campaigns.
      </p>

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "26px 0 20px" }}>
        {agents.map((a) => {
          const on = a.agent_id === activeId && !creating;
          return (
            <button
              key={a.agent_id}
              onClick={() => {
                setActiveId(a.agent_id);
                setCreating(false);
              }}
              style={{
                background: on ? "linear-gradient(135deg,#4d7fe0,#8b5fd6)" : C.slate,
                border: on ? "none" : `1px solid ${C.border}`,
                color: on ? "#fff" : C.dim,
                borderRadius: 11,
                padding: "10px 17px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {a.agent_name}
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
          + New agent
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

      {!activeId && !creating ? (
        <p style={{ color: C.faint, fontSize: 14 }}>No agents yet — create one to get started.</p>
      ) : null}

      {activeId || creating ? (
        <div style={panel}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 18 }}>
            <div>
              <span style={lbl}>Agent name</span>
              <input
                style={fld}
                value={form.agent_name}
                onChange={(e) => set("agent_name", e.target.value)}
                placeholder="Front desk"
              />
            </div>

            <div>
              <span style={lbl}>Language</span>
              <select
                style={fld}
                value={form.language}
                onChange={(e) => set("language", e.target.value)}
              >
                {languages.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p style={hint}>
                {languages.length} options. &quot;Multilingual&quot; lets one agent switch language
                mid-call.
              </p>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <span style={lbl}>Model</span>
            <select style={fld} value={form.model} onChange={(e) => set("model", e.target.value)}>
              {Object.entries(grouped).map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p style={hint}>
              {models.length} models available. Smaller ones respond faster, which matters more on a
              phone call than raw capability.
            </p>
            {isRealtime ? (
              <p style={{ ...hint, color: C.brassText }}>
                Realtime models are speech-to-speech — they handle their own voice, so the voice
                setting below has no effect.
              </p>
            ) : null}
          </div>

          <div style={{ marginTop: 18 }}>
            <span style={lbl}>Creativity (temperature): {form.model_temperature.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={form.model_temperature}
              onChange={(e) => set("model_temperature", Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.faint }}>
              <span>Focused</span>
              <span>Creative</span>
            </div>
          </div>

          <div style={{ marginTop: 22, opacity: isRealtime ? 0.5 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <span style={lbl}>Voice</span>
              <button
                onClick={() => setShowClone(!showClone)}
                style={{ ...btn(showClone ? "primary" : "ghost"), marginLeft: "auto", fontSize: 12.5, padding: "6px 12px" }}
                type="button"
                disabled={isRealtime}
              >
                {showClone ? "Cancel" : "+ Add cloned voice"}
              </button>
            </div>

            {showClone ? (
              <div
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 11,
                  padding: "16px 18px",
                  marginBottom: 16,
                  background: "#0e1217",
                }}
              >
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <button
                    onClick={() => setCloneMode("id")}
                    style={{ ...btn(cloneMode === "id" ? "primary" : "ghost"), fontSize: 12.5, padding: "7px 13px" }}
                    type="button"
                  >
                    Already have a voice ID
                  </button>
                  <button
                    onClick={() => setCloneMode("upload")}
                    style={{ ...btn(cloneMode === "upload" ? "primary" : "ghost"), fontSize: 12.5, padding: "7px 13px" }}
                    type="button"
                  >
                    Upload audio to clone
                  </button>
                </div>

                <div>
                  <span style={lbl}>Name this voice</span>
                  <input
                    style={fld}
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    placeholder="Sarah — client's own voice"
                  />
                </div>

                {cloneMode === "id" ? (
                  <>
                    <p style={{ ...hint, marginTop: 12, marginBottom: 0 }}>
                      Paste the Voice ID from ElevenLabs &mdash; on the voice&apos;s page, or via
                      Copy voice ID in the Voice Library. No ElevenLabs API key needed; Retell
                      fetches it directly.
                    </p>
                    <div style={{ marginTop: 10 }}>
                      <span style={lbl}>ElevenLabs voice ID</span>
                      <input
                        style={fld}
                        value={cloneVoiceId}
                        onChange={(e) => setCloneVoiceId(e.target.value)}
                        placeholder="21m00Tcm4TlvDq8ikWAM"
                      />
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <span style={lbl}>ElevenLabs owner ID (only for a private voice)</span>
                      <input
                        style={fld}
                        value={cloneOwnerId}
                        onChange={(e) => setCloneOwnerId(e.target.value)}
                        placeholder="Leave blank for a public voice"
                      />
                    </div>
                    <button
                      style={{ ...btn("primary"), marginTop: 14 }}
                      onClick={importById}
                      disabled={cloning || !cloneVoiceId.trim() || !cloneName.trim()}
                      type="button"
                    >
                      {cloning ? "Adding…" : "Add voice"}
                    </button>
                  </>
                ) : (
                  <>
                    <p style={{ ...hint, marginTop: 12, marginBottom: 0 }}>
                      Retell clones the voice for you from the audio &mdash; no ElevenLabs account
                      needed. Clean audio, a minute or more, with no background noise or music,
                      clones best.
                    </p>
                    <div style={{ marginTop: 10 }}>
                      <span style={lbl}>Audio files (up to 25, 25MB each)</span>
                      <input
                        type="file"
                        accept="audio/*"
                        multiple
                        onChange={(e) => setCloneFiles(Array.from(e.target.files || []))}
                        style={{ ...fld, padding: "9px 12px", cursor: "pointer" }}
                      />
                      {cloneFiles.length > 0 ? (
                        <p style={{ ...hint, marginTop: 8 }}>
                          {cloneFiles.length} file{cloneFiles.length > 1 ? "s" : ""} selected
                          {" — "}
                          {(cloneFiles.reduce((n, f) => n + f.size, 0) / 1_000_000).toFixed(1)} MB
                          total
                        </p>
                      ) : null}
                    </div>
                    <button
                      style={{ ...btn("primary"), marginTop: 14 }}
                      onClick={cloneFromAudio}
                      disabled={cloning || cloneFiles.length === 0 || !cloneName.trim()}
                      type="button"
                    >
                      {cloning ? "Cloning… this can take a moment" : "Clone voice"}
                    </button>
                  </>
                )}

                <p style={{ ...hint, marginTop: 12, marginBottom: 0, color: C.oxbloodText }}>
                  Only clone a voice with the speaker&apos;s explicit consent. Retell&apos;s limit
                  is 100 custom voices per account.
                </p>
              </div>
            ) : null}

            <input
              style={{ ...fld, marginBottom: 8 }}
              value={voiceFilter}
              onChange={(e) => setVoiceFilter(e.target.value)}
              placeholder="Filter by name, accent, provider…"
            />
            <select style={fld} value={form.voice_id} onChange={(e) => set("voice_id", e.target.value)}>
              <option value="">Select a voice</option>
              {shownVoices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.voice_name}
                  {v.accent ? ` · ${v.accent}` : ""}
                  {v.gender ? ` · ${v.gender}` : ""} · {v.provider}
                </option>
              ))}
            </select>
            <p style={hint}>
              {voices.length} voices in your Retell account
              {voiceFilter ? ` · ${shownVoices.length} matching` : ""}.
            </p>
            {selectedVoice?.preview_audio_url ? (
              <audio
                key={selectedVoice.voice_id}
                controls
                src={selectedVoice.preview_audio_url}
                style={{ width: "100%", marginTop: 10, height: 36 }}
              />
            ) : null}
          </div>

          <div style={{ marginTop: 22 }}>
            <span style={lbl}>Greeting (first message)</span>
            <textarea
              style={{ ...fld, minHeight: 70, resize: "vertical" }}
              value={form.begin_message}
              onChange={(e) => set("begin_message", e.target.value)}
              placeholder="Hi, this is Sarah from Acme Clinic. How can I help?"
            />
            <p style={hint}>
              Leave empty and the agent waits for the caller to speak first — better for inbound,
              worse for outbound.
            </p>
          </div>

          <div style={{ marginTop: 20 }}>
            <span style={lbl}>Instructions (system prompt)</span>
            <textarea
              style={{ ...fld, minHeight: 220, resize: "vertical", lineHeight: 1.65 }}
              value={form.general_prompt}
              onChange={(e) => set("general_prompt", e.target.value)}
              placeholder={"## Identity\nYou are Sarah, the front desk assistant for Acme Clinic.\n\n## Style\nWarm and efficient. One or two short sentences at a time.\n\n## Task\n1. Greet the caller and ask how you can help.\n…"}
            />
            <p style={hint}>
              {form.general_prompt.length} characters. Structure it with headings — Identity, Style,
              Task, Rules — rather than one long paragraph.
            </p>
          </div>

          <div style={{ marginTop: 24, paddingTop: 22, borderTop: `1px solid ${C.border}` }}>
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Transfer to a human</div>
              <p style={{ ...hint, marginTop: 0, marginBottom: 14 }}>
                Gives the agent a transfer_to_team tool. Leave the number blank and the tool
                isn&apos;t created &mdash; so don&apos;t promise a handover in the prompt without
                setting one here.
              </p>
              <div
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 14 }}
              >
                <div>
                  <span style={lbl}>Transfer to</span>
                  <input
                    style={fld}
                    value={form.transfer_number}
                    onChange={(e) => set("transfer_number", e.target.value)}
                    placeholder="+442012345678"
                  />
                </div>
                <div>
                  <span style={lbl}>Transfer type</span>
                  <select
                    style={fld}
                    value={form.transfer_mode}
                    onChange={(e) => set("transfer_mode", e.target.value)}
                  >
                    <option value="screen">Screened — ask first, press 1 to accept</option>
                    <option value="warm">Warm — brief the colleague first</option>
                    <option value="cold">Cold — forward immediately</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <span style={lbl}>When should the agent transfer?</span>
                <input
                  style={fld}
                  value={form.transfer_note}
                  onChange={(e) => set("transfer_note", e.target.value)}
                  placeholder="Complaints, damaged deliveries, cancellations, weddings and funerals, or whenever the caller asks for a person."
                />
              </div>
              <p style={{ ...hint, marginTop: 10 }}>
                {form.transfer_mode === "screen"
                  ? "Screened: the caller waits on hold while we ring your number and say who's calling and what it's about. Press 1 to take it, 2 to decline — or just answer out loud. Decline and the caller is told why, then carries on with the AI."
                  : form.transfer_mode === "warm"
                  ? "Warm: the caller waits on hold while the agent rings your team and summarises who's on the line. Whoever answers gets the call either way — there's no chance to decline."
                  : "Cold: the call is forwarded straight through. Faster, but whoever answers has no idea who is calling or why."}
              </p>

              {form.transfer_mode === "screen" && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 8,
                    background: C.well,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(170px,1fr))",
                      gap: 14,
                    }}
                  >
                    <div>
                      <span style={lbl}>Ring for (seconds)</span>
                      <input
                        style={fld}
                        type="number"
                        min={10}
                        max={120}
                        value={form.screen_ring_seconds}
                        onChange={(e) => set("screen_ring_seconds", e.target.value)}
                      />
                    </div>
                    <div>
                      <span style={lbl}>Decide within (seconds)</span>
                      <input
                        style={fld}
                        type="number"
                        min={10}
                        max={120}
                        value={form.screen_decide_seconds}
                        onChange={(e) => set("screen_decide_seconds", e.target.value)}
                      />
                    </div>
                    <div>
                      <span style={lbl}>If nobody decides</span>
                      <select
                        style={fld}
                        value={form.screen_on_timeout}
                        onChange={(e) => set("screen_on_timeout", e.target.value)}
                      >
                        <option value="cancel">Don&apos;t connect</option>
                        <option value="bridge">Connect anyway</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <span style={lbl}>Screening script (optional)</span>
                    <textarea
                      style={{ ...fld, minHeight: 90, fontFamily: "inherit", resize: "vertical" }}
                      value={form.screen_prompt}
                      onChange={(e) => set("screen_prompt", e.target.value)}
                      placeholder="Leave blank to use the built-in script — it already states the caller's name and reason, offers press 1 / press 2, and asks for a reason when declined."
                    />
                  </div>

                  <p style={{ ...hint, marginTop: 10, marginBottom: 0 }}>
                    Saving creates a second agent in Retell called
                    &ldquo;{(form.agent_name || "Agent").trim()} &mdash; screener&rdquo;. That&apos;s
                    the one that rings you and asks &mdash; leave it alone in the Retell dashboard.
                    It uses this agent&apos;s voice and language.
                  </p>
                </div>
              )}
            </div>

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
                Email call summaries
              </div>
              <p style={{ ...hint, marginTop: 0, marginBottom: 14 }}>
                Sends the summary, outcome and full transcript after each call. Needs SMTP_USER and
                SMTP_PASSWORD set in the environment &mdash; a Gmail app password works.
              </p>
              <div>
                <span style={lbl}>Send summaries to</span>
                <input
                  style={fld}
                  value={form.summary_email}
                  onChange={(e) => set("summary_email", e.target.value)}
                  placeholder="owner@gmail.com, manager@gmail.com"
                />
              </div>
              <label
                style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 14 }}
              >
                <input
                  type="checkbox"
                  checked={form.email_on_transfer}
                  onChange={(e) => set("email_on_transfer", e.target.checked)}
                />
                Email when a caller asked for a human
              </label>
              <label
                style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 14 }}
              >
                <input
                  type="checkbox"
                  checked={form.email_every_call}
                  onChange={(e) => set("email_every_call", e.target.checked)}
                />
                Email every single call
              </label>
              <p style={{ ...hint, marginTop: 10 }}>
                Leave &ldquo;every single call&rdquo; off unless the client asks for it. On a busy
                line it becomes noise within a week and then nobody reads the ones that matter.
              </p>
            </div>

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Custom logs</div>
              <p style={{ ...hint, marginTop: 0, marginBottom: 14 }}>
                Add your own tabs beyond Leads, Bookings and Calls. Each one becomes a tool the
                agent can call during a conversation, with exactly the fields you define.
              </p>

              {form.custom_logs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 11,
                    padding: "16px 18px",
                    marginBottom: 12,
                    background: "#0e1217",
                  }}
                >
                  <div
                    style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}
                  >
                    <div>
                      <span style={lbl}>Name</span>
                      <input
                        style={fld}
                        value={log.label}
                        onChange={(e) => updateLog(i, { label: e.target.value })}
                        placeholder="Complaint"
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <span style={lbl}>When should the agent use this?</span>
                    <input
                      style={fld}
                      value={log.description}
                      onChange={(e) => updateLog(i, { description: e.target.value })}
                      placeholder="Record a complaint when the caller raises a problem with an existing service."
                    />
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <span style={lbl}>Columns</span>
                    {log.fields.map((f, fi) => (
                      <div key={fi} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input
                          style={{ ...fld, maxWidth: 170 }}
                          value={f.name}
                          onChange={(e) => updateField(i, fi, { name: e.target.value })}
                          placeholder="issue"
                        />
                        <input
                          style={fld}
                          value={f.description}
                          onChange={(e) => updateField(i, fi, { description: e.target.value })}
                          placeholder="What the caller is unhappy about"
                        />
                        <button
                          onClick={() =>
                            updateLog(i, { fields: log.fields.filter((_, x) => x !== fi) })
                          }
                          style={{ ...btn(), padding: "8px 12px", color: C.red }}
                          type="button"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        updateLog(i, { fields: [...log.fields, { name: "", description: "" }] })
                      }
                      style={{ ...btn(), fontSize: 12.5, padding: "7px 13px" }}
                      type="button"
                    >
                      + Column
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
                    <span style={{ fontSize: 12, color: C.faint }}>
                      tool: log_{(log.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "…"}
                      {" · header: "}
                      Timestamp, {log.fields.map((f) => f.name || "…").join(", ")}, Call ID
                    </span>
                    <button
                      onClick={() => removeLog(i)}
                      style={{ ...btn("danger"), marginLeft: "auto", fontSize: 12.5, padding: "7px 13px" }}
                      type="button"
                    >
                      Delete log
                    </button>
                  </div>
                </div>
              ))}

              <button onClick={addLog} style={{ ...btn(), fontSize: 13 }} type="button">
                + Add a custom log
              </button>
            </div>

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Text alerts</div>
              <p style={{ ...hint, marginTop: 0, marginBottom: 12 }}>
                Sent by SMS from your Twilio number the moment something worth acting on happens.
              </p>
              <div style={{ maxWidth: 300 }}>
                <span style={lbl}>Send alerts to</span>
                <input
                  style={fld}
                  value={form.alert_number}
                  onChange={(e) => set("alert_number", e.target.value)}
                  placeholder="+447700900123"
                />
              </div>
              <label
                style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14, fontSize: 14, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={form.alert_on_lead}
                  onChange={(e) => set("alert_on_lead", e.target.checked)}
                />
                Text me when the agent finds an interested lead
              </label>
              <label
                style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 9, fontSize: 14, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={form.alert_on_book}
                  onChange={(e) => set("alert_on_book", e.target.checked)}
                />
                Text me when an appointment is booked
              </label>
              <p style={{ ...hint, marginTop: 10 }}>
                Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM set in the
                environment. The sending number must be SMS-capable — most UK landline numbers
                are not, so use a mobile or a short code.
              </p>
            </div>
          </div>

          {!creating && wiring ? (
            <div
              style={{
                marginTop: 20,
                padding: "14px 16px",
                borderRadius: 11,
                border: `1px solid ${wiring.tools.length >= 3 && wiring.webhook ? C.border : C.oxbloodText}`,
                background: "#0e1217",
              }}
            >
              <div style={{ fontSize: 13.5, marginBottom: 6 }}>
                {wiring.tools.length >= 3 && wiring.webhook ? (
                  <span style={{ color: C.green }}>Tools and webhook attached</span>
                ) : (
                  <span style={{ color: C.oxbloodText }}>
                    This agent is missing its tools or webhook — press Save to attach them
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: C.faint, lineHeight: 1.7 }}>
                functions: {wiring.tools.length ? wiring.tools.join(", ") : "none"}
                <br />
                webhook: {wiring.webhook || "not set"}
              </p>
            </div>
          ) : null}

          {!baseUrl ? (
            <p style={{ ...hint, color: C.oxbloodText, marginTop: 12 }}>
              APP_BASE_URL is not set, so tools can&apos;t be attached. Add it in Vercel as your full
              https URL and redeploy.
            </p>
          ) : null}

          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 20,
              paddingTop: 22,
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <button
              style={btn("primary")}
              onClick={save}
              disabled={busy || !form.agent_name || (!form.voice_id && !isRealtime) || Boolean(tabClash)}
            >
              {busy ? "Saving…" : creating ? "Create agent" : "Save agent"}
            </button>
            {!creating && activeId ? (
              <>
                <span style={{ fontSize: 12.5, color: C.faint, fontFamily: "ui-monospace, monospace" }}>
                  {activeId}
                </span>
                <button style={{ ...btn("danger"), marginLeft: "auto" }} onClick={remove} disabled={busy}>
                  Delete
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
