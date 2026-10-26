"use client";

import { useState } from "react";

export default function LoginClient({ brand }: { brand: string }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function signIn() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || "Sign in failed");

      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 28 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "linear-gradient(135deg,#4d7fe0,#8b5fd6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ◆
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.2 }}>{brand}</span>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 500, margin: "0 0 6px" }}>Sign in</h1>
        <p style={{ color: "#8b98a9", fontSize: 14, marginTop: 0, marginBottom: 22 }}>
          You&apos;ll stay signed in on this device for 30 days.
        </p>

        {err ? <p style={{ color: "#ff6b6b", fontSize: 13, marginBottom: 14 }}>{err}</p> : null}

        <input
          style={{
            width: "100%",
            background: "#0e1217",
            border: "1px solid #232a33",
            borderRadius: 9,
            color: "#e7ecf3",
            padding: "11px 13px",
            fontSize: 14,
            boxSizing: "border-box",
          }}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && token && signIn()}
          placeholder="Access token"
          autoFocus
        />

        <button
          onClick={signIn}
          disabled={busy || !token}
          style={{
            width: "100%",
            marginTop: 14,
            background: "linear-gradient(135deg,#4d7fe0,#8b5fd6)",
            border: "none",
            color: "#fff",
            borderRadius: 10,
            padding: "12px 20px",
            fontSize: 14.5,
            fontWeight: 500,
            cursor: busy || !token ? "default" : "pointer",
            opacity: busy || !token ? 0.6 : 1,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </main>
  );
}
