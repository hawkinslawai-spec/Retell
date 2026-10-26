-- Migration 12 — move bookings, leads and custom logs into this database
--
-- Google Sheets, Google Calendar and Calendly are gone. Everything a call
-- produces now lives here, and the app is the only place the client looks.
--
-- Run in Supabase -> SQL Editor -> New query. Safe to run more than once.

-- ---------------------------------------------------------------- appointments
create table if not exists public.appointments (
  id          uuid primary key default gen_random_uuid(),
  call_id     text,
  agent_id    text,
  name        text,
  phone       text,
  email       text,
  service     text,
  notes       text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'booked',
  -- 'agent' when the voice agent booked it, 'manual' when a person did.
  source      text not null default 'agent',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists appointments_starts_at_idx
  on public.appointments (starts_at);

create index if not exists appointments_phone_idx
  on public.appointments (phone);

-- Idempotency. Retell retries a custom function when it times out, and the
-- model sometimes calls book_appointment twice by itself. Without this, a
-- retry books the same client into the same slot twice.
create unique index if not exists appointments_call_slot_uniq
  on public.appointments (call_id, starts_at)
  where call_id is not null and status <> 'cancelled';

-- Double-booking guard. The application checks for an overlap before
-- inserting, but two calls landing in the same second would both pass that
-- check. This makes the database the final arbiter: the second insert fails
-- and the agent offers another time instead.
--
-- Note this allows exactly one appointment per start time, which is what a
-- single-solicitor diary wants. If the firm ever needs two people booked at
-- the same time, drop this index and add a resource column to the key.
create unique index if not exists appointments_slot_uniq
  on public.appointments (starts_at)
  where status <> 'cancelled';

-- ----------------------------------------------------------------------- leads
create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  phone       text,
  email       text,
  interest    text,
  notes       text,
  interested  boolean not null default false,
  call_id     text,
  agent_id    text,
  created_at  timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx      on public.leads (phone);

-- ----------------------------------------------------------------- log_entries
-- One row per custom log the client defined on /agents. Fields are JSON
-- because the client can add, rename and remove them from the UI whenever
-- they like, and a fixed schema would need a migration every time.
create table if not exists public.log_entries (
  id          uuid primary key default gen_random_uuid(),
  log_key     text not null,
  log_label   text,
  data        jsonb not null default '{}'::jsonb,
  phone       text,
  call_id     text,
  agent_id    text,
  created_at  timestamptz not null default now()
);

create index if not exists log_entries_key_idx
  on public.log_entries (log_key, created_at desc);

create index if not exists log_entries_created_at_idx
  on public.log_entries (created_at desc);

-- ------------------------------------------------------------------ housekeeping
-- The Lead Finder is gone, so its table goes with it. Dropped rather than
-- left behind, because an unused table with scraped business data in it is a
-- liability for a law firm's data map, not a harmless leftover.
drop table if exists public.found_leads;

-- Sheet and calendar settings no longer mean anything.
alter table public.agent_settings
  drop column if exists sheet_id,
  drop column if exists calendar_id,
  drop column if exists leads_tab,
  drop column if exists bookings_tab,
  drop column if exists calls_tab,
  drop column if exists calendly_event_type,
  drop column if exists calendly_location_kind;

-- ------------------------------------------------------------------- updated_at
-- set_updated_at() is created in the base schema. Defined here too so this
-- migration stands on its own if run against a database built by hand.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------- RLS
-- Enabled with no policies, same as every other table here. The app reaches
-- Supabase with the service_role key, which bypasses RLS; this makes sure
-- nothing can be read with the anon key if it ever leaks into a browser.
alter table public.appointments enable row level security;
alter table public.leads        enable row level security;
alter table public.log_entries  enable row level security;
