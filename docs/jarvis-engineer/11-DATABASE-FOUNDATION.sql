-- JARVIS Engineer database foundation.
-- Applied to production Supabase on 2026-10-05 through the authenticated Supabase management connection.
-- This file is a durable schema record for the foundation branch. Before merging, convert/reconcile it with the repository's canonical Supabase migration workflow if required by current repo conventions.

create table public.jarvis_engineering_sessions (
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

create table public.jarvis_engineering_tasks (
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

create table public.jarvis_research_findings (
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

create table public.emery_releases (
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

-- Ownership RLS follows Emery's existing single-owner pattern:
-- to authenticated using (is_emery_owner() and user_id = auth.uid())
-- with check (is_emery_owner() and user_id = auth.uid()).
--
-- Completion notification trigger inserts one pending app_notifications row per
-- final JARVIS session using source_type='jarvis_engineering_session'.
