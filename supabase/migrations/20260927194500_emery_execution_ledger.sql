create table if not exists public.emery_execution_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_message_id uuid null,
  parent_run_id uuid null references public.emery_execution_runs(id) on delete set null,
  domain text not null,
  action text not null,
  status text not null default 'requested',
  idempotency_key text null,
  target_type text null,
  target_id text null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_code text null,
  error_message text null,
  retryable boolean not null default false,
  retry_count integer not null default 0,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint emery_execution_runs_status_check
    check (status in ('requested','validated','running','completed','needs_clarification','failed','cancelled')),
  constraint emery_execution_runs_retry_count_check check (retry_count >= 0)
);

create unique index if not exists emery_execution_runs_user_idempotency_idx
  on public.emery_execution_runs(user_id,idempotency_key)
  where idempotency_key is not null;

create index if not exists emery_execution_runs_user_created_idx
  on public.emery_execution_runs(user_id,created_at desc);

create index if not exists emery_execution_runs_user_status_idx
  on public.emery_execution_runs(user_id,status,created_at desc);

alter table public.emery_execution_runs enable row level security;

drop policy if exists "Users can view own execution runs" on public.emery_execution_runs;
create policy "Users can view own execution runs"
on public.emery_execution_runs for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own execution runs" on public.emery_execution_runs;
create policy "Users can insert own execution runs"
on public.emery_execution_runs for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own execution runs" on public.emery_execution_runs;
create policy "Users can update own execution runs"
on public.emery_execution_runs for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.touch_emery_execution_run_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists emery_execution_runs_touch_updated_at on public.emery_execution_runs;
create trigger emery_execution_runs_touch_updated_at
before update on public.emery_execution_runs
for each row execute function public.touch_emery_execution_run_updated_at();

comment on table public.emery_execution_runs is
  'Verified execution ledger for Emery actions. An action is not considered done until its run is completed with a concrete result.';
