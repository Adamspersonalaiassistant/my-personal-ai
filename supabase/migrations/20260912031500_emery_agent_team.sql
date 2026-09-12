create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  slug text not null,
  description text not null default '',
  persona text not null default '',
  mission text not null default '',
  parent_agent_id uuid references public.agents(id) on delete cascade,
  is_internal boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists agents_user_parent_idx
  on public.agents(user_id, parent_agent_id, sort_order);
create index if not exists agents_parent_agent_idx
  on public.agents(parent_agent_id);

alter table public.agents enable row level security;
revoke all on table public.agents from anon;
revoke all on table public.agents from authenticated;
grant select, insert, update, delete on table public.agents to authenticated;

drop policy if exists "Users can read own agents" on public.agents;
create policy "Users can read own agents"
  on public.agents for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own agents" on public.agents;
create policy "Users can insert own agents"
  on public.agents for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own agents" on public.agents;
create policy "Users can update own agents"
  on public.agents for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own agents" on public.agents;
create policy "Users can delete own agents"
  on public.agents for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  title text not null default 'Agent chat',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, agent_id)
);

create index if not exists agent_threads_user_idx
  on public.agent_threads(user_id, updated_at desc);
create index if not exists agent_threads_agent_idx
  on public.agent_threads(agent_id);

alter table public.agent_threads enable row level security;
revoke all on table public.agent_threads from anon;
revoke all on table public.agent_threads from authenticated;
grant select, insert, update, delete on table public.agent_threads to authenticated;

drop policy if exists "Users can read own agent threads" on public.agent_threads;
create policy "Users can read own agent threads"
  on public.agent_threads for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own agent threads" on public.agent_threads;
create policy "Users can insert own agent threads"
  on public.agent_threads for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own agent threads" on public.agent_threads;
create policy "Users can update own agent threads"
  on public.agent_threads for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own agent threads" on public.agent_threads;
create policy "Users can delete own agent threads"
  on public.agent_threads for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  speaker text not null check (speaker in ('user','emery','agent')),
  speaker_name text not null default '',
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_messages_thread_idx
  on public.agent_messages(thread_id, created_at);

alter table public.agent_messages enable row level security;
revoke all on table public.agent_messages from anon;
revoke all on table public.agent_messages from authenticated;
grant select, insert, delete on table public.agent_messages to authenticated;

drop policy if exists "Users can read own agent messages" on public.agent_messages;
create policy "Users can read own agent messages"
  on public.agent_messages for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own agent messages" on public.agent_messages;
create policy "Users can insert own agent messages"
  on public.agent_messages for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own agent messages" on public.agent_messages;
create policy "Users can delete own agent messages"
  on public.agent_messages for delete to authenticated
  using ((select auth.uid()) = user_id);
