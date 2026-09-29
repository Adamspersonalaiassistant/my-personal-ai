-- Durable Today/field continuity plus bounded undo for remaining-stop replacement.
-- All ownership is derived from auth.uid(); no caller-supplied user id is trusted.

create table if not exists public.emery_field_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  route_id uuid references public.hpo_route_plans(id) on delete set null,
  current_stop_id uuid references public.hpo_route_stops(id) on delete set null,
  expected_note_stop_id uuid references public.hpo_route_stops(id) on delete set null,
  expected_note_account_id uuid references public.hpo_accounts(id) on delete set null,
  expected_note_prospect_id uuid references public.hpo_prospects(id) on delete set null,
  expected_note_meeting_id uuid references public.meetings(id) on delete set null,
  planned_meetings jsonb not null default '[]'::jsonb,
  optional_prospecting boolean not null default false,
  last_completed_stop_id uuid references public.hpo_route_stops(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, session_date)
);

create index if not exists emery_field_sessions_user_status_idx
  on public.emery_field_sessions(user_id, status, session_date desc);

alter table public.emery_field_sessions enable row level security;
drop policy if exists "emery_field_sessions_owner_all" on public.emery_field_sessions;
create policy "emery_field_sessions_owner_all"
  on public.emery_field_sessions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.emery_field_sessions from anon;
grant select, insert, update, delete on public.emery_field_sessions to authenticated;

create or replace function public.emery_sync_route_field_session()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_field jsonb := coalesce(new.metadata->'field_session', '{}'::jsonb);
begin
  if jsonb_typeof(v_field) <> 'object' then
    return new;
  end if;
  if coalesce((v_field->>'active')::boolean, false) is false then
    update public.emery_field_sessions
    set status = 'completed',
        expected_note_stop_id = null,
        expected_note_account_id = null,
        expected_note_prospect_id = null,
        ended_at = coalesce(ended_at, now()),
        updated_at = now()
    where user_id = new.user_id and session_date = new.route_date and route_id = new.id;
    return new;
  end if;
  insert into public.emery_field_sessions (
    user_id, session_date, status, route_id,
    expected_note_stop_id, expected_note_account_id, expected_note_prospect_id,
    metadata, updated_at
  ) values (
    new.user_id, new.route_date, 'active', new.id,
    nullif(v_field->>'expected_note_target_stop_id','')::uuid,
    nullif(v_field->>'expected_note_target_account_id','')::uuid,
    nullif(v_field->>'expected_note_target_prospect_id','')::uuid,
    jsonb_build_object('armed_at', v_field->>'armed_at', 'source', 'route'),
    now()
  )
  on conflict (user_id, session_date) do update set
    status = 'active',
    route_id = excluded.route_id,
    expected_note_stop_id = excluded.expected_note_stop_id,
    expected_note_account_id = excluded.expected_note_account_id,
    expected_note_prospect_id = excluded.expected_note_prospect_id,
    metadata = public.emery_field_sessions.metadata || excluded.metadata,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists emery_sync_route_field_session_trigger on public.hpo_route_plans;
create trigger emery_sync_route_field_session_trigger
after insert or update of metadata on public.hpo_route_plans
for each row execute function public.emery_sync_route_field_session();

create or replace function public.emery_hpo_restore_remaining_route_stops(
  p_route_id uuid,
  p_previous_open_stops jsonb,
  p_expected_current_stop_ids uuid[],
  p_previous_field_session jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_ids uuid[];
  v_restored_ids uuid[];
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(coalesce(p_previous_open_stops, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_undo_snapshot';
  end if;

  perform 1 from public.hpo_route_plans
    where id = p_route_id and user_id = v_user_id for update;
  if not found then raise exception 'route_not_found_or_not_owned'; end if;

  select coalesce(array_agg(id order by id), array[]::uuid[]) into v_current_ids
  from public.hpo_route_stops
  where route_id = p_route_id and user_id = v_user_id
    and status not in ('completed','visited','skipped','closed','bad_address');

  if v_current_ids is distinct from (
    select coalesce(array_agg(x order by x), array[]::uuid[])
    from unnest(coalesce(p_expected_current_stop_ids, array[]::uuid[])) x
  ) then
    raise exception 'undo_conflict_route_changed';
  end if;

  delete from public.hpo_route_stops
  where route_id = p_route_id and user_id = v_user_id
    and status not in ('completed','visited','skipped','closed','bad_address');

  insert into public.hpo_route_stops (
    id,user_id,route_id,account_id,prospect_id,stop_order,visit_priority,status,
    planned_at,visited_at,notes,metadata,office_name,address,city,latitude,longitude,
    distance_from_previous_meters,drive_seconds_from_previous,created_at,updated_at
  )
  select
    x.id,v_user_id,p_route_id,x.account_id,x.prospect_id,x.stop_order,x.visit_priority,
    coalesce(x.status,'planned'),x.planned_at,x.visited_at,x.notes,coalesce(x.metadata,'{}'::jsonb),
    x.office_name,x.address,x.city,x.latitude,x.longitude,
    x.distance_from_previous_meters,x.drive_seconds_from_previous,
    coalesce(x.created_at,now()),now()
  from jsonb_to_recordset(coalesce(p_previous_open_stops,'[]'::jsonb)) as x(
    id uuid, account_id uuid, prospect_id uuid, stop_order integer, visit_priority text,
    status text, planned_at timestamptz, visited_at timestamptz, notes text, metadata jsonb,
    office_name text, address text, city text, latitude double precision, longitude double precision,
    distance_from_previous_meters integer, drive_seconds_from_previous integer,
    created_at timestamptz
  );

  select coalesce(array_agg(id order by stop_order), array[]::uuid[]) into v_restored_ids
  from public.hpo_route_stops
  where route_id = p_route_id and user_id = v_user_id
    and status not in ('completed','visited','skipped','closed','bad_address');

  update public.hpo_route_plans
  set metadata = case
      when p_previous_field_session is null
        then coalesce(metadata,'{}'::jsonb) - 'field_session'
      else jsonb_set(coalesce(metadata,'{}'::jsonb), '{field_session}', p_previous_field_session, true)
    end,
    optimized_at = null,
    optimized_distance_meters = null,
    optimized_duration_seconds = null,
    updated_at = now()
  where id = p_route_id and user_id = v_user_id;

  return jsonb_build_object(
    'route_id', p_route_id,
    'restored_stop_ids', v_restored_ids,
    'restored_count', cardinality(v_restored_ids)
  );
end;
$$;

revoke all on function public.emery_hpo_restore_remaining_route_stops(uuid,jsonb,uuid[],jsonb)
  from public, anon;
grant execute on function public.emery_hpo_restore_remaining_route_stops(uuid,jsonb,uuid[],jsonb)
  to authenticated;
