-- JARVIS Engineer foundation — canonical reconciliation.
--
-- These tables were applied to production on 2026-10-05 during the JARVIS
-- foundation bootstrap (see docs/jarvis-engineer/11-DATABASE-FOUNDATION.sql and
-- 14-KNOWLEDGE-STORE-SCHEMA.sql). This migration records the same schema in the
-- repository's canonical migration workflow. It is fully idempotent: on the live
-- project every statement is a no-op or an identical replacement, so no duplicate
-- tables are created and no data is touched.

create table if not exists public.jarvis_engineering_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_id uuid references public.agents(id) on delete set null,
  session_date date not null default ((now() at time zone 'America/New_York')::date),
  status text not null default 'queued' check (status in ('queued','running','completed','completed_with_blockers','failed','cancelled')),
  intake_limit integer not null default 50 check (intake_limit between 1 and 500),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  ready_for_release_count integer not null default 0 check (ready_for_release_count >= 0),
  blocked_count integer not null default 0 check (blocked_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  approval_required boolean not null default false,
  summary text,
  self_research_summary text,
  self_research_classification text check (self_research_classification is null or self_research_classification in ('ignore','watch','test','adopt','engineering_task')),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jarvis_engineering_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid references public.jarvis_engineering_sessions(id) on delete set null,
  source_type text not null default 'adam',
  source_ref text,
  title text not null,
  objective text,
  why_it_matters text,
  task_type text not null default 'engineering',
  priority smallint not null default 3 check (priority between 1 and 5),
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  status text not null default 'queued' check (status in ('queued','validating','researching','planning','building','testing','repairing','ready_for_release','completed','blocked','deferred','failed','cancelled')),
  acceptance_criteria jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  research_used jsonb not null default '[]'::jsonb,
  files_changed jsonb not null default '[]'::jsonb,
  branch_name text,
  commit_sha text,
  pr_url text,
  test_results jsonb not null default '{}'::jsonb,
  result_summary text,
  blocker text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  scheduled_for date,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jarvis_research_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid references public.jarvis_engineering_sessions(id) on delete cascade,
  task_id uuid references public.jarvis_engineering_tasks(id) on delete set null,
  topic text not null,
  finding text not null,
  source_url text,
  source_type text,
  license_note text,
  relevance text,
  recommendation text,
  classification text not null default 'watch' check (classification in ('ignore','watch','test','adopt','engineering_task')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.emery_releases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  release_name text,
  production_commit_sha text not null,
  previous_production_commit_sha text,
  source_branch text,
  source_pr_url text,
  deployed_at timestamptz,
  summary text not null,
  capabilities_added jsonb not null default '[]'::jsonb,
  capabilities_changed jsonb not null default '[]'::jsonb,
  bugs_fixed jsonb not null default '[]'::jsonb,
  known_limitations jsonb not null default '[]'::jsonb,
  tests_run jsonb not null default '{}'::jsonb,
  deployment_verified boolean not null default false,
  produced_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, production_commit_sha)
);

create table if not exists public.jarvis_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null check (category in (
    'product_decision','user_preference','constraint','failure_signal',
    'workflow_requirement','acceptance_test','architecture','history','lesson','research_reference'
  )),
  title text not null,
  content text not null,
  status text not null default 'current' check (status in ('current','historical','superseded')),
  importance smallint not null default 3 check (importance between 1 and 5),
  source_type text not null,
  source_ref text,
  source_timestamp timestamptz,
  supersedes_id uuid references public.jarvis_knowledge_items(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jarvis_sessions_user_date_idx on public.jarvis_engineering_sessions(user_id, session_date desc);
create index if not exists jarvis_sessions_agent_idx on public.jarvis_engineering_sessions(agent_id);
create index if not exists jarvis_tasks_user_status_idx on public.jarvis_engineering_tasks(user_id, status, priority, created_at);
create index if not exists jarvis_tasks_session_idx on public.jarvis_engineering_tasks(session_id, status);
create index if not exists jarvis_research_session_idx on public.jarvis_research_findings(session_id, created_at);
create index if not exists jarvis_research_task_idx on public.jarvis_research_findings(task_id);
create index if not exists emery_releases_user_deployed_idx on public.emery_releases(user_id, deployed_at desc nulls last, created_at desc);
create index if not exists jarvis_knowledge_user_category_idx on public.jarvis_knowledge_items(user_id, status, category, importance desc, updated_at desc);
create index if not exists jarvis_knowledge_source_idx on public.jarvis_knowledge_items(user_id, source_type, source_ref);
create index if not exists jarvis_knowledge_supersedes_idx on public.jarvis_knowledge_items(supersedes_id);

-- Single-owner RLS, identical to Emery's existing owner guard.
do $$
declare
  t text;
begin
  foreach t in array array[
    'jarvis_engineering_sessions','jarvis_engineering_tasks','jarvis_research_findings',
    'emery_releases','jarvis_knowledge_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'emery_single_owner_guard'
    ) then
      execute format(
        'create policy "emery_single_owner_guard" on public.%I for all to authenticated
           using ((select public.is_emery_owner()) and user_id = (select auth.uid()))
           with check ((select public.is_emery_owner()) and user_id = (select auth.uid()))',
        t
      );
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

create or replace trigger set_jarvis_engineering_sessions_updated_at
before update on public.jarvis_engineering_sessions
for each row execute function public.set_updated_at();

create or replace trigger set_jarvis_engineering_tasks_updated_at
before update on public.jarvis_engineering_tasks
for each row execute function public.set_updated_at();

create or replace trigger set_emery_releases_updated_at
before update on public.emery_releases
for each row execute function public.set_updated_at();

create or replace trigger set_jarvis_knowledge_items_updated_at
before update on public.jarvis_knowledge_items
for each row execute function public.set_updated_at();

-- One completion notification per finished JARVIS session (no per-task spam).
create or replace function public.notify_jarvis_session_complete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.status in ('completed','completed_with_blockers','failed')
     and old.status is distinct from new.status then
    insert into public.app_notifications (
      user_id,title,body,scheduled_for,status,source_type,source_ref,metadata
    ) values (
      new.user_id,
      'JARVIS engineering session complete',
      'Completed: ' || new.completed_count ||
      ' · Ready: ' || new.ready_for_release_count ||
      ' · Blocked: ' || new.blocked_count ||
      ' · Failed: ' || new.failed_count ||
      case when new.approval_required then ' · Approval needed.' else ' · Ready for more tasks.' end,
      now(),
      'pending',
      'jarvis_engineering_session',
      new.id::text,
      jsonb_build_object(
        'session_id', new.id,
        'session_date', new.session_date,
        'status', new.status,
        'accepted_count', new.accepted_count,
        'completed_count', new.completed_count,
        'ready_for_release_count', new.ready_for_release_count,
        'blocked_count', new.blocked_count,
        'failed_count', new.failed_count,
        'approval_required', new.approval_required,
        'ready_for_more_tasks', not new.approval_required
      )
    ) on conflict do nothing;
  end if;
  return new;
end;
$function$;

create or replace trigger jarvis_session_complete_notification
before update on public.jarvis_engineering_sessions
for each row execute function public.notify_jarvis_session_complete();
