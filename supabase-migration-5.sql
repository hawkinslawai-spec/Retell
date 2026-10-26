-- Run after supabase-migration-4.sql. Safe to re-run.
-- Hot-lead SMS alerts, configured per agent.

alter table agent_settings add column if not exists alert_number  text;
alter table agent_settings add column if not exists alert_on_book boolean not null default true;
alter table agent_settings add column if not exists alert_on_lead boolean not null default true;
