-- Run after supabase-migration-8.sql. Safe to re-run.
-- Lead Finder: businesses pulled from Google Maps via Outscraper.

create table if not exists found_leads (
  id            uuid primary key default gen_random_uuid(),
  place_id      text,
  business      text not null,
  industry      text,
  phone         text,
  email         text,
  website       text,
  address       text,
  city          text,
  postal_code   text,
  country       text,
  rating        numeric,
  reviews       int,
  hours         text,
  map_link      text,
  search_query  text,
  status        text not null default 'new',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint found_leads_status_check
    check (status in ('new','pushed','called','skipped')),
  constraint found_leads_unique_place unique (place_id)
);

create index if not exists found_leads_status_idx on found_leads (status);
create index if not exists found_leads_query_idx  on found_leads (search_query);
create index if not exists found_leads_phone_idx  on found_leads (phone);

alter table found_leads enable row level security;

drop trigger if exists found_leads_updated_at on found_leads;
create trigger found_leads_updated_at
  before update on found_leads
  for each row execute function set_updated_at();
