-- Migration 13 — Amy: call messages, transfer attempts and account read-outs
--
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Already included in database-schema.sql for a fresh deployment.

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

-- ------------------------------------------------------------------- RLS
alter table call_messages     enable row level security;
alter table transfer_attempts enable row level security;
alter table account_readouts  enable row level security;
