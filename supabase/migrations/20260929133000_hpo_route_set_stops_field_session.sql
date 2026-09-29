-- Professionalization: atomic remaining-stop replacement and field-note targeting.
-- Preserves completed/terminal route history and derives ownership from auth.uid().

create or replace function public.emery_hpo_set_remaining_route_stops(
  p_route_id uuid,
  p_target_account_id uuid default null,
  p_target_prospect_id uuid default null,
  p_office_name text default null,
  p_address text default null,
  p_city text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_visit_priority text default null,
  p_arm_note_target boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_stop_id uuid;
  v_existing_status text;
  v_next_order integer;
  v_route_metadata jsonb;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  perform 1
  from public.hpo_route_plans
  where id = p_route_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'route_not_found_or_not_owned';
  end if;

  if p_target_account_id is null and p_target_prospect_id is null then
    raise exception 'target_record_required';
  end if;

  select id, status
    into v_target_stop_id, v_existing_status
  from public.hpo_route_stops
  where route_id = p_route_id
    and user_id = v_user_id
    and (
      (p_target_account_id is not null and account_id = p_target_account_id)
      or
      (p_target_prospect_id is not null and prospect_id = p_target_prospect_id)
    )
  order by
    case when status in ('completed','visited','skipped','closed','bad_address') then 1 else 0 end,
    stop_order
  limit 1
  for update;

  if v_target_stop_id is not null
     and v_existing_status in ('completed','visited','skipped','closed','bad_address') then
    raise exception 'target_stop_already_terminal';
  end if;

  -- Remove only unfinished stops other than the requested target.
  delete from public.hpo_route_stops
  where route_id = p_route_id
    and user_id = v_user_id
    and status not in ('completed','visited','skipped','closed','bad_address')
    and (v_target_stop_id is null or id <> v_target_stop_id);

  if v_target_stop_id is null then
    select coalesce(max(stop_order), 0) + 1
      into v_next_order
    from public.hpo_route_stops
    where route_id = p_route_id and user_id = v_user_id;

    insert into public.hpo_route_stops (
      user_id, route_id, account_id, prospect_id, stop_order,
      visit_priority, status, office_name, address, city,
      latitude, longitude, metadata, created_at, updated_at
    )
    values (
      v_user_id, p_route_id, p_target_account_id, p_target_prospect_id, v_next_order,
      p_visit_priority, 'planned', nullif(btrim(p_office_name), ''), nullif(btrim(p_address), ''),
      nullif(btrim(p_city), ''), p_latitude, p_longitude,
      jsonb_build_object('source', 'emery', 'set_as_only_remaining_stop', true),
      v_now, v_now
    )
    returning id into v_target_stop_id;
  else
    update public.hpo_route_stops
    set
      office_name = coalesce(nullif(btrim(p_office_name), ''), office_name),
      address = coalesce(nullif(btrim(p_address), ''), address),
      city = coalesce(nullif(btrim(p_city), ''), city),
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      visit_priority = coalesce(p_visit_priority, visit_priority),
      updated_at = v_now
    where id = v_target_stop_id and user_id = v_user_id;
  end if;

  select metadata into v_route_metadata
  from public.hpo_route_plans
  where id = p_route_id and user_id = v_user_id;

  update public.hpo_route_plans
  set
    status = case when status in ('draft','planned') then 'active' else status end,
    metadata = coalesce(v_route_metadata, '{}'::jsonb) ||
      case when p_arm_note_target then jsonb_build_object(
        'field_session', jsonb_build_object(
          'active', true,
          'expected_note_target_stop_id', v_target_stop_id,
          'expected_note_target_account_id', p_target_account_id,
          'expected_note_target_prospect_id', p_target_prospect_id,
          'armed_at', v_now
        )
      ) else '{}'::jsonb end,
    updated_at = v_now
  where id = p_route_id and user_id = v_user_id;

  return jsonb_build_object(
    'route_id', p_route_id,
    'stop_id', v_target_stop_id,
    'expected_note_target_stop_id', case when p_arm_note_target then v_target_stop_id else null end,
    'preserved_terminal_stops', (
      select count(*)
      from public.hpo_route_stops
      where route_id = p_route_id
        and user_id = v_user_id
        and status in ('completed','visited','skipped','closed','bad_address')
    ),
    'remaining_open_stops', (
      select count(*)
      from public.hpo_route_stops
      where route_id = p_route_id
        and user_id = v_user_id
        and status not in ('completed','visited','skipped','closed','bad_address')
    )
  );
end;
$$;

revoke all on function public.emery_hpo_set_remaining_route_stops(
  uuid,uuid,uuid,text,text,text,double precision,double precision,text,boolean
) from public;
grant execute on function public.emery_hpo_set_remaining_route_stops(
  uuid,uuid,uuid,text,text,text,double precision,double precision,text,boolean
) to authenticated;


-- Consume an armed note target only after the matching stop has been saved.
-- This keeps the session durable across reloads while preventing a later note
-- from silently attaching to an already-completed visit.
create or replace function public.emery_hpo_consume_field_note_target(
  p_route_id uuid,
  p_stop_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_metadata jsonb;
  v_field jsonb;
  v_expected text;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  select metadata
    into v_metadata
  from public.hpo_route_plans
  where id = p_route_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'route_not_found_or_not_owned';
  end if;

  v_field := coalesce(v_metadata->'field_session', '{}'::jsonb);
  v_expected := nullif(v_field->>'expected_note_target_stop_id', '');

  if v_expected is null or v_expected <> p_stop_id::text then
    return jsonb_build_object(
      'consumed', false,
      'reason', 'target_not_armed',
      'expected_stop_id', v_expected
    );
  end if;

  v_field := v_field ||
    jsonb_build_object(
      'active', false,
      'consumed_at', v_now,
      'last_consumed_stop_id', p_stop_id
    )
    - 'expected_note_target_stop_id'
    - 'expected_note_target_account_id'
    - 'expected_note_target_prospect_id';

  update public.hpo_route_plans
  set
    metadata = jsonb_set(coalesce(v_metadata, '{}'::jsonb), '{field_session}', v_field, true),
    updated_at = v_now
  where id = p_route_id and user_id = v_user_id;

  return jsonb_build_object(
    'consumed', true,
    'stop_id', p_stop_id,
    'consumed_at', v_now
  );
end;
$$;

revoke all on function public.emery_hpo_consume_field_note_target(uuid,uuid) from public;
grant execute on function public.emery_hpo_consume_field_note_target(uuid,uuid) to authenticated;
