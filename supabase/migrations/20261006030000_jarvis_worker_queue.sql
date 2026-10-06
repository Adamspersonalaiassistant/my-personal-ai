-- JARVIS Run 2: durable engineering worker queue on the existing ledger.
--
-- jarvis_engineering_tasks stays the single authoritative work-state table.
-- Leases + fencing tokens make execution safe against retries, timeouts,
-- worker restarts and duplicate scheduler invocations:
--   * jarvis_claim_tasks() serialises claims (advisory xact lock), skips locked
--     rows, honours dependencies, and caps concurrency (max active leases and
--     max concurrent code-writing tasks).
--   * Every worker write is conditioned on the lease_token it was given, so a
--     stale worker whose lease expired cannot overwrite a newer one.
--   * An open-task unique index on dedupe_key prevents duplicate intake.
-- One cron job kicks one worker. No per-task cron jobs.

alter table public.jarvis_engineering_tasks
  add column if not exists task_spec jsonb not null default '{}'::jsonb,
  add column if not exists stage_state jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists dedupe_key text,
  add column if not exists depends_on uuid[] not null default '{}'::uuid[],
  add column if not exists merged_into uuid references public.jarvis_engineering_tasks(id) on delete set null,
  add column if not exists lease_token uuid,
  add column if not exists leased_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists is_fixture boolean not null default false;

create unique index if not exists jarvis_tasks_open_dedupe_idx
  on public.jarvis_engineering_tasks(user_id, dedupe_key)
  where dedupe_key is not null
    and status in ('queued','validating','researching','planning','building','testing','repairing','blocked');

create index if not exists jarvis_tasks_runnable_idx
  on public.jarvis_engineering_tasks(next_attempt_at, priority, created_at)
  where status in ('queued','validating','researching','planning','building','testing','repairing');

create index if not exists jarvis_tasks_merged_into_idx on public.jarvis_engineering_tasks(merged_into);

create or replace function public.jarvis_claim_tasks(
  p_worker text,
  p_limit integer default 4,
  p_lease_seconds integer default 240,
  p_max_active integer default 4,
  p_max_writers integer default 1
)
returns setof public.jarvis_engineering_tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_active integer;
  v_writers integer;
  v_claimed integer := 0;
  v_slots integer;
  v_is_writer boolean;
  rec public.jarvis_engineering_tasks%rowtype;
begin
  -- Serialise claimers so concurrency caps cannot be raced by parallel ticks.
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
            and d.status not in ('completed','ready_for_release')
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
$function$;

revoke all on function public.jarvis_claim_tasks(text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.jarvis_claim_tasks(text, integer, integer, integer, integer) to service_role;

-- Internal worker credential, generated in-database and never exposed.
insert into private.system_secrets (name, secret)
select 'jarvis_worker', encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from private.system_secrets where name = 'jarvis_worker');

create or replace function public.jarvis_kick_worker(p_reason text default 'cron')
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_request bigint;
begin
  select net.http_post(
    url := 'https://pmuanzegplyoewtombss.supabase.co/functions/v1/jarvis-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jarvis-worker-key', (select secret from private.system_secrets where name = 'jarvis_worker')
    ),
    body := jsonb_build_object('source', left(coalesce(p_reason, 'cron'), 40), 'time', now()),
    timeout_milliseconds := 5000
  ) into v_request;
  return v_request;
end;
$function$;

revoke all on function public.jarvis_kick_worker(text) from public, anon, authenticated;
grant execute on function public.jarvis_kick_worker(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'jarvis-worker-tick';
select cron.schedule('jarvis-worker-tick', '*/2 * * * *', $cron$select public.jarvis_kick_worker('cron')$cron$);

-- One open (queued/running) engineering session per owner per day.
create unique index if not exists jarvis_sessions_one_open_per_day_idx
  on public.jarvis_engineering_sessions(user_id, session_date)
  where status in ('queued','running');

-- Atomic daily intake: serialised per owner/day so concurrent acceptances can
-- never exceed the capacity ceiling. Fenced by the caller's lease token.
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
  v_count integer;
begin
  select user_id into v_user
    from public.jarvis_engineering_tasks
   where id = p_task and lease_token = p_lease;
  if v_user is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('jarvis_accept:' || v_user::text || ':' || p_date::text));
  select count(*) into v_count
    from public.jarvis_engineering_tasks t
    join public.jarvis_engineering_sessions s on s.id = t.session_id
   where s.user_id = v_user and s.session_date = p_date;
  if v_count >= p_limit then
    return false;
  end if;
  update public.jarvis_engineering_tasks
     set session_id = p_session
   where id = p_task and lease_token = p_lease and session_id is null;
  if not found then
    return false;
  end if;
  update public.jarvis_engineering_sessions set accepted_count = v_count + 1 where id = p_session;
  return true;
end;
$function$;

revoke all on function public.jarvis_accept_task(uuid, uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.jarvis_accept_task(uuid, uuid, uuid, date, integer) to service_role;
