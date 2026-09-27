-- Separate task deadlines, optional Calendar time blocks, and push reminders.

alter table public.tasks
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists reminder_at timestamptz,
  add column if not exists estimated_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_scheduled_window_valid'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_scheduled_window_valid
      check (
        scheduled_end_at is null
        or (scheduled_start_at is not null and scheduled_end_at > scheduled_start_at)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_estimated_minutes_valid'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_estimated_minutes_valid
      check (estimated_minutes is null or estimated_minutes between 5 and 720);
  end if;
end $$;

create index if not exists tasks_user_scheduled_start_idx
  on public.tasks(user_id, scheduled_start_at)
  where scheduled_start_at is not null and status <> 'completed';

create index if not exists tasks_user_due_open_idx
  on public.tasks(user_id, due_at)
  where due_at is not null and status <> 'completed';

create or replace function public.emery_action_create_task_v2(
  p_user_id uuid,
  p_title text,
  p_details text default null,
  p_due_at timestamptz default null,
  p_scheduled_start_at timestamptz default null,
  p_scheduled_end_at timestamptz default null,
  p_reminder_at timestamptz default null,
  p_priority smallint default 3,
  p_source text default 'emery'
)
returns public.tasks
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v public.tasks;
  v_end timestamptz;
  v_minutes integer;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'task title required'; end if;

  if p_scheduled_start_at is not null then
    v_end := coalesce(p_scheduled_end_at, p_scheduled_start_at + interval '30 minutes');
    if v_end <= p_scheduled_start_at then raise exception 'task schedule end must be after start'; end if;
    v_minutes := greatest(5, least(720, round(extract(epoch from (v_end - p_scheduled_start_at)) / 60)::integer));
  else
    v_end := null;
    v_minutes := null;
  end if;

  insert into public.tasks(
    user_id,title,details,due_at,scheduled_start_at,scheduled_end_at,
    reminder_at,estimated_minutes,priority,status,source_type,metadata
  )
  values (
    p_user_id, trim(p_title), nullif(trim(coalesce(p_details,'')),''),
    p_due_at, p_scheduled_start_at, v_end, p_reminder_at, v_minutes,
    greatest(1,least(5,coalesce(p_priority,3))), 'inbox', p_source,
    jsonb_build_object('source',p_source,'calendar',p_scheduled_start_at is not null,'event_type','task')
  )
  returning * into v;
  return v;
end
$function$;

create or replace function public.emery_action_schedule_task_v2(
  p_user_id uuid,
  p_task_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz default null,
  p_reminder_at timestamptz default null
)
returns public.tasks
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v public.tasks;
  v_end timestamptz;
  v_minutes integer;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  if p_start_at is null then raise exception 'task schedule start required'; end if;
  v_end := coalesce(p_end_at, p_start_at + interval '30 minutes');
  if v_end <= p_start_at then raise exception 'task schedule end must be after start'; end if;
  v_minutes := greatest(5, least(720, round(extract(epoch from (v_end - p_start_at)) / 60)::integer));

  update public.tasks
  set scheduled_start_at=p_start_at,
      scheduled_end_at=v_end,
      reminder_at=p_reminder_at,
      estimated_minutes=v_minutes,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('calendar',true,'source','emery'),
      updated_at=now()
  where id=p_task_id and user_id=p_user_id
  returning * into v;
  if v.id is null then raise exception 'task not found'; end if;
  return v;
end
$function$;

create or replace function public.emery_action_unschedule_task(p_user_id uuid,p_task_id uuid)
returns public.tasks
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare v public.tasks;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  update public.tasks
  set scheduled_start_at=null,scheduled_end_at=null,reminder_at=null,
      metadata=(coalesce(metadata,'{}'::jsonb)-'calendar')||jsonb_build_object('calendar',false),
      updated_at=now()
  where id=p_task_id and user_id=p_user_id
  returning * into v;
  if v.id is null then raise exception 'task not found'; end if;
  return v;
end
$function$;

create or replace function public.emery_action_set_task_deadline(
  p_user_id uuid,p_task_id uuid,p_due_at timestamptz
)
returns public.tasks
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare v public.tasks;
begin
  if not public.emery_action_authorized(p_user_id) then raise exception 'unauthorized'; end if;
  update public.tasks set due_at=p_due_at,updated_at=now()
  where id=p_task_id and user_id=p_user_id returning * into v;
  if v.id is null then raise exception 'task not found'; end if;
  return v;
end
$function$;

create or replace function public.sync_task_reminder_workflow()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare remind_at timestamptz;
begin
  if tg_op='DELETE' then
    update public.app_notifications
    set status='cancelled',updated_at=now()
    where user_id=old.user_id and source_type='task_reminder'
      and source_ref=old.id::text and status='pending';
    return old;
  end if;

  if new.status='completed' or new.reminder_at is null then
    update public.app_notifications
    set status='cancelled',updated_at=now()
    where user_id=new.user_id and source_type='task_reminder'
      and source_ref=new.id::text and status='pending';
    return new;
  end if;

  remind_at:=greatest(now(),new.reminder_at);
  insert into public.app_notifications(
    user_id,title,body,scheduled_for,status,source_type,source_ref,metadata
  ) values (
    new.user_id,new.title,'Task reminder from Emery.',remind_at,'pending',
    'task_reminder',new.id::text,
    jsonb_build_object(
      'task_id',new.id::text,
      'scheduled_start_at',new.scheduled_start_at,
      'scheduled_end_at',new.scheduled_end_at,
      'workflow','task_reminder'
    )
  )
  on conflict (user_id,source_type,source_ref) where source_ref is not null
  do update set
    title=excluded.title,body=excluded.body,scheduled_for=excluded.scheduled_for,
    status='pending',delivered_at=null,read_at=null,metadata=excluded.metadata,updated_at=now();
  return new;
end
$function$;

drop trigger if exists tasks_reminder_workflow on public.tasks;
create trigger tasks_reminder_workflow
after insert or update of reminder_at,scheduled_start_at,scheduled_end_at,status,title or delete
on public.tasks
for each row execute function public.sync_task_reminder_workflow();

comment on column public.tasks.due_at is
  'Optional task deadline. A deadline is not the same thing as a Calendar time block.';
comment on column public.tasks.scheduled_start_at is
  'Optional Calendar time-block start. Unscheduled tasks remain available in the Task List.';
comment on column public.tasks.scheduled_end_at is
  'Optional Calendar time-block end.';
comment on column public.tasks.reminder_at is
  'Optional Emery push reminder time for the task.';
comment on column public.tasks.estimated_minutes is
  'Estimated task duration, usually derived from the scheduled time block.';
