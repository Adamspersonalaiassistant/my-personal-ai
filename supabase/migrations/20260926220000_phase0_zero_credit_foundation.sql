create table if not exists public.emery_runtime_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('chat','capture','shortcut','voice','system','hpo')),
  event_type text not null,
  domain text null,
  action text null,
  status text not null default 'ok' check (status in ('ok','error','clarification','skipped')),
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  model text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.emery_runtime_events enable row level security;
drop policy if exists emery_runtime_events_owner on public.emery_runtime_events;
create policy emery_runtime_events_owner on public.emery_runtime_events
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create index if not exists emery_runtime_events_user_created_idx
  on public.emery_runtime_events(user_id, created_at desc);
create index if not exists emery_runtime_events_user_type_idx
  on public.emery_runtime_events(user_id, event_type, created_at desc);

create table if not exists public.emery_routine_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_key text not null,
  run_key text not null,
  status text not null default 'completed' check (status in ('completed','skipped','failed')),
  summary text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, routine_key, run_key)
);
alter table public.emery_routine_runs enable row level security;
drop policy if exists emery_routine_runs_owner on public.emery_routine_runs;
create policy emery_routine_runs_owner on public.emery_routine_runs
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create index if not exists emery_routine_runs_user_created_idx
  on public.emery_routine_runs(user_id, created_at desc);

revoke execute on function public.sync_lunch_confirmation_workflow() from public, anon, authenticated;
revoke execute on function public.validate_internal_cron_token(text, text) from public, anon, authenticated;
grant execute on function public.validate_internal_cron_token(text, text) to service_role;

create index if not exists hpo_interactions_user_contact_idx
  on public.hpo_interactions(user_id, contact_id) where contact_id is not null;
create index if not exists hpo_route_stops_user_account_idx
  on public.hpo_route_stops(user_id, account_id) where account_id is not null;
create index if not exists hpo_sales_metrics_user_account_idx
  on public.hpo_sales_metrics(user_id, account_id) where account_id is not null;
create index if not exists memories_person_idx on public.memories(person_id) where person_id is not null;
create index if not exists memories_project_idx on public.memories(project_id) where project_id is not null;
create index if not exists tasks_person_idx on public.tasks(person_id) where person_id is not null;
create index if not exists tasks_project_idx on public.tasks(project_id) where project_id is not null;
create index if not exists voice_profile_versions_user_idx on public.voice_profile_versions(user_id);
