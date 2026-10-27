"use client";

import { useState } from "react";
import { C, FONT_SERIF, btn, fld } from "@/lib/ui";

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
      <div style={{ width: "100%", maxWidth: 360 }}>
        {/* The firm's name in the serif, as on letterhead — no logo mark.
            An invented diamond glyph on a law firm's sign-in page reads as a
            template nobody bothered to finish. */}
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: 0.1,
            color: C.text,
          }}
        >
          {brand}
        </div>
        <div style={{ fontSize: 12.5, color: C.faint, marginTop: 3 }}>Reception console</div>

        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            margin: "22px 0 20px",
          }}
        />

        <label htmlFor="token" style={{ display: "block", fontSize: 13, color: C.dim, marginBottom: 8 }}>
          Access token
        </label>

        <input
          id="token"
          style={fld}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && token && signIn()}
          autoFocus
        />

        {err && (
          <div
            style={{
              marginTop: 12,
              borderLeft: `2px solid ${C.oxblood}`,
              paddingLeft: 12,
              color: C.oxbloodText,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        <button
          onClick={signIn}
          disabled={busy || !token}
          style={{
            ...btn("primary"),
            width: "100%",
            marginTop: 14,
            cursor: busy || !token ? "default" : "pointer",
            opacity: busy || !token ? 0.5 : 1,
          }}
        >
          {busy ? "Signing in" : "Sign in"}
        </button>

        <p style={{ fontSize: 12.5, color: C.faint, marginTop: 16, lineHeight: 1.6 }}>
          You&apos;ll stay signed in on this device for 30 days.
        </p>
      </div>
    </main>
  );
}
