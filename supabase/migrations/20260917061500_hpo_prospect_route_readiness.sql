-- HPO daily-work readiness: strict Prospects -> Accounts boundary + route journal.
-- Non-PHI only. Prospects are research targets, not real referral accounts.

create table if not exists public.hpo_prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  prospect_type text,
  specialty text,
  territory text,
  city text,
  address text,
  phone text,
  website text,
  fit_status text not null default 'undecided' check (fit_status in ('undecided','qualified','not_fit','closed','duplicate','promoted')),
  disposition_reason text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','partial','verified')),
  source_type text not null default 'manual',
  source_ref text,
  provenance jsonb not null default '[]'::jsonb,
  promoted_account_id uuid references public.hpo_accounts(id) on delete set null,
  promoted_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_name)
);

-- Accounts are established referral relationships only. New account rows must never default to prospect.
alter table public.hpo_accounts alter column relationship_stage set default 'active';

alter table public.hpo_route_stops add column if not exists prospect_id uuid references public.hpo_prospects(id) on delete set null;
alter table public.hpo_route_stops add column if not exists office_name text;
alter table public.hpo_route_stops add column if not exists visit_summary text;
alter table public.hpo_route_stops add column if not exists visit_outcome text;
alter table public.hpo_route_stops add column if not exists next_action text;
alter table public.hpo_route_stops add column if not exists next_action_due_at timestamptz;

create index if not exists hpo_prospects_user_status_idx on public.hpo_prospects(user_id, fit_status, updated_at desc);
create index if not exists hpo_prospects_user_city_idx on public.hpo_prospects(user_id, city);
create index if not exists hpo_route_stops_prospect_idx on public.hpo_route_stops(user_id, prospect_id);

alter table public.hpo_prospects enable row level security;
create policy "hpo_prospects_owner_all" on public.hpo_prospects for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.hpo_prospects from anon;
grant select, insert, update, delete on public.hpo_prospects to authenticated;

comment on table public.hpo_prospects is 'Non-PHI HPO research targets. Promotion to hpo_accounts requires explicit user approval.';
comment on column public.hpo_prospects.provenance is 'Source/provenance records for prospect verification and dedupe.';
comment on column public.hpo_route_stops.visit_summary is 'Non-PHI field visit note used for route journal/export.';