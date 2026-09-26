
create or replace function public.run_emery_proactive_checks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  local_now timestamp;
  local_date text;
  local_hour integer;
  local_dow integer;
  claim_id uuid;
  top_task text;
  next_meeting text;
  hpo_due integer;
  open_tasks integer;
  runtime_total integer;
  runtime_errors integer;
  runtime_clarifications integer;
  hpo_touches integer;
  completed_tasks integer;
  body_text text;
  generated integer := 0;
begin
  for p in
    select user_id, coalesce(nullif(timezone,''),'America/New_York') as timezone
    from public.profiles
  loop
    begin
      local_now := now() at time zone p.timezone;
    exception when others then
      local_now := now() at time zone 'America/New_York';
    end;
    local_date := to_char(local_now,'YYYY-MM-DD');
    local_hour := extract(hour from local_now)::integer;
    local_dow := extract(dow from local_now)::integer;

    -- Morning: one useful orientation, only if there is something actionable.
    if local_hour = 8 then
      claim_id := null;
      insert into public.emery_routine_runs(user_id,routine_key,run_key,status,metadata)
      values(p.user_id,'morning_focus',local_date,'completed',jsonb_build_object('timezone',p.timezone))
      on conflict(user_id,routine_key,run_key) do nothing
      returning id into claim_id;

      if claim_id is not null then
        select t.title into top_task
        from public.tasks t
        where t.user_id=p.user_id and t.status <> 'completed'
        order by
          case when t.due_at is not null and t.due_at < now() then 0 else 1 end,
          t.priority desc,
          t.due_at asc nulls last,
          t.created_at asc
        limit 1;

        select m.title into next_meeting
        from public.meetings m
        where m.user_id=p.user_id and m.meeting_at between now() and now()+interval '24 hours'
        order by m.meeting_at asc
        limit 1;

        select count(*)::integer into hpo_due
        from public.hpo_accounts a
        where a.user_id=p.user_id
          and a.status='active'
          and (
            (a.next_action_due_at is not null and a.next_action_due_at <= now()+interval '24 hours')
            or (a.next_interaction_at is not null and a.next_interaction_at <= now()+interval '24 hours')
          );

        if top_task is not null or next_meeting is not null or hpo_due > 0 then
          body_text := concat_ws(' · ',
            case when top_task is not null then 'Top move: '||top_task end,
            case when next_meeting is not null then 'Next event: '||next_meeting end,
            case when hpo_due > 0 then hpo_due||' HPO relationship follow-up'||case when hpo_due=1 then '' else 's' end||' due' end
          );
          insert into public.app_notifications(
            user_id,title,body,scheduled_for,status,source_type,source_ref,metadata
          ) values(
            p.user_id,'Emery morning focus',body_text,now(),'pending','emery_proactive',
            'morning:'||local_date,
            jsonb_build_object('routine','morning_focus','timezone',p.timezone)
          );
          generated := generated + 1;
        end if;
      end if;
    end if;

    -- Ask for a quick recap after a recently ended meeting/lunch, once per event.
    for next_meeting in
      select m.id::text
      from public.meetings m
      where m.user_id=p.user_id
        and coalesce(m.end_at,m.meeting_at+interval '1 hour') between now()-interval '75 minutes' and now()
    loop
      claim_id := null;
      insert into public.emery_routine_runs(user_id,routine_key,run_key,status)
      values(p.user_id,'meeting_recap',next_meeting,'completed')
      on conflict(user_id,routine_key,run_key) do nothing
      returning id into claim_id;

      if claim_id is not null then
        insert into public.app_notifications(
          user_id,title,body,scheduled_for,status,source_type,source_ref,metadata
        )
        select
          p.user_id,
          'Quick recap for Emery',
          'You just finished “'||coalesce(m.title,'an event')||'”. Give me a quick voice recap and I’ll keep the useful decisions, follow-ups, and relationship context organized.',
          now(),'pending','emery_proactive','meeting_recap:'||m.id::text,
          jsonb_build_object('routine','meeting_recap','meeting_id',m.id)
        from public.meetings m
        where m.id=next_meeting::uuid and m.user_id=p.user_id;
        generated := generated + 1;
      end if;
    end loop;

    -- Evening: close the loop only when unfinished work exists.
    if local_hour = 19 then
      select count(*)::integer into open_tasks
      from public.tasks t
      where t.user_id=p.user_id and t.status <> 'completed';

      if open_tasks > 0 then
        claim_id := null;
        insert into public.emery_routine_runs(user_id,routine_key,run_key,status)
        values(p.user_id,'evening_closeout',local_date,'completed')
        on conflict(user_id,routine_key,run_key) do nothing
        returning id into claim_id;

        if claim_id is not null then
          insert into public.app_notifications(
            user_id,title,body,scheduled_for,status,source_type,source_ref,metadata
          ) values(
            p.user_id,'Close the day with Emery',
            open_tasks||' open task'||case when open_tasks=1 then '' else 's' end||
            ' remain. Tell me what actually got done and what should move so tomorrow starts clean.',
            now(),'pending','emery_proactive','evening:'||local_date,
            jsonb_build_object('routine','evening_closeout','open_tasks',open_tasks)
          );
          generated := generated + 1;
        end if;
      end if;
    end if;

    -- Nightly: evaluate observed runtime reliability without rewriting source code.
    if local_hour = 23 then
      claim_id := null;
      insert into public.emery_routine_runs(user_id,routine_key,run_key,status)
      values(p.user_id,'nightly_self_review',local_date,'completed')
      on conflict(user_id,routine_key,run_key) do nothing
      returning id into claim_id;

      if claim_id is not null then
        select
          count(*)::integer,
          count(*) filter(where e.status='error')::integer,
          count(*) filter(where e.status='clarification')::integer
        into runtime_total,runtime_errors,runtime_clarifications
        from public.emery_runtime_events e
        where e.user_id=p.user_id and e.created_at >= now()-interval '24 hours';

        insert into public.emery_self_evaluations(
          user_id,target_type,target_ref,rubric_version,scores,findings,metadata
        ) values(
          p.user_id,'system','runtime:'||local_date,'phase0-v1',
          jsonb_build_object(
            'events',runtime_total,
            'errors',runtime_errors,
            'clarifications',runtime_clarifications,
            'success_rate',case when runtime_total=0 then null else round(((runtime_total-runtime_errors)::numeric/runtime_total),3) end
          ),
          jsonb_build_array(
            case
              when runtime_total=0 then 'No measured Emery runtime events in the last 24 hours.'
              when runtime_errors=0 then 'No measured runtime errors in the last 24 hours.'
              else runtime_errors||' runtime error'||case when runtime_errors=1 then '' else 's' end||' observed in the last 24 hours.'
            end
          ),
          jsonb_build_object('source','server_self_review','safe_autonomy',true)
        );

        if runtime_errors >= 3 then
          update public.emery_improvement_backlog
          set occurrence_count=occurrence_count+1,
              severity=greatest(severity,4),
              confidence=greatest(confidence,0.95),
              evidence=coalesce(evidence,'[]'::jsonb)||jsonb_build_array(
                jsonb_build_object('at',now(),'runtime_errors',runtime_errors,'runtime_events',runtime_total)
              ),
              last_observed_at=now(),
              updated_at=now()
          where user_id=p.user_id
            and area='system'
            and title='Recurring runtime failures detected'
            and status in ('observed','proposed','testing');

          if not found then
            insert into public.emery_improvement_backlog(
              user_id,area,title,problem_statement,evidence,severity,expected_benefit,confidence,status
            ) values(
              p.user_id,'system','Recurring runtime failures detected',
              'Emery recorded at least three runtime errors in a 24-hour window. Investigate the failing channel/tool before increasing autonomy.',
              jsonb_build_array(jsonb_build_object('at',now(),'runtime_errors',runtime_errors,'runtime_events',runtime_total)),
              4,'Improve action reliability before adding more autonomy.',0.95,'observed'
            );
          end if;
        end if;
      end if;
    end if;

    -- Weekly evidence-based pattern check; deliberately short and non-prescriptive.
    if local_dow = 0 and local_hour = 18 then
      claim_id := null;
      insert into public.emery_routine_runs(user_id,routine_key,run_key,status)
      values(p.user_id,'weekly_review',to_char(local_now,'IYYY-IW'),'completed')
      on conflict(user_id,routine_key,run_key) do nothing
      returning id into claim_id;

      if claim_id is not null then
        select count(*)::integer into hpo_touches
        from public.hpo_interactions i
        where i.user_id=p.user_id and i.occurred_at >= now()-interval '7 days';

        select count(*)::integer into completed_tasks
        from public.tasks t
        where t.user_id=p.user_id and t.completed_at >= now()-interval '7 days';

        select count(*)::integer into hpo_due
        from public.hpo_accounts a
        where a.user_id=p.user_id and a.status='active'
          and a.next_action_due_at is not null and a.next_action_due_at <= now()+interval '7 days';

        if hpo_touches > 0 or completed_tasks > 0 or hpo_due > 0 then
          insert into public.app_notifications(
            user_id,title,body,scheduled_for,status,source_type,source_ref,metadata
          ) values(
            p.user_id,'Emery weekly pattern check',
            completed_tasks||' tasks completed · '||hpo_touches||' HPO touches logged · '||
            hpo_due||' HPO follow-ups due in the next week. Open Emery if you want the pattern and next move.',
            now(),'pending','emery_proactive','weekly:'||to_char(local_now,'IYYY-IW'),
            jsonb_build_object('routine','weekly_review','completed_tasks',completed_tasks,'hpo_touches',hpo_touches,'hpo_due',hpo_due)
          );
          generated := generated + 1;
        end if;
      end if;
    end if;

    insert into public.emery_runtime_events(user_id,channel,event_type,status,metadata)
    values(
      p.user_id,'system','proactive_check','ok',
      jsonb_build_object('generated_notifications',generated,'local_date',local_date,'local_hour',local_hour)
    );
  end loop;

  return jsonb_build_object('ok',true,'generated_notifications',generated,'checked_at',now());
end;
$$;

revoke execute on function public.run_emery_proactive_checks() from public, anon, authenticated;
grant execute on function public.run_emery_proactive_checks() to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='emery-proactive-checks' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'emery-proactive-checks',
    '*/30 * * * *',
    'select public.run_emery_proactive_checks();'
  );
end;
$$;
