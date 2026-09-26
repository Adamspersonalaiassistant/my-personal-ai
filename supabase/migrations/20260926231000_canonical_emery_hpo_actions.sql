
create or replace function public.emery_hpo_log_touch(
  p_user_id uuid,
  p_account_id uuid,
  p_interaction_type text,
  p_summary text,
  p_outcome text default null,
  p_relationship_signal text default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_source text default 'emery'
)
returns public.hpo_interactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.hpo_interactions;
begin
  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then raise exception 'unauthorized'; end if;
  if nullif(trim(p_summary),'') is null then raise exception 'interaction summary required'; end if;
  if not exists(select 1 from public.hpo_accounts where id=p_account_id and user_id=p_user_id) then
    raise exception 'account not found';
  end if;

  insert into public.hpo_interactions(
    user_id,account_id,interaction_type,occurred_at,summary,outcome,relationship_signal,
    next_action,next_action_due_at,source_type,source_ref,metadata
  ) values(
    p_user_id,p_account_id,coalesce(nullif(trim(p_interaction_type),''),'visit'),now(),trim(p_summary),
    nullif(trim(coalesce(p_outcome,'')),''),
    nullif(trim(coalesce(p_relationship_signal,'')),''),
    nullif(trim(coalesce(p_next_action,'')),''),
    p_next_action_due_at,
    p_source,
    'emery-hpo:'||gen_random_uuid()::text,
    jsonb_build_object('non_phi',true,'source',p_source)
  ) returning * into v;

  update public.hpo_accounts set
    last_touch_at=v.occurred_at,
    next_action=coalesce(v.next_action,next_action),
    next_action_due_at=coalesce(v.next_action_due_at,next_action_due_at),
    updated_at=now()
  where id=p_account_id and user_id=p_user_id;

  return v;
end;
$$;
revoke all on function public.emery_hpo_log_touch(uuid,uuid,text,text,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.emery_hpo_log_touch(uuid,uuid,text,text,text,text,text,timestamptz,text) to authenticated,service_role;

create or replace function public.emery_hpo_set_followup(
  p_user_id uuid,
  p_account_id uuid,
  p_next_action text,
  p_due_at timestamptz default null,
  p_source text default 'emery'
)
returns public.hpo_accounts
language plpgsql
security invoker
set search_path = public
as $$
declare v public.hpo_accounts;
begin
  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then raise exception 'unauthorized'; end if;
  if nullif(trim(p_next_action),'') is null then raise exception 'next action required'; end if;

  update public.hpo_accounts set
    next_action=trim(p_next_action),
    next_action_due_at=p_due_at,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_followup_source',p_source),
    updated_at=now()
  where id=p_account_id and user_id=p_user_id
  returning * into v;
  if v.id is null then raise exception 'account not found'; end if;
  return v;
end;
$$;
revoke all on function public.emery_hpo_set_followup(uuid,uuid,text,timestamptz,text) from public,anon;
grant execute on function public.emery_hpo_set_followup(uuid,uuid,text,timestamptz,text) to authenticated,service_role;
