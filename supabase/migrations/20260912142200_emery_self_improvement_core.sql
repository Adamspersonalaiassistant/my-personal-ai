create table if not exists public.emery_improvement_backlog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  area text not null check (area in ('response','memory','action','agent','ux','system')),
  title text not null,
  problem_statement text not null,
  evidence jsonb not null default '[]'::jsonb,
  severity integer not null default 2 check (severity between 1 and 5),
  expected_benefit text,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status text not null default 'observed' check (status in ('observed','proposed','testing','accepted','rejected','rolled_back')),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.emery_self_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('response','memory','action','agent','ux','system')),
  target_ref text,
  rubric_version text not null default 'v1',
  scores jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.emery_improvement_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  backlog_id uuid references public.emery_improvement_backlog(id) on delete set null,
  change_type text not null,
  scope text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  rationale text not null,
  validation jsonb not null default '{}'::jsonb,
  rollback_state jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','testing','accepted','rejected','rolled_back')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  rolled_back_at timestamptz
);

create table if not exists public.emery_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  response_verbosity text not null default 'concise' check (response_verbosity in ('concise','balanced','detailed')),
  agent_route_confidence numeric not null default 0.88 check (agent_route_confidence >= 0.5 and agent_route_confidence <= 0.99),
  memory_max_items integer not null default 16 check (memory_max_items between 6 and 30),
  memory_max_characters integer not null default 6500 check (memory_max_characters between 2000 and 12000),
  proactive_focus_enabled boolean not null default true,
  auto_apply_low_risk boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.emery_agent_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_slug text not null,
  conversation_id uuid,
  message_id uuid,
  delegated_count integer not null default 0 check (delegated_count >= 0),
  web_used boolean not null default false,
  succeeded boolean,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists emery_improvement_backlog_user_status_idx on public.emery_improvement_backlog(user_id, status, severity desc, updated_at desc);
create index if not exists emery_self_evaluations_user_created_idx on public.emery_self_evaluations(user_id, created_at desc);
create index if not exists emery_improvement_changes_user_created_idx on public.emery_improvement_changes(user_id, created_at desc);
create index if not exists emery_agent_metrics_user_agent_created_idx on public.emery_agent_metrics(user_id, agent_slug, created_at desc);

alter table public.emery_improvement_backlog enable row level security;
alter table public.emery_self_evaluations enable row level security;
alter table public.emery_improvement_changes enable row level security;
alter table public.emery_config enable row level security;
alter table public.emery_agent_metrics enable row level security;

drop policy if exists "users manage own improvement backlog" on public.emery_improvement_backlog;
create policy "users manage own improvement backlog" on public.emery_improvement_backlog for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users manage own self evaluations" on public.emery_self_evaluations;
create policy "users manage own self evaluations" on public.emery_self_evaluations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users manage own improvement changes" on public.emery_improvement_changes;
create policy "users manage own improvement changes" on public.emery_improvement_changes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users manage own emery config" on public.emery_config;
create policy "users manage own emery config" on public.emery_config for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users manage own agent metrics" on public.emery_agent_metrics;
create policy "users manage own agent metrics" on public.emery_agent_metrics for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.emery_improvement_backlog to authenticated;
grant select, insert, update, delete on public.emery_self_evaluations to authenticated;
grant select, insert, update, delete on public.emery_improvement_changes to authenticated;
grant select, insert, update, delete on public.emery_config to authenticated;
grant select, insert, update, delete on public.emery_agent_metrics to authenticated;