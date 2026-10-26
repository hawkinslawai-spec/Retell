-- Run after supabase-schema.sql. Safe to re-run.

alter table campaigns add column if not exists daily_cap        int  not null default 200;
alter table campaigns add column if not exists start_date       date;
alter table campaigns add column if not exists end_date         date;
alter table campaigns add column if not exists auto_sync_sheet  boolean not null default false;
alter table campaigns add column if not exists agent_label      text;

-- Used by the daily-cap counter, which asks "how many attempts since local
-- midnight" on every tick.
create index if not exists campaign_leads_last_attempt_idx
  on campaign_leads (campaign_id, last_attempt_at);
