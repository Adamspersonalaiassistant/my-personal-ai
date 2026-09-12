-- Tighten ownership integrity for Emery's agent family without changing existing data.

create or replace function public.enforce_agent_parent_owner()
returns trigger
language plpgsql
as $$
begin
  if new.parent_agent_id is not null then
    if not exists (
      select 1
      from public.agents parent
      where parent.id = new.parent_agent_id
        and parent.user_id = new.user_id
    ) then
      raise exception 'Agent parent must belong to the same user';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists agents_parent_owner_guard on public.agents;
create trigger agents_parent_owner_guard
before insert or update of parent_agent_id, user_id on public.agents
for each row execute function public.enforce_agent_parent_owner();

drop policy if exists "Users can insert own agent threads" on public.agent_threads;
create policy "Users can insert own agent threads"
  on public.agent_threads for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agents a
      where a.id = agent_id
        and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update own agent threads" on public.agent_threads;
create policy "Users can update own agent threads"
  on public.agent_threads for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agents a
      where a.id = agent_id
        and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert own agent messages" on public.agent_messages;
create policy "Users can insert own agent messages"
  on public.agent_messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.agent_threads t
      where t.id = thread_id
        and t.user_id = (select auth.uid())
    )
  );
