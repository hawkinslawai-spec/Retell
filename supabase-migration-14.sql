-- Migration 14 — opening hours and calling hours, held in the database.
--
-- Until now Amy's hours were fixed in lib/hawkins/hours.ts, so changing them
-- meant a deploy. For a law firm that is the wrong trade: the hours change for
-- a bank holiday closure or a half day at short notice, and whoever needs to
-- change them is not the person holding the repository.
--
-- Two things are configured here and they are deliberately separate:
--
--   open_time / close_time  decide whether Amy will attempt a transfer at all.
--                           Outside them she takes a message instead.
--   call_start / call_end   decide when outbound campaigns may dial. Ofcom's
--                           rules and ordinary courtesy make this narrower
--                           than the office's own hours in most firms.
--
-- Safe to re-run.

create table if not exists office_hours (
  weekday         smallint primary key check (weekday between 1 and 7),
  is_open         boolean  not null default true,
  -- Stored as "HH:MM" text rather than `time`, because that is what the form
  -- posts and what an <input type="time"> expects back. No arithmetic is done
  -- in SQL, so there is nothing to gain from the richer type.
  open_time       text     not null default '09:30',
  close_time      text     not null default '17:30',
  calling_enabled boolean  not null default true,
  call_start      text     not null default '09:30',
  call_end        text     not null default '17:30',
  updated_at      timestamptz not null default now(),

  constraint office_hours_open_format  check (open_time  ~ '^[0-2][0-9]:[0-5][0-9]$'),
  constraint office_hours_close_format check (close_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  constraint office_hours_cs_format    check (call_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  constraint office_hours_ce_format    check (call_end   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- An open time at or after the close time would leave the office shut all
  -- day while the row still claims to be open, which is the kind of silent
  -- misconfiguration that only shows up as "why did nobody get transferred".
  constraint office_hours_open_before_close check (open_time < close_time),
  constraint office_hours_call_before_end   check (call_start < call_end)
);

-- Monday to Friday 09:30-17:30, weekend closed. Matches what was previously
-- hardcoded, so running this migration changes no behaviour on its own.
insert into office_hours (weekday, is_open, open_time, close_time, calling_enabled, call_start, call_end)
values
  (1, true,  '09:30', '17:30', true,  '09:30', '17:30'),
  (2, true,  '09:30', '17:30', true,  '09:30', '17:30'),
  (3, true,  '09:30', '17:30', true,  '09:30', '17:30'),
  (4, true,  '09:30', '17:30', true,  '09:30', '17:30'),
  (5, true,  '09:30', '17:30', true,  '09:30', '17:30'),
  (6, false, '09:30', '17:30', false, '09:30', '17:30'),
  (7, false, '09:30', '17:30', false, '09:30', '17:30')
on conflict (weekday) do nothing;

-- One-off closures that are not bank holidays: a Christmas shutdown, an Eid
-- day, a staff training afternoon. Bank holidays still come from the GOV.UK
-- feed and are not duplicated here.
create table if not exists office_closures (
  closure_date date primary key,
  note         text,
  created_at   timestamptz not null default now()
);

alter table office_hours    enable row level security;
alter table office_closures enable row level security;
