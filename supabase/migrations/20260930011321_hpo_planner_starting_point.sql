-- Require and persist a verified starting point for the Planner workflow.
create or replace function public.emery_hpo_create_planner_selection(
  p_route_date date, p_session_id text, p_area text, p_stops jsonb, p_game_plan jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_route public.hpo_route_plans%rowtype;
  v_count integer;
  v_keys jsonb;
  v_stop jsonb;
  v_start jsonb := p_game_plan->'starting_point';
  v_has_start boolean := v_start is not null and v_start <> 'null'::jsonb;
  v_requires_start boolean := coalesce((p_game_plan->>'planner_workflow')::boolean,false);
  v_index integer := 0;
  v_existing boolean := false;
begin
  if v_user is null then raise exception 'Authentication required.'; end if;
  if p_route_date is null or coalesce(length(p_session_id),0) = 0 or length(p_session_id) > 120 then raise exception 'Choose a Planner date and session.'; end if;
  if jsonb_typeof(p_stops) <> 'array' then raise exception 'Select saved offices.'; end if;
  v_count := jsonb_array_length(p_stops);
  if v_count < 1 or v_count > 30 then raise exception 'Select between 1 and 30 offices.'; end if;
  if v_requires_start and not v_has_start then raise exception 'Choose and validate where you are starting this route.'; end if;
  if v_has_start and (
    jsonb_typeof(v_start) <> 'object' or
    coalesce(v_start->>'kind','') not in ('current_location','hpo_office','custom_address') or
    coalesce(trim(v_start->>'label'),'') = '' or
    coalesce(trim(v_start->>'address'),'') = '' or
    (v_start->>'latitude') is null or (v_start->>'longitude') is null or
    (v_start->>'latitude')::double precision not between -90 and 90 or
    (v_start->>'longitude')::double precision not between -180 and 180
  ) then raise exception 'Validate the starting point before finalizing.'; end if;
  if exists (select 1 from jsonb_array_elements(p_stops) s where
    ((s->>'account_id') is null) = ((s->>'prospect_id') is null) or
    coalesce(s->>'visit_type','') not in ('lunch','office_visit')) then raise exception 'Each stop needs one saved ID and Lunch or Office Visit.'; end if;
  select jsonb_agg(k order by k) into v_keys from (
    select coalesce('account:'||(s->>'account_id'),'prospect:'||(s->>'prospect_id')) k from jsonb_array_elements(p_stops) s
  ) keys;
  if (select count(distinct value) from jsonb_array_elements(v_keys)) <> v_count then raise exception 'An office was selected more than once.'; end if;

  if exists (select 1 from jsonb_array_elements(p_stops) s where
    (s->>'account_id' is not null and not exists (
      select 1 from public.hpo_accounts a where a.id=(s->>'account_id')::uuid and a.user_id=v_user
      and a.status='active' and coalesce(trim(a.address),'')<>''
      and (coalesce(trim(a.owner_name),'')='' or lower(trim(a.owner_name))='adam')
      and not ('exclude_from_adam_route'=any(coalesce(a.tags,'{}'::text[])))
      and coalesce(a.metadata->>'exclude_from_adam_route','false')<>'true'
    )) or (s->>'prospect_id' is not null and not exists (
      select 1 from public.hpo_prospects p where p.id=(s->>'prospect_id')::uuid and p.user_id=v_user
      and p.fit_status not in ('not_fit','closed','duplicate') and coalesce(trim(p.address),'')<>''
      and coalesce(p.metadata->>'exclude_from_adam_route','false')<>'true'
      and (p.promoted_account_id is null or p.metadata->>'map_as_location'='true')
    ))) then raise exception 'A selected office is unavailable or excluded. Return to office selection.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_route_date::text,0));
  perform 1 from public.hpo_route_plans where user_id=v_user and route_date=p_route_date and status in ('planned','active','in_progress') for update;
  if exists(select 1 from public.hpo_route_plans where user_id=v_user and route_date=p_route_date and status in ('active','in_progress')) then
    raise exception 'This day has an active route. Open it in Planner; it cannot be replaced.';
  end if;
  if exists(select 1 from public.hpo_route_plans where user_id=v_user and route_date=p_route_date and status='planned'
    and coalesce(metadata->>'source_channel','') <> 'hpo_planner:'||p_session_id) then
    raise exception 'This day already has a saved route. Open it in Planner; it has not been replaced.';
  end if;
  select * into v_route from public.hpo_route_plans where user_id=v_user and route_date=p_route_date and status='planned'
    and metadata->>'source_channel'='hpo_planner:'||p_session_id limit 1;
  if found then
    v_existing := true;
    if v_route.metadata->'planner_selected_keys' is distinct from v_keys then raise exception 'This session already saved a different selection. Open its saved route in Planner.'; end if;
    if exists(select 1 from public.hpo_route_stops where route_id=v_route.id and user_id=v_user and (status<>'planned' or visited_at is not null or visit_summary is not null)) then
      raise exception 'This route already has field history. Open it in Planner.';
    end if;
    if v_route.optimized_at is not null then
      if v_has_start and v_route.metadata->'starting_point' is distinct from v_start then raise exception 'This route is already finalized with a different starting point.'; end if;
      if exists(select 1 from jsonb_array_elements(p_stops) s join public.hpo_route_stops t
        on t.route_id=v_route.id and t.user_id=v_user and (t.account_id=(s->>'account_id')::uuid or t.prospect_id=(s->>'prospect_id')::uuid)
        where t.metadata->>'visit_type' is distinct from s->>'visit_type') then raise exception 'This route is already finalized. Open it in Planner to make changes.'; end if;
      return jsonb_build_object('route_id',v_route.id,'reused',true);
    end if;
  else
    insert into public.hpo_route_plans(user_id,route_date,area,status,source_type,start_address,start_latitude,start_longitude,metadata)
    values(v_user,p_route_date,p_area,'planned','emery_route_planner',
      case when v_has_start then v_start->>'address' else null end,
      case when v_has_start then (v_start->>'latitude')::double precision else null end,
      case when v_has_start then (v_start->>'longitude')::double precision else null end,
      jsonb_build_object('non_phi',true,'planner','emery_native_v2','source_channel','hpo_planner:'||p_session_id,
        'planner_workflow',v_requires_start,'planner_selected_keys',v_keys,'starting_point',coalesce(v_start,'null'::jsonb),'game_plan',p_game_plan)) returning * into v_route;
  end if;
  for v_stop in select value from jsonb_array_elements(p_stops) loop
    v_index := v_index+1;
    if v_existing then
      update public.hpo_route_stops set metadata=metadata||jsonb_build_object('visit_type',v_stop->>'visit_type','game_plan',v_stop->'game_plan'),updated_at=now()
      where user_id=v_user and route_id=v_route.id and (account_id=(v_stop->>'account_id')::uuid or prospect_id=(v_stop->>'prospect_id')::uuid);
    else
      insert into public.hpo_route_stops(user_id,route_id,account_id,prospect_id,stop_order,status,office_name,address,city,latitude,longitude,metadata)
      values(v_user,v_route.id,(v_stop->>'account_id')::uuid,(v_stop->>'prospect_id')::uuid,v_index,'planned',
        v_stop->>'office_name',v_stop->>'address',v_stop->>'city',(v_stop->>'latitude')::double precision,(v_stop->>'longitude')::double precision,
        jsonb_build_object('non_phi',true,'source_channel','hpo_planner:'||p_session_id,'visit_type',v_stop->>'visit_type','game_plan',v_stop->'game_plan'));
    end if;
  end loop;
  if (select count(*) from public.hpo_route_stops where route_id=v_route.id and user_id=v_user) <> v_count then raise exception 'Saved stop count does not match your selection.'; end if;
  update public.hpo_route_plans set
    start_address=case when v_has_start then v_start->>'address' else start_address end,
    start_latitude=case when v_has_start then (v_start->>'latitude')::double precision else start_latitude end,
    start_longitude=case when v_has_start then (v_start->>'longitude')::double precision else start_longitude end,
    metadata=metadata||jsonb_build_object('planner_workflow',v_requires_start,'starting_point',case when v_has_start then v_start else coalesce(metadata->'starting_point','null'::jsonb) end,'game_plan',p_game_plan),
    updated_at=now()
  where id=v_route.id and user_id=v_user;
  return jsonb_build_object('route_id',v_route.id,'reused',v_existing);
end; $$;
revoke all on function public.emery_hpo_create_planner_selection(date,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.emery_hpo_create_planner_selection(date,text,text,jsonb,jsonb) to authenticated;

create or replace function public.emery_hpo_finalize_planner_order(
  p_route_id uuid, p_session_id text, p_stop_ids uuid[], p_distance_meters integer[], p_drive_seconds integer[], p_patch jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_route public.hpo_route_plans%rowtype;
  v_first jsonb;
begin
  if v_user is null then raise exception 'Authentication required.'; end if;
  select * into v_route from public.hpo_route_plans where id=p_route_id and user_id=v_user for update;
  if not found then raise exception 'Route not found.'; end if;
  if v_route.status<>'planned' or v_route.metadata->>'source_channel' is distinct from 'hpo_planner:'||p_session_id then
    raise exception 'This route is active or belongs to another session. It has not been changed.';
  end if;
  perform 1 from public.hpo_route_stops where route_id=p_route_id and user_id=v_user for update;
  if exists(select 1 from public.hpo_route_stops where route_id=p_route_id and user_id=v_user and (status<>'planned' or visited_at is not null or visit_summary is not null)) then
    raise exception 'This route has field history. It has not been changed.';
  end if;
  if coalesce((v_route.metadata->>'planner_workflow')::boolean,false) and
    (v_route.start_address is null or v_route.start_latitude is null or v_route.start_longitude is null) then
    raise exception 'This Planner route has no validated starting point.';
  end if;
  if cardinality(p_stop_ids)>1 and coalesce(jsonb_array_length(p_patch->'metadata'->'route_geometry'),0)<2 then raise exception 'Road geometry is unavailable. Retry Finalize Route.'; end if;
  if v_route.start_latitude is not null and jsonb_array_length(p_patch->'metadata'->'route_geometry')>=2 then
    v_first := p_patch->'metadata'->'route_geometry'->0;
    if abs((v_first->>0)::double precision-v_route.start_longitude)>0.001 or abs((v_first->>1)::double precision-v_route.start_latitude)>0.001 then
      raise exception 'Road geometry does not begin at the saved starting point.';
    end if;
  end if;
  if v_route.metadata->'planner_selected_keys' is distinct from (
    select jsonb_agg(k order by k) from (
      select coalesce('account:'||account_id::text,'prospect:'||prospect_id::text) k
      from public.hpo_route_stops where route_id=p_route_id and user_id=v_user
    ) current_keys
  ) then raise exception 'Selected offices have changed since planning. Open the saved route in Planner.'; end if;
  perform public.emery_hpo_apply_route_order(p_route_id,p_stop_ids,p_distance_meters,p_drive_seconds);
  update public.hpo_route_plans set optimized_at=(p_patch->>'optimized_at')::timestamptz,
    optimized_distance_meters=(p_patch->>'optimized_distance_meters')::integer,
    optimized_duration_seconds=(p_patch->>'optimized_duration_seconds')::integer,
    metadata=metadata||(p_patch->'metadata'),updated_at=now()
  where id=p_route_id and user_id=v_user;
  return jsonb_build_object('id',p_route_id,'optimized_at',p_patch->>'optimized_at',
    'optimized_distance_meters',p_patch->'optimized_distance_meters','optimized_duration_seconds',p_patch->'optimized_duration_seconds');
end; $$;
revoke all on function public.emery_hpo_finalize_planner_order(uuid,text,uuid[],integer[],integer[],jsonb) from public,anon;
grant execute on function public.emery_hpo_finalize_planner_order(uuid,text,uuid[],integer[],integer[],jsonb) to authenticated;
