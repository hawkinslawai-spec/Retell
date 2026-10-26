/**
 * Shared styling tokens.
 *
 * Direction: "ledger". The console is read every day by people checking what
 * the phone agent did, so the data is the design — hairline rules organise
 * rows the way a register does, figures are set in a serif with tabular
 * numerals so columns line up, and colour is only ever semantic.
 *
 * Two accents, both muted and both meaning something:
 *   oxblood — needs a person's attention
 *   brass   — settled, booked, done
 *
 * Nothing else is coloured. No gradients, no shadows, no decorative pills.
 */
export const C = {
  /** Page ground. Desaturated blue-slate rather than a tinted black. */
  ink: "#15191F",
  /** Raised surfaces: panels, table headers, the sidebar. */
  slate: "#1A1F26",
  /** Inputs and wells, recessed below the panel. */
  well: "#101419",

  /** Primary text. Warm, like printed paper. */
  text: "#E8E4DC",
  /** Secondary text, labels, column headings. */
  dim: "#8A9299",
  /** Tertiary — timestamps, row counts, disabled. */
  faint: "#5E6771",

  /** Hairlines and borders. */
  border: "#262C34",
  /** Even quieter rule, for between rows inside a table. */
  hairline: "#1F242B",

  /** Needs attention. Deep enough to stay sober on a dark ground. */
  oxblood: "#9E3B4A",
  /** Oxblood legible as small text — the deep tone fails contrast at 13px. */
  oxbloodText: "#D16A7B",

  /** Settled, booked, confirmed. */
  brass: "#B08C4F",
  /** Brass legible as small text. */
  brassText: "#CFA866",

  /** Reserved for genuine success/failure messaging, not for decoration. */
  green: "#5FA776",
  red: "#C2525C",
};

export const FONT_SERIF = `"Source Serif 4", Georgia, "Times New Roman", serif`;
export const FONT_SANS = `"Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

export const panel: React.CSSProperties = {
  background: C.slate,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "22px 24px",
};

/** Page title. Serif, generous, with a rule beneath it. */
export const pageTitle: React.CSSProperties = {
  fontFamily: FONT_SERIF,
  fontSize: 27,
  fontWeight: 600,
  letterSpacing: -0.3,
  color: C.text,
  margin: 0,
};

export const pageSub: React.CSSProperties = {
  fontSize: 14,
  color: C.dim,
  margin: "7px 0 0",
  maxWidth: "68ch",
  lineHeight: 1.6,
};

/** Section heading inside a page. */
export const sectionTitle: React.CSSProperties = {
  fontFamily: FONT_SERIF,
  fontSize: 18,
  fontWeight: 600,
  color: C.text,
  margin: 0,
};

/**
 * Figures. Serif with tabular numerals, so a column of numbers aligns and
 * reads like a ledger rather than like body copy that happens to be numeric.
 */
export const figure: React.CSSProperties = {
  fontFamily: FONT_SERIF,
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1',
  fontWeight: 600,
  letterSpacing: -0.5,
};

/** Any number inside a table cell. */
export const numeric: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1',
};

export const fld: React.CSSProperties = {
  width: "100%",
  background: C.well,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export const lbl: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: C.dim,
  marginBottom: 6,
};

export const hint: React.CSSProperties = {
  fontSize: 13,
  color: C.faint,
  lineHeight: 1.6,
  maxWidth: "72ch",
};

export function btn(kind: "primary" | "ghost" | "danger" = "ghost"): React.CSSProperties {
  return {
    background: kind === "primary" ? C.oxblood : "transparent",
    border: kind === "primary" ? `1px solid ${C.oxblood}` : `1px solid ${C.border}`,
    color: kind === "primary" ? "#FBF7F2" : kind === "danger" ? C.oxbloodText : C.text,
    borderRadius: 6,
    padding: "10px 18px",
    fontSize: 13.5,
    fontFamily: "inherit",
    fontWeight: kind === "primary" ? 600 : 400,
    cursor: "pointer",
  };
}

/** Table shell. Rules do the work; there is no card around it. */
export const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

export const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 12,
  fontWeight: 600,
  color: C.dim,
  padding: "0 14px 9px 0",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
};

export const td: React.CSSProperties = {
  padding: "12px 14px 12px 0",
  borderBottom: `1px solid ${C.hairline}`,
  color: C.text,
  verticalAlign: "top",
};

/**
 * State marker. A thin left rule rather than a coloured pill — it reads at a
 * glance down a long column without turning every row into a badge.
 */
export function marker(state: "attention" | "settled" | "neutral"): React.CSSProperties {
  const colour = state === "attention" ? C.oxblood : state === "settled" ? C.brass : C.border;
  return { borderLeft: `2px solid ${colour}`, paddingLeft: 12 };
}

export function stateText(state: "attention" | "settled" | "neutral"): React.CSSProperties {
  return {
    color:
      state === "attention" ? C.oxbloodText : state === "settled" ? C.brassText : C.dim,
    fontSize: 13,
  };
}

export function when(ms: number): string {
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

export function dur(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
