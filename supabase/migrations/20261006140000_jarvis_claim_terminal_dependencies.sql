-- JARVIS worker: a task waits only while a dependency is still in progress.
-- Previously a dependency that failed, was blocked, or was merged away as a
-- duplicate left its dependent queued forever, because validation (which
-- rewires merged dependencies and blocks on failed ones) never got to run.
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
