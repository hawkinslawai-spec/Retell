-- Run after supabase-migration-3.sql. Safe to re-run.
-- Per-agent destinations: each agent can write to its own sheet and calendar.

create table if not exists agent_settings (
  agent_id      text primary key,
  agent_name    text,
  sheet_id      text,
  calendar_id   text,
  leads_tab     text not null default 'Leads',
  bookings_tab  text not null default 'Bookings',
  calls_tab     text not null default 'Calls',
  timezone      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table agent_settings enable row level security;

drop trigger if exists agent_settings_updated_at on agent_settings;
create trigger agent_settings_updated_at
  before update on agent_settings
  for each row execute function set_updated_at();
