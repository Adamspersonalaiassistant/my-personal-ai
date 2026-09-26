create or replace function public.emery_action_authorized(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role' or auth.uid() = p_user_id;
$$;
revoke all on function public.emery_action_authorized(uuid) from public, anon;
grant execute on function public.emery_action_authorized(uuid) to authenticated, service_role;

create or replace function public.emery_action_create_task(
  p_user_id uuid,
  p_title text,
  p_details text default null,
  p_due_at timestamptz default null,
  p_priority smallint default 3,
  p_source text default 'emery'
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare v public.tasks;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'task title required'; end if;
  insert into public.tasks(user_id,title,details,due_at,priority,status,source_type,metadata)
  values (
    p_user_id, trim(p_title), nullif(trim(coalesce(p_details,'')),''),
    p_due_at, greatest(1,least(5,coalesce(p_priority,3))), 'inbox',
    p_source,
    jsonb_build_object('source',p_source,'calendar',p_due_at is not null,'event_type','task')
  )
  returning * into v;
  return v;
end $$;
revoke all on function public.emery_action_create_task(uuid,text,text,timestamptz,smallint,text) from public, anon;
grant execute on function public.emery_action_create_task(uuid,text,text,timestamptz,smallint,text) to authenticated, service_role;

create or replace function public.emery_action_create_event(
  p_user_id uuid,
  p_title text,
  p_start_at timestamptz,
  p_end_at timestamptz default null,
  p_participants jsonb default '[]'::jsonb,
  p_event_type text default 'event',
  p_source text default 'emery'
)
returns public.meetings
language plpgsql
security definer
set search_path = public
as $$
declare v public.meetings; v_end timestamptz; v_type text;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  if nullif(trim(p_title),'') is null or p_start_at is null then raise exception 'event title and start required'; end if;
  v_end := coalesce(p_end_at, p_start_at + interval '1 hour');
  if v_end <= p_start_at then raise exception 'event end must be after start'; end if;
  v_type := case when p_event_type in ('lunch','meeting','appointment','event') then p_event_type else 'event' end;
  insert into public.meetings(user_id,title,meeting_at,end_at,participants,metadata)
  values (
    p_user_id, trim(p_title), p_start_at, v_end, coalesce(p_participants,'[]'::jsonb),
    jsonb_build_object('source_type',p_source,'source',p_source,'event_type',v_type,'calendar',true)
  )
  returning * into v;
  return v;
end $$;
revoke all on function public.emery_action_create_event(uuid,text,timestamptz,timestamptz,jsonb,text,text) from public, anon;
grant execute on function public.emery_action_create_event(uuid,text,timestamptz,timestamptz,jsonb,text,text) to authenticated, service_role;

create or replace function public.emery_action_complete_task(p_user_id uuid,p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare v public.tasks;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  update public.tasks set status='completed',completed_at=now(),updated_at=now()
  where id=p_task_id and user_id=p_user_id returning * into v;
  if v.id is null then raise exception 'task not found'; end if;
  return v;
end $$;
revoke all on function public.emery_action_complete_task(uuid,uuid) from public, anon;
grant execute on function public.emery_action_complete_task(uuid,uuid) to authenticated, service_role;

create or replace function public.emery_action_schedule_task(p_user_id uuid,p_task_id uuid,p_due_at timestamptz)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare v public.tasks;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  if p_due_at is null then raise exception 'task time required'; end if;
  update public.tasks
  set due_at=p_due_at,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('calendar',true,'source','emery'),updated_at=now()
  where id=p_task_id and user_id=p_user_id returning * into v;
  if v.id is null then raise exception 'task not found'; end if;
  return v;
end $$;
revoke all on function public.emery_action_schedule_task(uuid,uuid,timestamptz) from public, anon;
grant execute on function public.emery_action_schedule_task(uuid,uuid,timestamptz) to authenticated, service_role;

create or replace function public.emery_action_reschedule_event(
  p_user_id uuid,
  p_event_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz default null
)
returns public.meetings
language plpgsql
security definer
set search_path = public
as $$
declare v_current public.meetings; v public.meetings; v_duration interval; v_end timestamptz;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  if p_start_at is null then raise exception 'event start required'; end if;
  select * into v_current from public.meetings where id=p_event_id and user_id=p_user_id;
  if v_current.id is null then raise exception 'event not found'; end if;
  v_duration := greatest(interval '15 minutes', coalesce(v_current.end_at, v_current.meeting_at + interval '1 hour') - v_current.meeting_at);
  v_end := coalesce(p_end_at, p_start_at + v_duration);
  if v_end <= p_start_at then raise exception 'event end must be after start'; end if;
  update public.meetings set meeting_at=p_start_at,end_at=v_end,updated_at=now()
  where id=p_event_id and user_id=p_user_id returning * into v;
  return v;
end $$;
revoke all on function public.emery_action_reschedule_event(uuid,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.emery_action_reschedule_event(uuid,uuid,timestamptz,timestamptz) to authenticated, service_role;
