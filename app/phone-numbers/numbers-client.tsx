"use client";

import { useCallback, useEffect, useState } from "react";
import { C, FONT_SERIF, numeric, pageSub, pageTitle } from "@/lib/ui";

type RetellNumber = {
  phone_number: string;
  nickname: string;
  type: string;
  inbound_agent_id: string;
  outbound_agent_id: string;
};

type Agent = { agent_id: string; agent_name: string };

type TrunkCheck = {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  fix?: string;
};

type Diagnosis = {
  account_name: string;
  phone_number: string;
  termination_uri: string;
  trunk_sid: string | null;
  trunk_name: string | null;
  checks: TrunkCheck[];
  inbound_ready: boolean;
  repairable: boolean;
  candidate_trunks: { sid: string; friendly_name: string; domain_name: string }[];
  steps?: string[];
};

const DOT: Record<TrunkCheck["status"], string> = {
  pass: C.green,
  warn: C.brass,
  fail: C.red,
};


const card: React.CSSProperties = {
  background: C.slate,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: "18px 20px",
  marginBottom: 16,
};

const field: React.CSSProperties = {
  width: "100%",
  background: C.well,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.text,
  padding: "9px 11px",
  fontSize: 13,
  boxSizing: "border-box",
};

const lbl: React.CSSProperties = { display: "block", fontSize: 12, color: C.dim, marginBottom: 5 };

const btn = (active = false): React.CSSProperties => ({
  background: active ? "#1b2b45" : "transparent",
  border: `1px solid ${C.border}`,
  color: active ? C.brassText : C.text,
  borderRadius: 8,
  padding: "8px 15px",
  fontSize: 13,
  cursor: "pointer",
});

export default function NumbersClient() {
  const [authed, setAuthed] = useState(false);
  const [numbers, setNumbers] = useState<RetellNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteBad, setNoteBad] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [mode, setMode] = useState<"auto" | "sip">("auto");
  const [acctSid, setAcctSid] = useState("");
  const [acctToken, setAcctToken] = useState("");
  const [steps, setSteps] = useState<string[]>([]);

  const [phone, setPhone] = useState("");
  const [termUri, setTermUri] = useState("");
  const [sipUser, setSipUser] = useState("");
  const [sipPass, setSipPass] = useState("");
  const [nickname, setNickname] = useState("");
  const [inboundAgent, setInboundAgent] = useState("");
  const [outboundAgent, setOutboundAgent] = useState("");

  // Inbound diagnostics, scoped to one number at a time.
  const [checkFor, setCheckFor] = useState("");
  const [checkSid, setCheckSid] = useState("");
  const [checkToken, setCheckToken] = useState("");
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkErr, setCheckErr] = useState("");
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [trunkPick, setTrunkPick] = useState("");

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
    setNote("");
    try {
      const json = await api("/api/phone-numbers");
      setNumbers(json.numbers || []);
      setAgents(json.agents || []);
      setAuthed(true);
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

  async function doAutoImport() {
    setBusy(true);
    setNote("");
    setSteps([]);
    try {
      const json = await api("/api/phone-numbers/twilio", {
        method: "POST",
        body: JSON.stringify({
          account_sid: acctSid.trim(),
          auth_token: acctToken.trim(),
          phone_number: phone.trim(),
          label: nickname,
          inbound_agent_id: inboundAgent,
          outbound_agent_id: outboundAgent,
        }),
      });
      setSteps(json.steps || []);
      setNote(
        `${phone.trim()} is connected. Re-running this is safe — it refreshes the trunk and credentials rather than duplicating anything. Place one test call before using it in a campaign.`
      );
      setNoteBad(false);
      setPhone("");
      setAcctToken("");
      setNickname("");
      setShowImport(false);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Setup failed");
      setNoteBad(true);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    setNote("");
    try {
      await api("/api/phone-numbers", {
        method: "POST",
        body: JSON.stringify({
          phone_number: phone.trim(),
          termination_uri: termUri.trim(),
          sip_username: sipUser,
          sip_password: sipPass,
          nickname,
          inbound_agent_id: inboundAgent,
          outbound_agent_id: outboundAgent,
        }),
      });
      setNote(`${phone.trim()} imported. Place one test call before using it in a campaign.`);
      setNoteBad(false);
      setPhone("");
      setSipPass("");
      setNickname("");
      setShowImport(false);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Import failed");
      setNoteBad(true);
    } finally {
      setBusy(false);
    }
  }

  function openCheck(number: string) {
    const same = checkFor === number;
    setCheckFor(same ? "" : number);
    setDiag(null);
    setCheckErr("");
    setTrunkPick("");
    // The Account SID is the same for every number in the account, so carrying
    // it over saves retyping it. The token is deliberately not carried over.
    setCheckToken("");
  }

  async function runCheck(number: string, shouldRepair: boolean) {
    setCheckBusy(true);
    setCheckErr("");
    try {
      const json = await api("/api/phone-numbers/twilio/check", {
        method: "POST",
        body: JSON.stringify({
          account_sid: checkSid.trim(),
          auth_token: checkToken.trim(),
          phone_number: number,
          repair: shouldRepair,
          trunk_sid: trunkPick,
        }),
      });
      setDiag(json as Diagnosis);
    } catch (err) {
      setCheckErr(err instanceof Error ? err.message : "Check failed");
      setDiag(null);
    } finally {
      setCheckBusy(false);
    }
  }

  async function remove(number: string) {
    setBusy(true);
    try {
      await api(`/api/phone-numbers/${encodeURIComponent(number)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Delete failed");
      setNoteBad(true);
    } finally {
      setBusy(false);
    }
  }

  const uriLooksOff = termUri.trim().length > 0 && !termUri.includes("pstn.twilio.com");

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "48px 20px 80px" }}>
      <h1 style={pageTitle}>Phone numbers</h1>
      <p style={{ color: C.dim, marginTop: 0, fontSize: 14, lineHeight: 1.6 }}>
        Import a Twilio number into Retell through your elastic SIP trunk, and bind it to an agent.
        SIP credentials pass straight through to Retell &mdash; nothing is stored here.
      </p>


      {note ? (
        <div style={{ ...card, borderColor: noteBad ? C.red : C.green }}>
          <p style={{ margin: 0, fontSize: 13, color: noteBad ? C.red : C.green, lineHeight: 1.6 }}>
            {note}
          </p>
        </div>
      ) : null}

      {authed ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button style={btn(showImport)} onClick={() => setShowImport(!showImport)}>
              {showImport ? "Cancel" : "Import Twilio number"}
            </button>
            <button style={btn()} onClick={load} disabled={busy}>
              Refresh
            </button>
          </div>

          {showImport ? (
            <div style={card}>
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <button style={btn(mode === "auto")} onClick={() => setMode("auto")}>
                  Bring your own (Twilio)
                </button>
                <button style={btn(mode === "sip")} onClick={() => setMode("sip")}>
                  Advanced (manual SIP)
                </button>
              </div>

              {mode === "auto" ? (
                <p style={{ fontSize: 12.5, color: C.faint, margin: "0 0 16px", lineHeight: 1.6 }}>
                  Paste your Twilio SID and Auth Token and the SIP trunk gets built for you &mdash;
                  trunk, credentials, origination and number attachment. Credentials are used once
                  and never stored.
                </p>
              ) : (
                <p style={{ fontSize: 12.5, color: C.faint, margin: "0 0 16px", lineHeight: 1.6 }}>
                  Use this if you already have a trunk, or your client won&apos;t share API
                  credentials.
                </p>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <span style={lbl}>Phone number (E.164)</span>
                  <input
                    style={field}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+14157774444"
                  />
                </div>
                <div>
                  <span style={lbl}>Nickname (optional)</span>
                  <input
                    style={field}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Client main line"
                  />
                </div>
              </div>

              {mode === "auto" ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 14,
                    marginTop: 14,
                  }}
                >
                  <div>
                    <span style={lbl}>Twilio Account SID</span>
                    <input
                      style={field}
                      value={acctSid}
                      onChange={(e) => setAcctSid(e.target.value)}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                  </div>
                  <div>
                    <span style={lbl}>Twilio Auth Token</span>
                    <input
                      style={field}
                      type="password"
                      value={acctToken}
                      onChange={(e) => setAcctToken(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: 14, display: mode === "sip" ? "block" : "none" }}>
                <span style={lbl}>Termination URI</span>
                <input
                  style={field}
                  value={termUri}
                  onChange={(e) => setTermUri(e.target.value)}
                  placeholder="your-trunk.pstn.twilio.com"
                />
                {uriLooksOff ? (
                  <p style={{ fontSize: 12, color: C.oxbloodText, margin: "8px 0 0", lineHeight: 1.6 }}>
                    Twilio termination URIs end in .pstn.twilio.com &mdash; check you copied the
                    Termination SIP URI from the trunk, not the origination URI.
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: C.faint, margin: "8px 0 0", lineHeight: 1.6 }}>
                    Twilio console &rarr; Elastic SIP Trunking &rarr; your trunk &rarr; Termination.
                  </p>
                )}
              </div>

              <div
                style={{
                  display: mode === "sip" ? "grid" : "none",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 14,
                  marginTop: 14,
                }}
              >
                <div>
                  <span style={lbl}>SIP username</span>
                  <input style={field} value={sipUser} onChange={(e) => setSipUser(e.target.value)} />
                </div>
                <div>
                  <span style={lbl}>SIP password</span>
                  <input
                    style={field}
                    type="password"
                    value={sipPass}
                    onChange={(e) => setSipPass(e.target.value)}
                  />
                </div>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: C.faint,
                  margin: "8px 0 0",
                  lineHeight: 1.6,
                  display: mode === "sip" ? "block" : "none",
                }}
              >
                From the credential list on your trunk. Retell also publishes a SIP SBC block
                (18.98.16.120/30) if you prefer IP allowlisting.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 14,
                  marginTop: 14,
                }}
              >
                <div>
                  <span style={lbl}>Inbound agent</span>
                  <select
                    style={field}
                    value={inboundAgent}
                    onChange={(e) => setInboundAgent(e.target.value)}
                  >
                    <option value="">None</option>
                    {agents.map((a) => (
                      <option key={a.agent_id} value={a.agent_id}>
                        {a.agent_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span style={lbl}>Outbound agent</span>
                  <select
                    style={field}
                    value={outboundAgent}
                    onChange={(e) => setOutboundAgent(e.target.value)}
                  >
                    <option value="">None</option>
                    {agents.map((a) => (
                      <option key={a.agent_id} value={a.agent_id}>
                        {a.agent_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {mode === "auto" ? (
                <button
                  style={{ ...btn(true), marginTop: 18 }}
                  onClick={doAutoImport}
                  disabled={busy || !phone.trim() || !acctSid.trim() || !acctToken.trim()}
                >
                  {busy ? "Setting up…" : "Attach number"}
                </button>
              ) : (
                <button
                  style={{ ...btn(true), marginTop: 18 }}
                  onClick={doImport}
                  disabled={busy || !phone.trim() || !termUri.trim()}
                >
                  {busy ? "Importing…" : "Import"}
                </button>
              )}

              {steps.length > 0 ? (
                <ul
                  style={{
                    margin: "16px 0 0",
                    padding: "0 0 0 18px",
                    fontSize: 12.5,
                    color: C.dim,
                    lineHeight: 1.9,
                  }}
                >
                  {steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {numbers.length === 0 ? (
            <p style={{ color: C.faint, fontSize: 14 }}>No numbers in this Retell account yet.</p>
          ) : null}

          {numbers.map((n) => (
            <div key={n.phone_number} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 500, fontFamily: "ui-monospace, monospace" }}>
                  {n.phone_number}
                </span>
                {n.nickname ? (
                  <span style={{ fontSize: 13, color: C.dim }}>{n.nickname}</span>
                ) : null}
                <span style={{ fontSize: 12, color: C.faint }}>{n.type}</span>
                <button
                  style={{ ...btn(checkFor === n.phone_number), marginLeft: "auto" }}
                  onClick={() => openCheck(n.phone_number)}
                  disabled={busy}
                >
                  Inbound check
                </button>
                <button
                  style={{ ...btn(), color: C.red }}
                  onClick={() => remove(n.phone_number)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
              <p style={{ fontSize: 12, color: C.faint, margin: "10px 0 0", lineHeight: 1.7 }}>
                inbound: {n.inbound_agent_id || "not bound"}
                <br />
                outbound: {n.outbound_agent_id || "not bound"}
              </p>
              {!n.outbound_agent_id ? (
                <p style={{ fontSize: 12, color: C.oxbloodText, margin: "8px 0 0", lineHeight: 1.6 }}>
                  No outbound agent bound &mdash; campaigns using this number will fail.
                </p>
              ) : null}

              {checkFor === n.phone_number ? (
                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: `1px solid ${C.hairline}`,
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 14px",
                      fontSize: 12.5,
                      color: C.dim,
                      lineHeight: 1.7,
                      maxWidth: "62ch",
                    }}
                  >
                    Importing a number sets up outbound calling only. Inbound is configured on the
                    Twilio trunk, and when it&apos;s wrong the caller hears nothing and no call
                    appears in Retell at all. This reads the live trunk and can fix it. Credentials
                    are used for the request and never stored.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div>
                      <label style={lbl}>Account SID</label>
                      <input
                        style={field}
                        value={checkSid}
                        onChange={(e) => setCheckSid(e.target.value)}
                        placeholder="AC…"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label style={lbl}>Auth Token</label>
                      <input
                        style={field}
                        type="password"
                        value={checkToken}
                        onChange={(e) => setCheckToken(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <button
                      style={btn(true)}
                      onClick={() => runCheck(n.phone_number, false)}
                      disabled={checkBusy || !checkSid.trim() || !checkToken.trim()}
                    >
                      {checkBusy ? "Checking…" : "Run check"}
                    </button>

                    {diag?.repairable ? (
                      <button
                        style={btn()}
                        onClick={() => runCheck(n.phone_number, true)}
                        disabled={checkBusy}
                      >
                        Fix it
                      </button>
                    ) : null}
                  </div>

                  {checkErr ? (
                    <p
                      style={{
                        margin: "14px 0 0",
                        fontSize: 12.5,
                        color: C.red,
                        lineHeight: 1.6,
                      }}
                    >
                      {checkErr}
                    </p>
                  ) : null}

                  {diag ? (
                    <div style={{ marginTop: 16 }}>
                      <p
                        style={{
                          margin: "0 0 12px",
                          fontSize: 13,
                          color: diag.inbound_ready ? C.green : C.oxbloodText,
                          lineHeight: 1.6,
                        }}
                      >
                        {diag.inbound_ready
                          ? "Inbound calls will reach Retell."
                          : "Inbound calls will not reach Retell."}
                      </p>

                      {diag.checks.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            display: "flex",
                            gap: 10,
                            padding: "7px 0",
                            borderTop: `1px solid ${C.hairline}`,
                            alignItems: "baseline",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              background: DOT[c.status],
                              flexShrink: 0,
                              transform: "translateY(-1px)",
                            }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, color: C.text }}>{c.label}</div>
                            <div
                              style={{
                                fontSize: 12,
                                color: C.faint,
                                lineHeight: 1.6,
                                wordBreak: "break-word",
                              }}
                            >
                              {c.detail}
                            </div>
                            {c.fix ? (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: C.brassText,
                                  lineHeight: 1.6,
                                  marginTop: 3,
                                }}
                              >
                                {c.fix}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}

                      {diag.candidate_trunks.length > 0 ? (
                        <div style={{ marginTop: 14 }}>
                          <label style={lbl}>Which trunk should this number use?</label>
                          <select
                            style={field}
                            value={trunkPick}
                            onChange={(e) => setTrunkPick(e.target.value)}
                          >
                            <option value="">Select a trunk…</option>
                            {diag.candidate_trunks.map((t) => (
                              <option key={t.sid} value={t.sid}>
                                {t.friendly_name || "(unnamed)"} — {t.domain_name}
                              </option>
                            ))}
                          </select>
                          <button
                            style={{ ...btn(true), marginTop: 12 }}
                            onClick={() => runCheck(n.phone_number, false)}
                            disabled={checkBusy || !trunkPick}
                          >
                            Check this trunk
                          </button>
                        </div>
                      ) : null}

                      {diag.steps && diag.steps.length > 0 ? (
                        <ul
                          style={{
                            margin: "14px 0 0",
                            padding: "0 0 0 18px",
                            fontSize: 12.5,
                            color: C.dim,
                            lineHeight: 1.9,
                          }}
                        >
                          {diag.steps.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      ) : null}

                      {diag.inbound_ready ? (
                        <p
                          style={{
                            margin: "14px 0 0",
                            fontSize: 12,
                            color: C.faint,
                            lineHeight: 1.7,
                          }}
                        >
                          Twilio can take a minute to apply a routing change. Place one real call to
                          confirm, and check it appears in Retell&apos;s call history.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}

          <p style={{ color: C.faint, fontSize: 12, marginTop: 28, lineHeight: 1.7 }}>
            Removing a number here unlinks it from Retell only. The number stays in your Twilio
            account and keeps billing.
          </p>
        </>
      ) : null}
    </main>
  );
}
