-- Canonical Emery execution kernel: first vertical slice (task.create).
-- Keeps Task List semantics intact and makes task creation atomic, idempotent, verified,
-- and traceable through emery_execution_runs.

create or replace function public.emery_kernel_task_create(
  p_user_id uuid,
  p_idempotency_key text,
  p_title text,
  p_details text default null,
  p_due_at timestamptz default null,
  p_scheduled_start_at timestamptz default null,
  p_scheduled_end_at timestamptz default null,
  p_reminder_at timestamptz default null,
  p_priority smallint default 3,
  p_project_id uuid default null,
  p_source_channel text default 'unknown',
  p_source_message_id uuid default null,
  p_parent_run_id uuid default null,
  p_execution_run_id uuid default null,
  p_source text default 'emery'
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_run public.emery_execution_runs;
  v_task public.tasks;
  v_end timestamptz;
  v_minutes integer;
  v_receipt jsonb;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_channel text := nullif(trim(coalesce(p_source_channel,'')),'');
begin
  if not public.emery_action_authorized(p_user_id) then
    raise exception 'unauthorized';
  end if;

  if v_key is null and p_execution_run_id is null then
    raise exception 'idempotency key required';
  end if;

  if p_execution_run_id is not null then
    select * into v_run
    from public.emery_execution_runs
    where id=p_execution_run_id and user_id=p_user_id;

    if v_run.id is null then
      raise exception 'execution run not found';
    end if;

    if v_run.status='completed' and coalesce(v_run.result_payload,'{}'::jsonb) <> '{}'::jsonb then
      return v_run.result_payload || jsonb_build_object('reused',true);
    end if;

    update public.emery_execution_runs
    set status='running',
        retry_count=case when status='failed' then retry_count+1 else retry_count end,
        error_code=null,
        error_message=null,
        retryable=false,
        started_at=coalesce(started_at,now()),
        completed_at=null,
        request_payload=coalesce(request_payload,'{}'::jsonb) || jsonb_build_object(
          'capability','task.create',
          'source_channel',coalesce(v_channel,'unknown'),
          'title',p_title,
          'details',p_details,
          'due_at',p_due_at,
          'scheduled_start_at',p_scheduled_start_at,
          'scheduled_end_at',p_scheduled_end_at,
          'reminder_at',p_reminder_at,
          'priority',p_priority,
          'project_id',p_project_id
        )
    where id=v_run.id
    returning * into v_run;
  else
    insert into public.emery_execution_runs(
      user_id,source_message_id,parent_run_id,domain,action,status,idempotency_key,
      target_type,request_payload,started_at
    )
    values(
      p_user_id,p_source_message_id,p_parent_run_id,'tasks','task.create','running',v_key,
      'task',jsonb_build_object(
        'capability','task.create',
        'source_channel',coalesce(v_channel,'unknown'),
        'title',p_title,
        'details',p_details,
        'due_at',p_due_at,
        'scheduled_start_at',p_scheduled_start_at,
        'scheduled_end_at',p_scheduled_end_at,
        'reminder_at',p_reminder_at,
        'priority',p_priority,
        'project_id',p_project_id
      ),now()
    )
    on conflict (user_id,idempotency_key) where idempotency_key is not null
    do nothing
    returning * into v_run;

    if v_run.id is null then
      select * into v_run
      from public.emery_execution_runs
      where user_id=p_user_id and idempotency_key=v_key;

      if v_run.id is null then
        raise exception 'could not resolve execution run';
      end if;

      if v_run.status='completed' and coalesce(v_run.result_payload,'{}'::jsonb) <> '{}'::jsonb then
        return v_run.result_payload || jsonb_build_object('reused',true);
      end if;

      if v_run.status='needs_clarification' then
        return jsonb_build_object(
          'ok',false,'status','needs_clarification','reused',true,
          'executionRunId',v_run.id,'errorCode',v_run.error_code,
          'errorMessage',v_run.error_message
        );
      end if;

      update public.emery_execution_runs
      set status='running',
          retry_count=case when status='failed' then retry_count+1 else retry_count end,
          error_code=null,error_message=null,retryable=false,
          started_at=coalesce(started_at,now()),completed_at=null
      where id=v_run.id
      returning * into v_run;
    end if;
  end if;

  begin
    if nullif(trim(coalesce(p_title,'')),'') is null then
      raise exception 'task title required';
    end if;

    if p_scheduled_end_at is not null and p_scheduled_start_at is null then
      raise exception 'scheduled task start required';
    end if;

    if p_scheduled_start_at is not null then
      v_end := coalesce(p_scheduled_end_at,p_scheduled_start_at + interval '30 minutes');
      if v_end <= p_scheduled_start_at then
        raise exception 'task schedule end must be after start';
      end if;
      v_minutes := greatest(
        5,
        least(720,round(extract(epoch from (v_end-p_scheduled_start_at))/60)::integer)
      );
    else
      v_end := null;
      v_minutes := null;
    end if;

    if p_project_id is not null and not exists (
      select 1 from public.projects where id=p_project_id and user_id=p_user_id
    ) then
      raise exception 'project not found';
    end if;

    insert into public.tasks(
      user_id,title,details,project_id,status,priority,due_at,
      scheduled_start_at,scheduled_end_at,reminder_at,estimated_minutes,
      source_type,source_ref,metadata
    )
    values(
      p_user_id,
      trim(p_title),
      nullif(trim(coalesce(p_details,'')),''),
      p_project_id,
      'inbox',
      greatest(1,least(5,coalesce(p_priority,3))),
      p_due_at,
      p_scheduled_start_at,
      v_end,
      p_reminder_at,
      v_minutes,
      p_source,
      v_run.id::text,
      jsonb_build_object(
        'source',p_source,
        'source_channel',coalesce(v_channel,'unknown'),
        'calendar',p_scheduled_start_at is not null,
        'event_type','task',
        'execution_run_id',v_run.id::text
      )
    )
    returning * into v_task;

    select * into v_task
    from public.tasks
    where id=v_task.id and user_id=p_user_id;

    if v_task.id is null then
      raise exception 'task verification failed';
    end if;

    v_receipt := jsonb_build_object(
      'ok',true,
      'status','completed',
      'action','task.create',
      'reused',false,
      'executionRunId',v_run.id,
      'idempotencyKey',coalesce(v_run.idempotency_key,v_key),
      'targetType','task',
      'targetId',v_task.id,
      'task',jsonb_build_object(
        'id',v_task.id,
        'title',v_task.title,
        'details',v_task.details,
        'status',v_task.status,
        'priority',v_task.priority,
        'due_at',v_task.due_at,
        'scheduled_start_at',v_task.scheduled_start_at,
        'scheduled_end_at',v_task.scheduled_end_at,
        'reminder_at',v_task.reminder_at,
        'estimated_minutes',v_task.estimated_minutes,
        'project_id',v_task.project_id,
        'created_at',v_task.created_at
      )
    );

    update public.emery_execution_runs
    set status='completed',
        target_type='task',
        target_id=v_task.id::text,
        result_payload=v_receipt,
        error_code=null,
        error_message=null,
        retryable=false,
        completed_at=now()
    where id=v_run.id;

    return v_receipt;
  exception when others then
    update public.emery_execution_runs
    set status='failed',
        error_code='task_create_failed',
        error_message=sqlerrm,
        retryable=true,
        completed_at=now(),
        result_payload=jsonb_build_object(
          'ok',false,
          'status','failed',
          'action','task.create',
          'executionRunId',v_run.id,
          'errorCode','task_create_failed',
          'errorMessage',sqlerrm
        )
    where id=v_run.id;

    return jsonb_build_object(
      'ok',false,
      'status','failed',
      'action','task.create',
      'reused',false,
      'executionRunId',v_run.id,
      'errorCode','task_create_failed',
      'errorMessage',sqlerrm
    );
  end;
end
$function$;

comment on function public.emery_kernel_task_create(
  uuid,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,smallint,uuid,text,uuid,uuid,uuid,text
) is 'Canonical verified, idempotent task.create execution path for Emery channels.';
