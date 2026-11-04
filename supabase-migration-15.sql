-- Migration 15 — Amy's editable settings.
--
-- Staff, direct lines, emails, routing order, voice and the firm wording Amy
-- may say, held as one JSON row so the Amy settings page can change them
-- without a deploy. The guardrails, client account script and transfer
-- mechanics are deliberately NOT stored here; they stay in code.
--
-- Until a row is saved, the console uses the built-in defaults (the same
-- values that were previously hardcoded), so running this changes nothing
-- on its own.
--
-- Safe to re-run.

create table if not exists amy_settings (
  id         smallint primary key default 1 check (id = 1),
  config     jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Server-side access only (service role key). No public policies.
alter table amy_settings enable row level security;
