-- ============================================================================
--  Hawkins Law — voice agent console
--  Complete database schema for a fresh deployment
-- ============================================================================
--
--  Run this ONCE, in Supabase → SQL Editor → New query → Run.
--
--  This is the whole schema in its final state. On a new project this is the
--  only file you need — ignore the numbered supabase-migration-*.sql files,
--  which exist to upgrade older deployments and partly contradict each other
--  (migration 12 removes columns that earlier ones added).
--
--  Everything is `if not exists`, so re-running it is harmless.
--
--  Row level security is enabled on every table with no policies attached.
--  The application reaches Supabase with the service_role key, which bypasses
--  RLS entirely; this makes sure that if the anon key ever leaks into a
--  browser it can read nothing at all.
-- ============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------- updated_at bump
-- Defined first because several tables below attach a trigger to it.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
--  APPOINTMENTS
--  The firm's diary. There is no external calendar — availability is worked
--  out from the opening hours in the environment plus the rows in here.
-- ============================================================================
create table if not exists appointments (
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

create index if not exists appointments_starts_at_idx on appointments (starts_at);
create index if not exists appointments_phone_idx     on appointments (phone);

-- Idempotency. Retell retries a custom function when it times out, and the
-- model sometimes calls book_appointment twice by itself. Without this, a
-- retry books the same client into the same slot twice.
create unique index if not exists appointments_call_slot_uniq
  on appointments (call_id, starts_at)
  where call_id is not null and status <> 'cancelled';

-- Double-booking guard. The application checks for an overlap before
-- inserting, but two calls landing in the same second would both pass that
-- check. This makes the database the final arbiter: the second insert fails
-- and the agent offers another time instead.
--
-- This allows exactly one appointment per start time, which is what a
-- single-solicitor diary wants. If the firm ever needs two people booked at
-- the same time, drop this index and add a resource column to the key.
create unique index if not exists appointments_slot_uniq
  on appointments (starts_at)
  where status <> 'cancelled';

drop trigger if exists appointments_set_updated_at on appointments;
create trigger appointments_set_updated_at
  before update on appointments
  for each row execute function set_updated_at();


-- ============================================================================
--  LEADS
--  Callers who left details without booking. Shown on /enquiries.
-- ============================================================================
create table if not exists leads (
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

create index if not exists leads_created_at_idx on leads (created_at desc);
create index if not exists leads_phone_idx      on leads (phone);


-- ============================================================================
--  LOG ENTRIES
--  One row per custom log defined on /agents. Fields are stored as JSON
--  because the firm can add, rename and remove them from the UI at any time,
--  and a fixed schema would need a migration every time they did.
-- ============================================================================
create table if not exists log_entries (
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
  on log_entries (log_key, created_at desc);
create index if not exists log_entries_created_at_idx
  on log_entries (created_at desc);


-- ============================================================================
--  CONTACTS
--  Everyone the agent has ever spoken to, one row per phone number.
-- ============================================================================
create table if not exists contacts (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null unique,
  name           text,
  email          text,
  company        text,
  status         text not null default 'new',
  source         text,
  notes          text,
  last_call_at   timestamptz,
  last_summary   text,
  call_count     int not null default 0,
  booked_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint contacts_status_check
    check (status in ('new','contacted','qualified','booked','won','lost','dnc'))
);

drop trigger if exists contacts_set_updated_at on contacts;
create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();


-- ============================================================================
--  AGENT SETTINGS
--  Per-agent configuration. An agent with no row here falls back to the
--  environment defaults, so a single-agent deployment needs no rows at all.
-- ============================================================================
create table if not exists agent_settings (
  agent_id              text primary key,
  agent_name            text,
  timezone              text,

  -- Text alerts
  alert_number          text,
  alert_on_book         boolean not null default true,
  alert_on_lead         boolean not null default true,

  -- Custom logs the firm defined in the UI
  custom_logs           jsonb not null default '[]'::jsonb,

  -- Transfer to a human. transfer_mode is 'warm', 'cold' or 'screen'.
  transfer_number       text,
  transfer_mode         text not null default 'warm',
  transfer_note         text,

  -- Screened transfer. The screening agent is created in Retell automatically
  -- the first time an agent is saved with transfer_mode = 'screen'.
  -- Do not set screen_agent_id by hand.
  screen_agent_id       text,
  screen_prompt         text,
  screen_ring_seconds   integer default 25,
  screen_decide_seconds integer default 30,
  -- 'cancel' tells the caller nobody was available; 'bridge' connects anyway.
  screen_on_timeout     text default 'cancel',

  -- Emailed call summaries. Comma-separate for several recipients.
  summary_email         text,
  email_every_call      boolean not null default false,
  email_on_transfer     boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists agent_settings_set_updated_at on agent_settings;
create trigger agent_settings_set_updated_at
  before update on agent_settings
  for each row execute function set_updated_at();


-- ============================================================================
--  CAMPAIGNS (outbound calling)
-- ============================================================================
create table if not exists campaigns (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  from_number          text not null,
  override_agent_id    text,
  agent_label          text,
  status               text not null default 'draft',
  timezone             text not null default 'Europe/London',
  window_start_min     int  not null default 540,
  window_end_min       int  not null default 1020,
  call_days            text[] not null default
                         '{Monday,Tuesday,Wednesday,Thursday,Friday}',
  batch_size           int  not null default 50,
  max_attempts         int  not null default 3,
  retry_after_minutes  int  not null default 240,
  reserved_concurrency int  not null default 1,
  daily_cap            int  not null default 200,
  start_date           date,
  end_date             date,
  -- Pull new interested enquiries into this campaign automatically.
  auto_sync_leads      boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint campaigns_status_check
    check (status in ('draft', 'active', 'paused', 'completed')),
  constraint campaigns_window_check
    check (window_start_min >= 0 and window_end_min <= 1440
           and window_start_min < window_end_min)
);

drop trigger if exists campaigns_set_updated_at on campaigns;
create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function set_updated_at();


create table if not exists campaign_leads (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  phone           text not null,
  name            text,
  email           text,
  variables       jsonb not null default '{}'::jsonb,
  status          text not null default 'pending',
  attempts        int  not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  batch_call_id   text,
  call_id         text,
  disposition     text,
  summary         text,
  recording_url   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint campaign_leads_status_check
    check (status in ('pending', 'queued', 'answered', 'no_answer',
                      'failed', 'suppressed')),
  -- Lets a re-import skip people already in the campaign instead of
  -- resetting their progress.
  constraint campaign_leads_unique_phone unique (campaign_id, phone)
);

create index if not exists campaign_leads_campaign_status_idx
  on campaign_leads (campaign_id, status);

create index if not exists campaign_leads_next_attempt_idx
  on campaign_leads (next_attempt_at)
  where status = 'pending';

create index if not exists campaign_leads_batch_idx
  on campaign_leads (batch_call_id)
  where batch_call_id is not null;

drop trigger if exists campaign_leads_set_updated_at on campaign_leads;
create trigger campaign_leads_set_updated_at
  before update on campaign_leads
  for each row execute function set_updated_at();


-- ============================================================================
--  DO NOT CALL
--  Checked before every outbound batch. Add a number here and no campaign
--  will ever dial it again.
-- ============================================================================
create table if not exists dnc_list (
  phone      text primary key,
  reason     text,
  created_at timestamptz not null default now()
);


-- ============================================================================
--  AMY — call messages, transfer attempts and account read-outs
--  Sections 7, 8 and 10 of the Amy specification.
-- ============================================================================
-- --------------------------------------------------------------- messages
-- Section 8. Written BEFORE the email is attempted, so a message survives an
-- SMTP failure. A message that exists in the console but not in an inbox is
-- recoverable; one that exists nowhere is a client who rang a law firm and
-- was never called back.
create table if not exists call_messages (
  id              uuid primary key default gen_random_uuid(),
  call_id         text,
  caller_name     text,
  phone           text,
  email           text,
  -- existing client | new enquiry | third party | complaint
  caller_type     text,
  organisation    text,
  matter_label    text,
  file_handler    text,
  -- declined | no answer | busy | office closed | not attempted
  why_no_transfer text,
  callback        text,
  message         text,
  urgent          boolean not null default false,
  recipients      text[] not null default '{}',
  cc              text[] not null default '{}',
  subject         text,
  email_sent      boolean not null default false,
  email_error     text,
  created_at      timestamptz not null default now()
);

create index if not exists call_messages_created_at_idx
  on call_messages (created_at desc);

-- The two queries reception actually runs: what's urgent, and what failed to
-- send. Partial indexes because both are a small slice of the table.
create index if not exists call_messages_urgent_idx
  on call_messages (created_at desc) where urgent;

create index if not exists call_messages_unsent_idx
  on call_messages (created_at desc) where not email_sent;

-- ------------------------------------------------------- transfer attempts
-- Section 7 requires every attempt logged: who was rung, when, and how it
-- ended. This is what you read when a client says nobody ever picked up.
create table if not exists transfer_attempts (
  id           uuid primary key default gen_random_uuid(),
  call_id      text,
  staff_id     text,
  staff_name   text,
  -- accepted | declined | no_answer | busy | failed
  outcome      text,
  urgent       boolean not null default false,
  caller_name  text,
  matter_label text,
  created_at   timestamptz not null default now()
);

create index if not exists transfer_attempts_call_idx
  on transfer_attempts (call_id, created_at);

-- ------------------------------------------------------- account read-outs
-- Section 10: a record of every occasion the client account details were read
-- to a caller. Conveyancing fraud is the reason this table exists — if money
-- goes missing, this is the evidence of what the firm actually said and when.
create table if not exists account_readouts (
  id           uuid primary key default gen_random_uuid(),
  call_id      text,
  caller_name  text,
  phone        text,
  matter_label text,
  file_handler text,
  sent_to      text,
  read_at      timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists account_readouts_read_at_idx
  on account_readouts (read_at desc);


-- ============================================================================
--  ROW LEVEL SECURITY
-- ============================================================================
alter table appointments   enable row level security;
alter table leads          enable row level security;
alter table log_entries    enable row level security;
alter table contacts       enable row level security;
alter table agent_settings enable row level security;
alter table campaigns      enable row level security;
alter table campaign_leads enable row level security;
alter table dnc_list       enable row level security;
alter table call_messages     enable row level security;
alter table transfer_attempts enable row level security;
alter table account_readouts  enable row level security;
