-- Run after supabase-migration-2.sql. Safe to re-run.
-- Adds the CRM contacts table.

create table if not exists contacts (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null unique,
  name           text,
  email          text,
  company        text,
  status         text not null default 'new',
  source         text,
  notes          text,
  last_call_at   timestamptz,
  last_summary   text,
  call_count     int not null default 0,
  booked_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint contacts_status_check
    check (status in ('new','contacted','qualified','booked','won','lost','dnc'))
);

create index if not exists contacts_status_idx on contacts (status);
create index if not exists contacts_last_call_idx on contacts (last_call_at desc);

alter table contacts enable row level security;

drop trigger if exists contacts_updated_at on contacts;
create trigger contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();
