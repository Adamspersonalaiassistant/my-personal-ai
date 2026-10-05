-- JARVIS Run 1: safe security fixes + owner-gated database diagnostics.
--
-- * Trigger-only functions must not be callable through PostgREST RPC.
--   Revoking EXECUTE does not affect trigger firing (Postgres checks EXECUTE
--   only when the trigger is created).
-- * Pin the mutable search_path flagged by the Supabase security advisor.
-- * pg_net is intentionally NOT moved: it is not relocatable and the
--   emery-push-dispatch cron job depends on it. Recorded as a known advisory.
-- * hpo_import_payload_staging intentionally stays RLS-enabled with no
--   policies (service-only staging). Not changed.

revoke execute on function public.sync_task_reminder_workflow() from public, anon, authenticated;

alter function public.touch_emery_execution_run_updated_at() set search_path = public, pg_temp;
revoke execute on function public.touch_emery_execution_run_updated_at() from public, anon, authenticated;

revoke execute on function public.notify_jarvis_session_complete() from public, anon, authenticated;

-- Read-only diagnostics for JARVIS. SECURITY INVOKER (reads only catalog
-- metadata visible to the caller) and owner-gated; never returns row data or
-- secrets.
create or replace function public.jarvis_database_diagnostics()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  result jsonb;
begin
  if not public.is_emery_owner() then
    raise exception 'jarvis_database_diagnostics: owner only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'observed_at', now(),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', c.relname,
        'rls_enabled', c.relrowsecurity,
        'policy_count', (select count(*) from pg_policy p where p.polrelid = c.oid),
        'estimated_rows', greatest(c.reltuples, 0)::bigint
      ) order by c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ), '[]'::jsonb),
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb),
    'rls_without_policies', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    ), '[]'::jsonb),
    'functions_mutable_search_path', coalesce((
      select jsonb_agg(p.proname order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
      where n.nspname = 'public' and d.objid is null
        and p.prokind = 'f'
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%'
        )
    ), '[]'::jsonb),
    'security_definer_executable_by_anon', coalesce((
      select jsonb_agg(p.proname order by p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
      where n.nspname = 'public' and d.objid is null and p.prosecdef
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    ), '[]'::jsonb),
    'extensions_in_public', coalesce((
      select jsonb_agg(e.extname order by e.extname)
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where n.nspname = 'public'
    ), '[]'::jsonb),
    'unindexed_foreign_keys', coalesce((
      select jsonb_agg(jsonb_build_object('table', cl.relname, 'constraint', con.conname))
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where con.contype = 'f' and n.nspname = 'public'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = con.conrelid
            and (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] @> con.conkey
        )
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.jarvis_database_diagnostics() from public, anon;
grant execute on function public.jarvis_database_diagnostics() to authenticated;
