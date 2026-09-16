-- HPO Operating System: relationship intelligence + field execution, intentionally non-PHI.
-- All rows are user-scoped and protected by RLS.

create table if not exists public.hpo_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type text,
  specialty text,
  territory text,
  city text,
  address text,
  priority integer not null default 3 check (priority between 1 and 5),
  owner_name text,
  relationship_stage text not null default 'prospect',
  status text not null default 'active',
  source_origin text,
  notes text,
  last_touch_at timestamptz,
  next_action text,
  next_action_due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hpo_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.hpo_accounts(id) on delete cascade,
  name text not null,
  role_title text,
  phone text,
  email text,
  preferred_contact_method text,
  relationship_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hpo_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.hpo_accounts(id) on delete cascade,
  contact_id uuid references public.hpo_contacts(id) on delete set null,
  interaction_type text not null default 'visit',
  occurred_at timestamptz not null default now(),
  summary text not null,
  outcome text,
  relationship_signal text,
  next_action text,
  next_action_due_at timestamptz,
  source_type text not null default 'manual',
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.hpo_sales_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.hpo_accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  referral_count integer not null default 0 check (referral_count >= 0),
  entered_care_count integer not null default 0 check (entered_care_count >= 0),
  progressing_count integer not null default 0 check (progressing_count >= 0),
  blocked_exception_count integer not null default 0 check (blocked_exception_count >= 0),
  relationship_impact_count integer not null default 0 check (relationship_impact_count >= 0),
  notes text,
  source_type text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists public.hpo_route_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_date date not null,
  area text,
  status text not null default 'draft',
  start_window text,
  end_window text,
  notes text,
  source_type text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hpo_route_stops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_id uuid not null references public.hpo_route_plans(id) on delete cascade,
  account_id uuid references public.hpo_accounts(id) on delete set null,
  stop_order integer not null check (stop_order > 0),
  visit_priority text,
  status text not null default 'planned',
  planned_at timestamptz,
  visited_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, stop_order)
);

create table if not exists public.hpo_data_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_name text,
  status text not null default 'staged',
  row_count integer check (row_count is null or row_count >= 0),
  imported_count integer check (imported_count is null or imported_count >= 0),
  rejected_count integer check (rejected_count is null or rejected_count >= 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hpo_accounts_user_priority_idx on public.hpo_accounts(user_id, status, priority desc);
create index if not exists hpo_accounts_user_next_action_idx on public.hpo_accounts(user_id, next_action_due_at);
create index if not exists hpo_contacts_user_account_idx on public.hpo_contacts(user_id, account_id);
create index if not exists hpo_interactions_user_account_time_idx on public.hpo_interactions(user_id, account_id, occurred_at desc);
create index if not exists hpo_sales_metrics_user_period_idx on public.hpo_sales_metrics(user_id, period_end desc);
create index if not exists hpo_route_plans_user_date_idx on public.hpo_route_plans(user_id, route_date desc);
create index if not exists hpo_route_stops_user_route_idx on public.hpo_route_stops(user_id, route_id, stop_order);
create index if not exists hpo_data_imports_user_created_idx on public.hpo_data_imports(user_id, created_at desc);

alter table public.hpo_accounts enable row level security;
alter table public.hpo_contacts enable row level security;
alter table public.hpo_interactions enable row level security;
alter table public.hpo_sales_metrics enable row level security;
alter table public.hpo_route_plans enable row level security;
alter table public.hpo_route_stops enable row level security;
alter table public.hpo_data_imports enable row level security;

create policy "hpo_accounts_owner_all" on public.hpo_accounts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_contacts_owner_all" on public.hpo_contacts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_interactions_owner_all" on public.hpo_interactions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_sales_metrics_owner_all" on public.hpo_sales_metrics for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_route_plans_owner_all" on public.hpo_route_plans for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_route_stops_owner_all" on public.hpo_route_stops for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_data_imports_owner_all" on public.hpo_data_imports for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.hpo_accounts from anon;
revoke all on public.hpo_contacts from anon;
revoke all on public.hpo_interactions from anon;
revoke all on public.hpo_sales_metrics from anon;
revoke all on public.hpo_route_plans from anon;
revoke all on public.hpo_route_stops from anon;
revoke all on public.hpo_data_imports from anon;

grant select, insert, update, delete on public.hpo_accounts to authenticated;
grant select, insert, update, delete on public.hpo_contacts to authenticated;
grant select, insert, update, delete on public.hpo_interactions to authenticated;
grant select, insert, update, delete on public.hpo_sales_metrics to authenticated;
grant select, insert, update, delete on public.hpo_route_plans to authenticated;
grant select, insert, update, delete on public.hpo_route_stops to authenticated;
grant select, insert, update, delete on public.hpo_data_imports to authenticated;
