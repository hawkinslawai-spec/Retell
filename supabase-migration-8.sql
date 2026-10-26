-- Run after supabase-migration-7.sql. Safe to re-run.
-- Call transfer: hand the caller to a human on a real phone number.

alter table agent_settings add column if not exists transfer_number text;
alter table agent_settings add column if not exists transfer_mode   text not null default 'warm';
alter table agent_settings add column if not exists transfer_note   text;
