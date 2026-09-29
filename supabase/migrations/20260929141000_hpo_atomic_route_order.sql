-- Atomic route-order application for Emery HPO.
-- All order changes occur inside one PostgreSQL transaction so the unique
-- (route_id, stop_order) constraint cannot leave a half-staged route.

create or replace function public.emery_hpo_apply_route_order(
  p_route_id uuid,
  p_stop_ids uuid[],
  p_distance_meters integer[] default null,
  p_drive_seconds integer[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_distinct_count integer;
  v_index integer;
  v_stop_id uuid;
  v_terminal_moved boolean;
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

  select count(*) into v_count
  from public.hpo_route_stops
  where route_id = p_route_id and user_id = v_user_id
  for update;

  if coalesce(array_length(p_stop_ids, 1), 0) <> v_count then
    raise exception 'route_order_must_include_every_stop';
  end if;

  select count(distinct value) into v_distinct_count
  from unnest(p_stop_ids) as t(value);
  if v_distinct_count <> v_count then
    raise exception 'route_order_contains_duplicate_stop';
  end if;

  if exists (
    select 1
    from unnest(p_stop_ids) as t(value)
    where not exists (
      select 1 from public.hpo_route_stops s
      where s.id = t.value and s.route_id = p_route_id and s.user_id = v_user_id
    )
  ) then
    raise exception 'route_order_contains_foreign_stop';
  end if;

  select exists (
    select 1
    from public.hpo_route_stops s
    where s.route_id = p_route_id
      and s.user_id = v_user_id
      and s.status in ('completed','visited','skipped','closed','bad_address')
      and array_position(p_stop_ids, s.id) <> s.stop_order
  ) into v_terminal_moved;

  if v_terminal_moved then
    raise exception 'terminal_route_history_cannot_move';
  end if;

  -- Stage only unfinished stops well outside the live order range. Because this
  -- happens in the same function call, any later error rolls the staging back.
  update public.hpo_route_stops
  set stop_order = stop_order + 10000,
      updated_at = now()
  where route_id = p_route_id
    and user_id = v_user_id
    and status not in ('completed','visited','skipped','closed','bad_address');

  for v_index in 1..v_count loop
    v_stop_id := p_stop_ids[v_index];
    update public.hpo_route_stops
    set
      stop_order = v_index,
      distance_meters_from_previous = case
        when p_distance_meters is null then distance_meters_from_previous
        else p_distance_meters[v_index]
      end,
      drive_seconds_from_previous = case
        when p_drive_seconds is null then drive_seconds_from_previous
        else p_drive_seconds[v_index]
      end,
      updated_at = now()
    where id = v_stop_id
      and route_id = p_route_id
      and user_id = v_user_id
      and status not in ('completed','visited','skipped','closed','bad_address');
  end loop;

  return jsonb_build_object(
    'route_id', p_route_id,
    'stop_count', v_count,
    'stop_ids', to_jsonb(p_stop_ids),
    'applied', true
  );
end;
$$;

revoke all on function public.emery_hpo_apply_route_order(uuid,uuid[],integer[],integer[]) from public;
grant execute on function public.emery_hpo_apply_route_order(uuid,uuid[],integer[],integer[]) to authenticated;
