-- Run after supabase-migration-9.sql. Safe to re-run.
-- Calendly: book into Calendly instead of Google Calendar, per agent.
--
-- When calendly_event_type is set, that agent's check_availability and
-- book_appointment use Calendly. Left blank, it keeps using Google Calendar.

alter table agent_settings add column if not exists calendly_event_type    text;
alter table agent_settings add column if not exists calendly_location_kind text;
