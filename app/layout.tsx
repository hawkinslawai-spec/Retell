import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Sidebar from "./sidebar";
import { BRAND_NAME } from "@/lib/config";
import { C, FONT_SANS } from "@/lib/ui";

export const metadata: Metadata = {
  title: `${BRAND_NAME} Console`,
  description: "Calls, enquiries and appointments handled by the phone agent",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Public+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }

          /* Inputs inherit the page face rather than falling back to the
             browser default, which otherwise makes every form look foreign. */
          input, select, textarea, button { font-family: inherit; }

          /* Visible keyboard focus everywhere, in the accent so it reads as
             deliberate rather than as the browser's default blue ring. */
          :focus-visible {
            outline: 2px solid ${C.oxbloodText};
            outline-offset: 2px;
          }

          a { color: ${C.text}; }

          ::placeholder { color: ${C.faint}; opacity: 1; }

          /* Scrollbars matched to the ground, so a scrolling table doesn't
             punch a bright stripe down the side of the page. */
          * { scrollbar-color: ${C.border} transparent; }
          ::-webkit-scrollbar { width: 10px; height: 10px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb {
            background: ${C.border};
            border-radius: 6px;
          }

          tbody tr:hover { background: rgba(255,255,255,0.016); }

          /* Page padding, set here so every page gets the same gutter and the
             mobile override lands in one place rather than on each page. */
          main { padding: 34px 38px 90px; }

          /* Below 860px the fixed sidebar would eat most of a phone screen,
             so the shell stacks and the nav becomes a scrollable strip. */
          @media (max-width: 860px) {
            .shell { flex-direction: column; }

            .shell-nav {
              width: 100% !important;
              min-height: 0 !important;
              border-right: none !important;
              border-bottom: 1px solid ${C.border};
              padding: 16px 0 0 !important;
            }

            /* Group headings and the sign-out button are desktop affordances;
               on a strip they just take room from the links. */
            .shell-nav .nav-heading,
            .shell-nav .nav-footer { display: none; }

            .shell-nav nav {
              display: flex;
              overflow-x: auto;
              gap: 2px;
              padding: 0 12px 2px;
              scrollbar-width: none;
            }
            .shell-nav nav::-webkit-scrollbar { display: none; }

            .shell-nav .nav-group { margin-bottom: 0 !important; display: flex; }

            .shell-nav a {
              white-space: nowrap;
              border-left: none !important;
              border-bottom: 2px solid transparent;
              padding: 8px 12px !important;
            }
            .shell-nav a[data-active="true"] {
              border-bottom-color: ${C.oxblood};
              background: transparent !important;
            }

            main { padding: 24px 16px 70px !important; }

            /* Multi-column grids collapse rather than squeezing to 2 columns
               that are each too narrow to read. */
            main [style*="grid-template-columns"] {
              grid-template-columns: 1fr !important;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              transition-duration: 0.01ms !important;
            }
          }
        `}</style>
      </head>
      <body
        style={{
          margin: 0,
          background: C.ink,
          color: C.text,
          fontFamily: FONT_SANS,
          fontSize: 14,
          lineHeight: 1.55,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div className="shell" style={{ display: "flex", alignItems: "stretch", minHeight: "100vh" }}>
          <Sidebar brand={BRAND_NAME} />
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
      </body>
    </html>
  );
}
