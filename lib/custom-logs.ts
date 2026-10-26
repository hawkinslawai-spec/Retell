export type CustomLogField = { name: string; description: string };

export type CustomLog = {
  key: string;
  label: string;
  description: string;
  fields: CustomLogField[];
};

/** Tool names must be a safe identifier — Retell rejects anything else. */
export function slugify(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function normaliseLog(raw: unknown): CustomLog | null {
  const r = (raw || {}) as Record<string, unknown>;

  const label = String(r.label ?? "").trim();
  if (!label) return null;

  const key = slugify(String(r.key ?? "") || label);
  if (!key) return null;

  const fields: CustomLogField[] = Array.isArray(r.fields)
    ? r.fields
        .map((f) => {
          const field = (f || {}) as Record<string, unknown>;
          const name = slugify(String(field.name ?? ""));
          if (!name) return null;
          return { name, description: String(field.description ?? "").trim() };
        })
        .filter((f): f is CustomLogField => f !== null)
        .slice(0, 12)
    : [];

  return {
    key,
    label,
    description: String(r.description ?? "").trim(),
    fields,
  };
}

export function parseLogs(raw: unknown): CustomLog[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: CustomLog[] = [];

  for (const item of raw.slice(0, 10)) {
    const log = normaliseLog(item);
    if (!log || seen.has(log.key)) continue;
    seen.add(log.key);
    out.push(log);
  }
  return out;
}

/** The header row the sheet tab should have, in the order rows are written. */
export function headerRow(log: CustomLog): string[] {
  return ["Timestamp", ...log.fields.map((f) => f.name), "Call ID"];
}
