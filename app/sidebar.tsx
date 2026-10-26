"use client";

import { usePathname } from "next/navigation";
import { C, FONT_SERIF } from "@/lib/ui";

/**
 * Grouped so the daily-use pages sit at the top and configuration sits
 * underneath. The receptionist only ever needs the first group.
 */
const GROUPS: { heading: string; items: { href: string; label: string }[] }[] = [
  {
    heading: "Daily",
    items: [
      { href: "/", label: "Overview" },
      { href: "/appointments", label: "Appointments" },
      { href: "/enquiries", label: "Enquiries" },
      { href: "/calls", label: "Call history" },
      { href: "/crm", label: "Contacts" },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { href: "/agents", label: "Phone agents" },
      { href: "/campaigns", label: "Outbound calling" },
      { href: "/phone-numbers", label: "Phone numbers" },
      { href: "/setup", label: "Setup checks" },
    ],
  },
];

export default function Sidebar({ brand }: { brand: string }) {
  const pathname = usePathname() || "/";

  if (pathname.startsWith("/login")) return null;

  async function signOut() {
    await fetch("/api/login", { method: "DELETE" });
    window.location.href = "/login";
  }

  return (
    <aside
      className="shell-nav"
      style={{
        width: 216,
        flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        background: C.slate,
        padding: "26px 0 20px",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Wordmark. Serif, because the firm's name is the one place this
          console should feel like letterhead rather than software. */}
      <div style={{ padding: "0 20px 24px" }}>
        <div
          style={{
            fontFamily: FONT_SERIF,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: 0.1,
            lineHeight: 1.25,
            color: C.text,
          }}
        >
          {brand}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3 }}>Reception console</div>
      </div>

      <nav style={{ flex: 1 }}>
        {GROUPS.map((group, groupIndex) => (
          <div key={group.heading} className="nav-group" style={{ marginBottom: 22 }}>
            <div
              className="nav-heading"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: C.faint,
                padding: "0 20px 8px",
                // A rule above the second group, not the first — it separates,
                // it doesn't decorate.
                ...(groupIndex > 0
                  ? { borderTop: `1px solid ${C.border}`, paddingTop: 18 }
                  : {}),
              }}
            >
              {group.heading}
            </div>

            {group.items.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  data-active={active ? "true" : "false"}
                  style={{
                    display: "block",
                    padding: "8px 20px",
                    fontSize: 13.5,
                    textDecoration: "none",
                    color: active ? C.text : C.dim,
                    fontWeight: active ? 500 : 400,
                    background: active ? "rgba(255,255,255,0.028)" : "transparent",
                    // The active page is marked by a rule in the accent,
                    // which keeps a scanned list quiet.
                    borderLeft: active
                      ? `2px solid ${C.oxblood}`
                      : "2px solid transparent",
                  }}
                >
                  {item.label}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="nav-footer" style={{ padding: "0 20px" }}>
        <button
          onClick={signOut}
          style={{
            width: "100%",
            background: "transparent",
            border: `1px solid ${C.border}`,
            color: C.dim,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
