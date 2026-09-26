
-- Emery is intentionally a private single-owner system.
-- Existing per-user RLS remains in place; this restrictive policy adds an independent owner gate.
do $$
declare
  r record;
begin
  for r in
    select distinct c.table_name
    from information_schema.columns c
    join pg_tables t on t.schemaname='public' and t.tablename=c.table_name
    where c.table_schema='public'
      and c.column_name='user_id'
      and c.table_name <> 'emery_owner_registry'
  loop
    execute format('alter table public.%I enable row level security',r.table_name);
    execute format('drop policy if exists emery_single_owner_guard on public.%I',r.table_name);
    execute format(
      'create policy emery_single_owner_guard on public.%I as restrictive for all to authenticated using (public.is_emery_owner() and user_id=auth.uid()) with check (public.is_emery_owner() and user_id=auth.uid())',
      r.table_name
    );
  end loop;
end $$;

-- pg_net is non-relocatable in this Supabase project, so keep it for server cron/web-push
-- but remove browser-authenticated access to its schema/functions/tables.
revoke all on schema net from anon, authenticated;
revoke execute on all functions in schema net from anon, authenticated;
revoke all on all tables in schema net from anon, authenticated;
revoke all on all sequences in schema net from anon, authenticated;
grant usage on schema net to service_role;
grant execute on all functions in schema net to service_role;

insert into public.emery_security_events(user_id,event_type,channel,severity,metadata)
select user_id,'single_owner_lockdown_enabled','migration','info',
       jsonb_build_object(
         'owner_restrictive_rls',true,
         'pg_net_client_access_revoked',true,
         'pg_net_relocation','not possible because installed version is non-relocatable'
       )
from public.profiles
where not exists (
  select 1 from public.emery_security_events e
  where e.user_id=profiles.user_id and e.event_type='single_owner_lockdown_enabled'
);
