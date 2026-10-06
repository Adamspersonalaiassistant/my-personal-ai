-- JARVIS production capacity accounting + task approval semantics.
--
-- Capacity ("accepted today") means REAL production engineering tasks Adam
-- approved and the worker accepted today. Proposed tasks, validation fixtures,
-- cancelled/superseded/deferred/merged tasks never consume it.
--
-- Smallest durable model: is_fixture already exists. Add approval_state
-- (proposed | approved | superseded), approved_at and batch_id. Existing rows
-- default to 'approved' (the previous behaviour), so no history is rewritten.

alter table public.jarvis_engineering_tasks
  add column if not exists approval_state text not null default 'approved',
  add column if not exists approved_at timestamptz,
  add column if not exists batch_id uuid;

alter table public.jarvis_engineering_tasks
  drop constraint if exists jarvis_tasks_approval_state_check;
alter table public.jarvis_engineering_tasks
  add constraint jarvis_tasks_approval_state_check
  check (approval_state in ('proposed','approved','superseded'));

create index if not exists jarvis_tasks_batch_idx
  on public.jarvis_engineering_tasks(batch_id) where batch_id is not null;
create index if not exists jarvis_tasks_proposed_idx
  on public.jarvis_engineering_tasks(user_id) where approval_state = 'proposed';

-- The worker only claims tasks Adam approved. Proposed/superseded tasks never run.
create or replace function public.jarvis_claim_tasks(
  p_worker text,
  p_limit integer default 4,
  p_lease_seconds integer default 240,
  p_max_active integer default 4,
  p_max_writers integer default 1
)
returns setof public.jarvis_engineering_tasks
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_active integer;
  v_writers integer;
  v_claimed integer := 0;
  v_slots integer;
  v_is_writer boolean;
  rec public.jarvis_engineering_tasks%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('jarvis_claim_tasks'));

  select count(*),
         count(*) filter (where coalesce(task_spec->>'kind', 'diagnostic') = 'code_change')
    into v_active, v_writers
    from public.jarvis_engineering_tasks
   where lease_expires_at > now();

  v_slots := least(p_limit, p_max_active - v_active);
  if v_slots <= 0 then
    return;
  end if;

  for rec in
    select t.*
      from public.jarvis_engineering_tasks t
     where t.status in ('queued','validating','researching','planning','building','testing','repairing')
       and t.approval_state = 'approved'
       and (t.lease_expires_at is null or t.lease_expires_at < now())
       and t.next_attempt_at <= now()
       and not exists (
         select 1 from public.jarvis_engineering_tasks d
          where d.id = any(t.depends_on)
            and d.status in ('queued','validating','researching','planning','building','testing','repairing')
       )
     order by t.priority asc, t.created_at asc
     for update skip locked
  loop
    v_is_writer := coalesce(rec.task_spec->>'kind', 'diagnostic') = 'code_change';
    if v_is_writer and v_writers >= p_max_writers then
      continue;
    end if;
    return query
      update public.jarvis_engineering_tasks t
         set lease_token = gen_random_uuid(),
             leased_by = p_worker,
             lease_expires_at = now() + make_interval(secs => p_lease_seconds),
             attempt_count = t.attempt_count + 1
       where t.id = rec.id
      returning t.*;
    v_claimed := v_claimed + 1;
    if v_is_writer then
      v_writers := v_writers + 1;
    end if;
    exit when v_claimed >= v_slots;
  end loop;
end;
$$;

revoke all on function public.jarvis_claim_tasks(text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.jarvis_claim_tasks(text, integer, integer, integer, integer) to service_role;


-- Atomic daily intake. Counts only tasks of the same class as the one being
-- accepted: real production tasks against the production ceiling, validation
-- fixtures against their own (so the capacity mechanics stay testable without
-- ever consuming Adam's real slots). Cancelled, superseded, deferred and merged
-- tasks do not count.
create or replace function public.jarvis_accept_task(
  p_task uuid,
  p_lease uuid,
  p_session uuid,
  p_date date,
  p_limit integer
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_user uuid;
  v_fixture boolean;
  v_count integer;
begin
  select user_id, is_fixture into v_user, v_fixture
    from public.jarvis_engineering_tasks
   where id = p_task and lease_token = p_lease and approval_state = 'approved';
  if v_user is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('jarvis_accept:' || v_user::text || ':' || p_date::text));
  select count(*) into v_count
    from public.jarvis_engineering_tasks t
    join public.jarvis_engineering_sessions s on s.id = t.session_id
   where s.user_id = v_user and s.session_date = p_date
     and t.is_fixture = v_fixture
     and t.approval_state = 'approved'
     and t.status not in ('cancelled','deferred')
     and t.merged_into is null;
  if v_count >= p_limit then
    return false;
  end if;
  update public.jarvis_engineering_tasks
     set session_id = p_session
   where id = p_task and lease_token = p_lease and session_id is null;
  if not found then
    return false;
  end if;
  if v_fixture then
    update public.jarvis_engineering_sessions
       set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{fixture_accepted}', to_jsonb(v_count + 1))
     where id = p_session;
  else
    update public.jarvis_engineering_sessions set accepted_count = v_count + 1 where id = p_session;
  end if;
  return true;
end;
$function$;

revoke all on function public.jarvis_accept_task(uuid, uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.jarvis_accept_task(uuid, uuid, uuid, date, integer) to service_role;
