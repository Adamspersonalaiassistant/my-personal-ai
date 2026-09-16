-- Bring an already-provisioned HPO Operating System forward to the hardened import-ready schema.
-- Additive and ownership-safe; HPO remains intentionally non-PHI.

alter table public.hpo_accounts
  add column if not exists relationship_health text,
  add column if not exists opportunity text,
  add column if not exists blockers text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists source_ref text,
  add column if not exists dedupe_key text,
  add column if not exists next_interaction_at timestamptz;

alter table public.hpo_contacts
  add column if not exists source_origin text,
  add column if not exists source_ref text,
  add column if not exists dedupe_key text;

alter table public.hpo_sales_metrics
  add column if not exists source_ref text;

alter table public.hpo_route_plans
  add column if not exists source_ref text;

-- Composite uniqueness lets child references enforce that the parent belongs to the same user.
alter table public.hpo_accounts
  add constraint hpo_accounts_user_id_id_key unique (user_id, id);
alter table public.hpo_contacts
  add constraint hpo_contacts_user_id_id_key unique (user_id, id);
alter table public.hpo_route_plans
  add constraint hpo_route_plans_user_id_id_key unique (user_id, id);
alter table public.hpo_data_imports
  add constraint hpo_data_imports_user_id_id_key unique (user_id, id);

alter table public.hpo_contacts
  drop constraint if exists hpo_contacts_account_id_fkey,
  add constraint hpo_contacts_user_account_fkey
    foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id) on delete cascade;

alter table public.hpo_interactions
  drop constraint if exists hpo_interactions_account_id_fkey,
  drop constraint if exists hpo_interactions_contact_id_fkey,
  add constraint hpo_interactions_user_account_fkey
    foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id) on delete cascade,
  add constraint hpo_interactions_user_contact_fkey
    foreign key (user_id, contact_id)
    references public.hpo_contacts(user_id, id);

alter table public.hpo_sales_metrics
  drop constraint if exists hpo_sales_metrics_account_id_fkey,
  add constraint hpo_sales_metrics_user_account_fkey
    foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id);

alter table public.hpo_route_stops
  drop constraint if exists hpo_route_stops_route_id_fkey,
  drop constraint if exists hpo_route_stops_account_id_fkey,
  add constraint hpo_route_stops_user_route_fkey
    foreign key (user_id, route_id)
    references public.hpo_route_plans(user_id, id) on delete cascade,
  add constraint hpo_route_stops_user_account_fkey
    foreign key (user_id, account_id)
    references public.hpo_accounts(user_id, id);

-- Stage imported rows before promotion so CSV/Excel/chat-history ingestion can be reviewed,
-- deduplicated, retried, and rolled back without contaminating live account history.
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

create index if not exists hpo_accounts_user_last_touch_idx
  on public.hpo_accounts(user_id, last_touch_at desc);
create unique index if not exists hpo_accounts_user_dedupe_key_idx
  on public.hpo_accounts(user_id, dedupe_key) where dedupe_key is not null;
create unique index if not exists hpo_contacts_user_dedupe_key_idx
  on public.hpo_contacts(user_id, dedupe_key) where dedupe_key is not null;
create unique index if not exists hpo_interactions_user_source_ref_idx
  on public.hpo_interactions(user_id, source_type, source_ref) where source_ref is not null;
create index if not exists hpo_import_rows_user_import_idx
  on public.hpo_import_rows(user_id, import_id, row_number);
create index if not exists hpo_import_rows_user_status_idx
  on public.hpo_import_rows(user_id, status, entity_type);

alter table public.hpo_import_rows enable row level security;

create policy "hpo_import_rows_owner_all"
  on public.hpo_import_rows
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.hpo_import_rows from anon;
grant select, insert, update, delete on public.hpo_import_rows to authenticated;
