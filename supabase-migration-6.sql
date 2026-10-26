-- Run after supabase-migration-5.sql. Safe to re-run.
-- Tab names become nullable so the app can tell three states apart:
--   NULL  -> never configured, use the environment default
--   ''    -> deliberately cleared, that log is switched off for this agent
--   'X'   -> write to tab X

alter table agent_settings alter column leads_tab    drop not null;
alter table agent_settings alter column bookings_tab drop not null;
alter table agent_settings alter column calls_tab    drop not null;

alter table agent_settings alter column leads_tab    drop default;
alter table agent_settings alter column bookings_tab drop default;
alter table agent_settings alter column calls_tab    drop default;
