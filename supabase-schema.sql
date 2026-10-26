-- Run this once in Supabase → SQL Editor → New query → Run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- campaigns
create table if not exists campaigns (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  from_number         text not null,
  override_agent_id   text,
  status              text not null default 'draft',
  timezone            text not null default 'America/New_York',
  window_start_min    int  not null default 540,
  window_end_min      int  not null default 1020,
  call_days           text[] not null default
                        '{Monday,Tuesday,Wednesday,Thursday,Friday}',
  batch_size          int  not null default 50,
  max_attempts        int  not null default 3,
  retry_after_minutes int  not null default 240,
  reserved_concurrency int not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint campaigns_status_check
    check (status in ('draft', 'active', 'paused', 'completed')),
  constraint campaigns_window_check
    check (window_start_min >= 0 and window_end_min <= 1440
           and window_start_min < window_end_min)
);

-- ----------------------------------------------------------- campaign leads
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

-- ---------------------------------------------------------------- dnc list
create table if not exists dnc_list (
  phone      text primary key,
  reason     text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- RLS
-- Everything here is written by the server using the service role key, which
-- bypasses RLS. Enabling it with no policies means the anon key can read
-- nothing, which is what we want — none of this is exposed to the browser.
alter table campaigns      enable row level security;
alter table campaign_leads enable row level security;
alter table dnc_list       enable row level security;

-- --------------------------------------------------------- updated_at bump
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaigns_updated_at on campaigns;
create trigger campaigns_updated_at
  before update on campaigns
  for each row execute function set_updated_at();

drop trigger if exists campaign_leads_updated_at on campaign_leads;
create trigger campaign_leads_updated_at
  before update on campaign_leads
  for each row execute function set_updated_at();
