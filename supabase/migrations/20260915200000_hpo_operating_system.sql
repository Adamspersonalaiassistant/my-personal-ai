-- HPO Operating System: relationship intelligence + field execution, intentionally non-PHI.
-- All rows are user-scoped, RLS-protected, and ownership-safe across parent/child references.

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
  relationship_health text,
  status text not null default 'active',
  opportunity text,
  blockers text,
  tags text[] not null default '{}'::text[],
  source_origin text,
  source_ref text,
  dedupe_key text,
  notes text,
  last_touch_at timestamptz,
  next_interaction_at timestamptz,
  next_action text,
  next_action_due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists public.hpo_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  name text not null,
  role_title text,
  phone text,
  email text,
  preferred_contact_method text,
  relationship_notes text,
  source_origin text,
  source_ref text,
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id) on delete cascade
);

create table if not exists public.hpo_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  contact_id uuid,
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
  created_at timestamptz not null default now(),
  foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id) on delete cascade,
  foreign key (user_id, contact_id)
    references public.hpo_contacts(user_id, id)
);

create table if not exists public.hpo_sales_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  period_start date not null,
  period_end date not null,
  referral_count integer not null default 0 check (referral_count >= 0),
  entered_care_count integer not null default 0 check (entered_care_count >= 0),
  progressing_count integer not null default 0 check (progressing_count >= 0),
  blocked_exception_count integer not null default 0 check (blocked_exception_count >= 0),
  relationship_impact_count integer not null default 0 check (relationship_impact_count >= 0),
  notes text,
  source_type text not null default 'manual',
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id)
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
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists public.hpo_route_stops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_id uuid not null,
  account_id uuid,
  stop_order integer not null check (stop_order > 0),
  visit_priority text,
  status text not null default 'planned',
  planned_at timestamptz,
  visited_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_id, stop_order),
  foreign key (user_id, route_id)
    references public.hpo_route_plans(user_id, id) on delete cascade,
  foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id)
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
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

-- Raw rows are staged before they are promoted into account/contact/activity tables.
-- This lets future CSV/Excel/chat-history imports be reviewed, deduped and rolled back safely.
create table if not exists public.hpo_import_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_id uuid not null,
  row_number integer not null check (row_number > 0),
  entity_type text not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'staged',
  target_id uuid,
  issue text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, row_number),
  foreign key (user_id, import_id)
    references public.hpo_data_imports(user_id, id) on delete cascade
);

create index if not exists hpo_accounts_user_priority_idx on public.hpo_accounts(user_id, status, priority desc);
create index if not exists hpo_accounts_user_next_action_idx on public.hpo_accounts(user_id, next_action_due_at);
create index if not exists hpo_accounts_user_last_touch_idx on public.hpo_accounts(user_id, last_touch_at desc);
create unique index if not exists hpo_accounts_user_dedupe_key_idx on public.hpo_accounts(user_id, dedupe_key) where dedupe_key is not null;
create index if not exists hpo_contacts_user_account_idx on public.hpo_contacts(user_id, account_id);
create unique index if not exists hpo_contacts_user_dedupe_key_idx on public.hpo_contacts(user_id, dedupe_key) where dedupe_key is not null;
create index if not exists hpo_interactions_user_account_time_idx on public.hpo_interactions(user_id, account_id, occurred_at desc);
create unique index if not exists hpo_interactions_user_source_ref_idx on public.hpo_interactions(user_id, source_type, source_ref) where source_ref is not null;
create index if not exists hpo_sales_metrics_user_period_idx on public.hpo_sales_metrics(user_id, period_end desc);
create index if not exists hpo_route_plans_user_date_idx on public.hpo_route_plans(user_id, route_date desc);
create index if not exists hpo_route_stops_user_route_idx on public.hpo_route_stops(user_id, route_id, stop_order);
create index if not exists hpo_data_imports_user_created_idx on public.hpo_data_imports(user_id, created_at desc);
create index if not exists hpo_import_rows_user_import_idx on public.hpo_import_rows(user_id, import_id, row_number);
create index if not exists hpo_import_rows_user_status_idx on public.hpo_import_rows(user_id, status, entity_type);

alter table public.hpo_accounts enable row level security;
alter table public.hpo_contacts enable row level security;
alter table public.hpo_interactions enable row level security;
alter table public.hpo_sales_metrics enable row level security;
alter table public.hpo_route_plans enable row level security;
alter table public.hpo_route_stops enable row level security;
alter table public.hpo_data_imports enable row level security;
alter table public.hpo_import_rows enable row level security;

create policy "hpo_accounts_owner_all" on public.hpo_accounts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_contacts_owner_all" on public.hpo_contacts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_interactions_owner_all" on public.hpo_interactions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_sales_metrics_owner_all" on public.hpo_sales_metrics for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_route_plans_owner_all" on public.hpo_route_plans for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_route_stops_owner_all" on public.hpo_route_stops for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_data_imports_owner_all" on public.hpo_data_imports for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "hpo_import_rows_owner_all" on public.hpo_import_rows for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.hpo_accounts from anon;
revoke all on public.hpo_contacts from anon;
revoke all on public.hpo_interactions from anon;
revoke all on public.hpo_sales_metrics from anon;
revoke all on public.hpo_route_plans from anon;
revoke all on public.hpo_route_stops from anon;
revoke all on public.hpo_data_imports from anon;
revoke all on public.hpo_import_rows from anon;

grant select, insert, update, delete on public.hpo_accounts to authenticated;
grant select, insert, update, delete on public.hpo_contacts to authenticated;
grant select, insert, update, delete on public.hpo_interactions to authenticated;
grant select, insert, update, delete on public.hpo_sales_metrics to authenticated;
grant select, insert, update, delete on public.hpo_route_plans to authenticated;
grant select, insert, update, delete on public.hpo_route_stops to authenticated;
grant select, insert, update, delete on public.hpo_data_imports to authenticated;
grant select, insert, update, delete on public.hpo_import_rows to authenticated;
