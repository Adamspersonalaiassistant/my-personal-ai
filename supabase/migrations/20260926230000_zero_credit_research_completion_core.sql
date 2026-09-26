
create table if not exists public.emery_owner_registry (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.emery_owner_registry enable row level security;
revoke all on table public.emery_owner_registry from public, anon, authenticated;
grant select on table public.emery_owner_registry to service_role;

insert into public.emery_owner_registry(user_id)
select user_id from public.profiles order by created_at asc limit 1
on conflict(user_id) do nothing;

create or replace function public.is_emery_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.emery_owner_registry r where r.user_id = auth.uid()
  );
$$;
revoke all on function public.is_emery_owner() from public, anon;
grant execute on function public.is_emery_owner() to authenticated, service_role;

create table if not exists public.emery_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  event_type text not null,
  channel text not null default 'server',
  severity text not null default 'info' check (severity in ('info','warn','critical')),
  request_fingerprint text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.emery_security_events enable row level security;
drop policy if exists emery_security_events_owner_read on public.emery_security_events;
create policy emery_security_events_owner_read on public.emery_security_events
  for select to authenticated using (public.is_emery_owner());
revoke insert, update, delete on public.emery_security_events from anon, authenticated;
grant select on public.emery_security_events to authenticated;
grant all on public.emery_security_events to service_role;
create index if not exists emery_security_events_created_idx on public.emery_security_events(created_at desc);

create or replace function public.emery_runtime_event_to_agent_metric()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare slug text;
begin
  slug := case
    when new.domain = 'hpo' then 'hpo'
    when new.channel = 'voice' then 'voice'
    when coalesce(new.action,'') like '%event%' or coalesce(new.action,'') like '%task%' or coalesce(new.action,'') like '%calendar%' then 'calendar'
    when new.channel = 'shortcut' then 'shortcut'
    when new.channel = 'system' then 'system'
    else 'emery'
  end;
  insert into public.emery_agent_metrics(user_id,agent_slug,delegated_count,web_used,succeeded,duration_ms,metadata)
  values(
    new.user_id,slug,
    coalesce((new.metadata->>'delegatedCount')::int,0),
    coalesce((new.metadata->>'webUsed')::boolean,false),
    case when new.status='ok' then true when new.status='error' then false else null end,
    new.duration_ms,
    jsonb_build_object('source_runtime_event_id',new.id,'channel',new.channel,'event_type',new.event_type,'action',new.action)
  );
  return new;
end;
$$;
revoke all on function public.emery_runtime_event_to_agent_metric() from public, anon, authenticated;

drop trigger if exists trg_emery_runtime_event_agent_metric on public.emery_runtime_events;
create trigger trg_emery_runtime_event_agent_metric
after insert on public.emery_runtime_events
for each row execute function public.emery_runtime_event_to_agent_metric();

insert into public.emery_agent_metrics(user_id,agent_slug,delegated_count,web_used,succeeded,duration_ms,metadata,created_at)
select
  e.user_id,
  case
    when e.domain='hpo' then 'hpo'
    when e.channel='voice' then 'voice'
    when coalesce(e.action,'') like '%event%' or coalesce(e.action,'') like '%task%' or coalesce(e.action,'') like '%calendar%' then 'calendar'
    when e.channel='shortcut' then 'shortcut'
    when e.channel='system' then 'system'
    else 'emery'
  end,
  coalesce((e.metadata->>'delegatedCount')::int,0),
  coalesce((e.metadata->>'webUsed')::boolean,false),
  case when e.status='ok' then true when e.status='error' then false else null end,
  e.duration_ms,
  jsonb_build_object('source_runtime_event_id',e.id,'backfill',true),
  e.created_at
from public.emery_runtime_events e
where not exists (
  select 1 from public.emery_agent_metrics m
  where m.metadata->>'source_runtime_event_id'=e.id::text
);

create or replace function public.run_emery_safe_autotune()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
  event_count integer;
  error_count integer;
  correction_count integer;
  avg_selected numeric;
  change_id uuid;
  applied integer := 0;
begin
  for cfg in select * from public.emery_config where auto_apply_low_risk=true loop
    select
      count(*)::int,
      count(*) filter(where status='error')::int,
      count(*) filter(where coalesce((metadata->>'userCorrectionSignal')::boolean,false))::int,
      avg(nullif(metadata->>'selectedMemoryCount','')::numeric)
    into event_count,error_count,correction_count,avg_selected
    from public.emery_runtime_events
    where user_id=cfg.user_id
      and created_at >= now()-interval '14 days'
      and channel in ('chat','capture','shortcut','voice');

    if event_count >= 20
       and error_count = 0
       and correction_count <= 1
       and cfg.memory_max_items > 14
       and avg_selected is not null
       and avg_selected <= 8 then
      update public.emery_config
      set memory_max_items=14,updated_at=now()
      where user_id=cfg.user_id;

      insert into public.emery_improvement_changes(
        user_id,change_type,scope,before_state,after_state,rationale,validation,rollback_state,status,applied_at
      ) values (
        cfg.user_id,'safe_config','memory_max_items',
        jsonb_build_object('memory_max_items',cfg.memory_max_items),
        jsonb_build_object('memory_max_items',14),
        'Observed at least 20 recent measured turns with zero runtime errors, no more than one correction signal, and average selected memory count at or below 8; reduce unused memory retrieval headroom conservatively.',
        jsonb_build_object('passed',true,'event_count',event_count,'error_count',error_count,'correction_count',correction_count,'average_selected_memory',avg_selected,'rule','phase0-memory-budget-v1'),
        jsonb_build_object('memory_max_items',cfg.memory_max_items),
        'accepted',now()
      ) returning id into change_id;

      insert into public.emery_self_evaluations(user_id,target_type,target_ref,rubric_version,scores,findings,metadata)
      values(
        cfg.user_id,'memory','autotune:'||change_id::text,'safe-autotune-v1',
        jsonb_build_object('events',event_count,'errors',error_count,'corrections',correction_count,'avg_selected_memory',avg_selected),
        jsonb_build_array('A conservative reversible memory retrieval budget reduction was applied after the evidence threshold passed.'),
        jsonb_build_object('automatic',true,'rollback_available',true,'change_id',change_id)
      );
      applied := applied + 1;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'applied',applied,'checked_at',now());
end;
$$;
revoke execute on function public.run_emery_safe_autotune() from public, anon, authenticated;
grant execute on function public.run_emery_safe_autotune() to service_role;

do $$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='emery-safe-autotune' limit 1;
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('emery-safe-autotune','17 3 * * *','select public.run_emery_safe_autotune();');
end $$;

insert into public.emery_improvement_changes(
  user_id,change_type,scope,before_state,after_state,rationale,validation,rollback_state,status,applied_at
)
select p.user_id,'system_activation','safe_autotune',
       jsonb_build_object('enabled',false),
       jsonb_build_object('enabled',true,'schedule','17 3 * * *'),
       'Activated the evidence-gated, reversible zero-credit safe self-tuning loop. It may only change allowlisted low-risk configuration after measured thresholds pass.',
       jsonb_build_object('passed',true,'criticalFailures',0,'rule','safe-autotune-engine-v1'),
       jsonb_build_object('disable_job','emery-safe-autotune'),
       'accepted',now()
from public.profiles p
where not exists (
  select 1 from public.emery_improvement_changes c
  where c.user_id=p.user_id and c.change_type='system_activation' and c.scope='safe_autotune'
);

create or replace function public.get_hpo_route_candidates(
  p_user_id uuid,
  p_territory text default null,
  p_limit integer default 25
)
returns table(
  entity_type text,
  entity_id uuid,
  name text,
  territory text,
  city text,
  address text,
  priority_score numeric,
  reason text
)
language sql
stable
security invoker
set search_path = public
as $$
  with recent_visits as (
    select coalesce(account_id,prospect_id) entity_id,count(*) visit_count,max(visited_at) last_visit
    from public.hpo_route_stops
    where user_id=p_user_id and status='visited'
    group by coalesce(account_id,prospect_id)
  ),
  prospect_rows as (
    select
      'prospect'::text entity_type,
      p.id entity_id,
      p.name,
      p.territory,
      p.city,
      p.address,
      (
        coalesce((p.metadata->>'internal_priority')::numeric,3)*20
        + coalesce((p.metadata->>'prospect_score')::numeric,0)*5
        + case when p.verification_status='verified' then 10 when p.verification_status='partial' then 4 else -15 end
        - coalesce(v.visit_count,0)*8
      )::numeric priority_score,
      concat_ws('; ',
        'Prospect score '||coalesce(p.metadata->>'prospect_score','n/a'),
        coalesce(p.metadata->>'visit_priority',''),
        case when p.verification_status='verified' then 'verified physical office' else p.verification_status end,
        case when v.last_visit is not null then 'visited '||v.last_visit::date::text else 'not yet visited in structured route history' end
      )::text reason
    from public.hpo_prospects p
    left join recent_visits v on v.entity_id=p.id
    where p.user_id=p_user_id
      and p.fit_status in ('qualified','undecided')
      and p.promoted_account_id is null
      and p.address is not null
      and p.verification_status in ('verified','partial')
      and (p_territory is null or lower(p.territory)=lower(p_territory))
  ),
  account_rows as (
    select
      'account'::text entity_type,
      a.id entity_id,
      a.name,
      a.territory,
      a.city,
      a.address,
      (
        a.priority*20
        + least(coalesce((a.metadata->>'historical_referral_count')::numeric,0),50)
        + case when a.next_action_due_at is not null and a.next_action_due_at <= now() then 18 else 0 end
        + case when a.last_touch_at is null then 8 when a.last_touch_at < now()-interval '30 days' then 12 else 0 end
        - coalesce(v.visit_count,0)*5
      )::numeric priority_score,
      concat_ws('; ',
        'relationship '||a.relationship_stage,
        case when a.metadata->>'historical_referral_count' is not null then 'historical referrals '||(a.metadata->>'historical_referral_count') end,
        case when a.next_action is not null then 'next: '||a.next_action end,
        case when a.last_touch_at is not null then 'last touch '||a.last_touch_at::date::text else 'no structured last touch' end
      )::text reason
    from public.hpo_accounts a
    left join recent_visits v on v.entity_id=a.id
    where a.user_id=p_user_id
      and a.status='active'
      and a.address is not null
      and not ('exclude_from_adam_route'=any(a.tags))
      and (p_territory is null or lower(a.territory)=lower(p_territory))
  )
  select * from (
    select * from account_rows
    union all
    select * from prospect_rows
  ) q
  order by priority_score desc,name
  limit greatest(1,least(coalesce(p_limit,25),100));
$$;
revoke all on function public.get_hpo_route_candidates(uuid,text,integer) from public, anon;
grant execute on function public.get_hpo_route_candidates(uuid,text,integer) to authenticated, service_role;
