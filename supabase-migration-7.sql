-- Run after supabase-migration-6.sql. Safe to re-run.
-- Custom logs: user-defined sheet tabs with their own columns.
--
-- Shape: [{ "key": "complaints", "label": "Complaint",
--           "tab": "Complaints", "description": "...",
--           "fields": [{ "name": "issue", "description": "..." }] }]

alter table agent_settings
  add column if not exists custom_logs jsonb not null default '[]'::jsonb;
