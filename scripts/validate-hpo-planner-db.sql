-- Run as the database test administrator. Every fixture is rolled back.
begin;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',user_id,'role','authenticated')::text from public.hpo_accounts group by user_id order by count(*) desc limit 1),true);
set local role authenticated;
do $$
declare
  a public.hpo_accounts%rowtype;
  b public.hpo_accounts%rowtype;
  stops jsonb;
  result jsonb;
  v_test_route_id uuid;
  stop_ids uuid[];
  patch jsonb;
  game_plan jsonb := '{"planner_workflow":true,"starting_point":{"kind":"custom_address","label":"Test Start","address":"100 Test Start, Newark, NJ","latitude":40.7,"longitude":-74.1}}';
  rejected boolean;
  original_count integer;
begin
  select * into a from public.hpo_accounts where user_id=auth.uid() and status='active'
    and coalesce(trim(address),'')<>'' and (coalesce(trim(owner_name),'')='' or lower(trim(owner_name))='adam')
    and not ('exclude_from_adam_route'=any(coalesce(tags,'{}'::text[]))) and coalesce(metadata->>'exclude_from_adam_route','false')<>'true' order by id limit 1;
  select * into b from public.hpo_accounts where user_id=auth.uid() and status='active' and id<>a.id
    and coalesce(trim(address),'')<>'' and (coalesce(trim(owner_name),'')='' or lower(trim(owner_name))='adam')
    and not ('exclude_from_adam_route'=any(coalesce(tags,'{}'::text[]))) and coalesce(metadata->>'exclude_from_adam_route','false')<>'true' order by id limit 1;
  assert a.id is not null and b.id is not null, 'Two test offices required';
  stops:=jsonb_build_array(
    jsonb_build_object('account_id',a.id,'office_name',a.name,'address',a.address,'city',a.city,'latitude',a.latitude,'longitude',a.longitude,'visit_type','office_visit','game_plan',jsonb_build_object('purpose','Test purpose')),
    jsonb_build_object('account_id',b.id,'office_name',b.name,'address',b.address,'city',b.city,'latitude',b.latitude,'longitude',b.longitude,'visit_type','lunch','game_plan',jsonb_build_object('purpose','Test lunch purpose')));
  select count(*) into original_count from public.hpo_route_plans where user_id=auth.uid();
  rejected:=false;
  begin perform public.emery_hpo_create_planner_selection('2099-11-17','planner-regression',null,jsonb_build_array(stops->0,stops->0),game_plan); exception when others then rejected:=true; end;
  assert rejected,'Duplicate stop must fail';
  rejected:=false;
  begin perform public.emery_hpo_create_planner_selection('2099-11-17','planner-regression',null,jsonb_build_array(jsonb_set(stops->0,'{account_id}',to_jsonb(gen_random_uuid()))),game_plan); exception when others then rejected:=true; end;
  assert rejected,'Missing office must fail';
  rejected:=false;
  begin perform public.emery_hpo_create_planner_selection('2099-11-17','planner-regression',null,stops,'{"planner_workflow":true}'); exception when others then rejected:=true; end;
  assert rejected,'Planner workflow must require a validated starting point';
  assert (select count(*) from public.hpo_route_plans where user_id=auth.uid())=original_count,'Validation must not write a route';
  result:=public.emery_hpo_create_planner_selection('2099-11-17','planner-regression','Regression',stops,game_plan||'{"discussion":[{"role":"user","text":"Test discussion"}]}');
  v_test_route_id:=(result->>'route_id')::uuid;
  assert (select route_date from public.hpo_route_plans where id=v_test_route_id)='2099-11-17','Exact date saved';
  assert (select start_address from public.hpo_route_plans where id=v_test_route_id)='100 Test Start, Newark, NJ','Starting address saved';
  assert (select start_latitude from public.hpo_route_plans where id=v_test_route_id)=40.7,'Starting latitude saved';
  assert (select metadata->'starting_point'->>'label' from public.hpo_route_plans where id=v_test_route_id)='Test Start','Starting point metadata saved';
  assert (select count(*) from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id)=2,'Exact selected count';
  assert (select metadata->>'visit_type' from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id and account_id=b.id)='lunch','Lunch persisted';
  assert (select metadata->'game_plan'->>'purpose' from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id and account_id=a.id)='Test purpose','Game plan persisted';
  result:=public.emery_hpo_create_planner_selection('2099-11-17','planner-regression','Regression',stops,game_plan);
  assert (result->>'route_id')::uuid=v_test_route_id,'Retry must reuse route';
  assert (select count(*) from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id)=2,'Retry must not duplicate offices';
  rejected:=false;
  begin perform public.emery_hpo_create_planner_selection('2099-11-17','other-session',null,stops,game_plan); exception when others then rejected:=true; end;
  assert rejected,'Existing route must not be replaced';
  select array_agg(id order by stop_order desc) into stop_ids from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id;
  patch:=jsonb_build_object('optimized_at',now(),'optimized_distance_meters',3218,'optimized_duration_seconds',600,'metadata',jsonb_build_object('route_geometry',jsonb_build_array(jsonb_build_array(-74.1,40.7),jsonb_build_array(-74.2,40.8)),'optimization_engine','open_road_matrix'));
  rejected:=false;
  begin perform public.emery_hpo_finalize_planner_order(v_test_route_id,'planner-regression',stop_ids[1:1],array[0],array[0],patch); exception when others then rejected:=true; end;
  assert rejected,'Missing selected stop must fail atomically';
  assert (select account_id from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id and stop_order=1)=a.id,'Failed finalization preserves order';
  rejected:=false;
  begin perform public.emery_hpo_finalize_planner_order(v_test_route_id,'planner-regression',stop_ids,array[0,3218],array[0,600],jsonb_set(patch,'{metadata,route_geometry}','[]')); exception when others then rejected:=true; end;
  assert rejected,'Missing road geometry must fail';
  rejected:=false;
  begin perform public.emery_hpo_finalize_planner_order(v_test_route_id,'planner-regression',stop_ids,array[0,3218],array[0,600],jsonb_set(patch,'{metadata,route_geometry,0}',jsonb_build_array(-73.5,40.9))); exception when others then rejected:=true; end;
  assert rejected,'Road geometry must begin at the saved starting point';
  update public.hpo_route_plans set status='active' where id=v_test_route_id;
  rejected:=false;
  begin perform public.emery_hpo_create_planner_selection('2099-11-17','planner-regression',null,stops,game_plan); exception when others then rejected:=true; end;
  assert rejected,'Active route cannot be replaced';
  rejected:=false;
  begin perform public.emery_hpo_finalize_planner_order(v_test_route_id,'planner-regression',stop_ids,array[0,3218],array[0,600],patch); exception when others then rejected:=true; end;
  assert rejected,'Active route cannot be finalized by stale session';
  update public.hpo_route_plans set status='planned' where id=v_test_route_id;
  perform public.emery_hpo_finalize_planner_order(v_test_route_id,'planner-regression',stop_ids,array[0,3218],array[0,600],patch);
  assert (select account_id from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id and stop_order=1)=b.id,'Optimized reverse order persisted';
  assert (select metadata->>'visit_type' from public.hpo_route_stops where hpo_route_stops.route_id=v_test_route_id and account_id=b.id)='lunch','Order preserves classifications';
  assert (select jsonb_array_length(metadata->'route_geometry') from public.hpo_route_plans where id=v_test_route_id)=2,'Road geometry persisted';
  assert (select optimized_duration_seconds from public.hpo_route_plans where id=v_test_route_id)=600,'Drive time persisted';
  assert (select count(*) from public.hpo_route_plans where user_id=auth.uid())=original_count+1,'Exactly one route created';
end; $$;
select 'Planner DB assertions passed; transaction rolled back' as result;

rollback;
