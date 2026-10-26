-- Migration 11 — screened call transfer + email call summaries
--
-- Run this in the Supabase SQL editor (Database -> SQL Editor -> New query).
-- Safe to run more than once: every statement is IF NOT EXISTS.
--
-- What it adds:
--   * screened transfers — the agent rings a human, a screening agent states
--     who is calling and why, and the human accepts (press 1) or declines
--     (press 2). On a decline the caller is told why.
--   * emailed call summaries, per agent.

alter table public.agent_settings
  -- 'warm' | 'cold' | 'screen'. The column already exists; this only widens
  -- what we store in it, so there is nothing to alter for transfer_mode itself.

  -- The Retell agent that does the screening. Created automatically the first
  -- time an agent is saved with transfer_mode = 'screen'. Do not set by hand.
  add column if not exists screen_agent_id   text,

  -- Override the screening script for this agent. Null means use the built-in
  -- one, which is what you want unless the client has unusual wording needs.
  add column if not exists screen_prompt     text,

  -- How long the human's phone rings before we give up, in seconds.
  add column if not exists screen_ring_seconds   integer default 25,

  -- How long the screening agent waits for an accept/decline, in seconds.
  add column if not exists screen_decide_seconds integer default 30,

  -- What to do if the human never decides: 'cancel' (tell the caller nobody
  -- was available) or 'bridge' (connect them anyway).
  add column if not exists screen_on_timeout text default 'cancel',

  -- Where call summaries are emailed. Comma-separated for several recipients.
  add column if not exists summary_email     text,

  -- Email every finished call. Off by default — it fills a mailbox fast.
  add column if not exists email_every_call  boolean default false,

  -- Email only when the caller asked for a human. On by default: those are
  -- the calls where something may have been missed.
  add column if not exists email_on_transfer boolean default true;

-- Existing rows predate these columns and come back null, which the app reads
-- as "not configured" and replaces with the defaults above. Backfill anyway so
-- the table reads the same whether a row was written before or after this ran.
update public.agent_settings
   set screen_ring_seconds   = coalesce(screen_ring_seconds, 25),
       screen_decide_seconds = coalesce(screen_decide_seconds, 30),
       screen_on_timeout     = coalesce(screen_on_timeout, 'cancel'),
       email_every_call      = coalesce(email_every_call, false),
       email_on_transfer     = coalesce(email_on_transfer, true)
 where screen_ring_seconds   is null
    or screen_decide_seconds is null
    or screen_on_timeout     is null
    or email_every_call      is null
    or email_on_transfer     is null;
