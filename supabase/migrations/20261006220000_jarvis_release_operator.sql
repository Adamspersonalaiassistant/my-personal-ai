-- JARVIS release operator state.
--
-- Release state lives in jarvis_engineering_tasks.metadata.release and Adam's
-- sha-bound approval in metadata.release_approval. Both are written with
-- key-level jsonb merges so the worker and the app can never overwrite each
-- other's keys, and the release state moves only by compare-and-set (a second
-- concurrent tick can never merge twice).

create or replace function public.jarvis_cas_release(
  p_task uuid,
  p_from text,
  p_release jsonb,
  p_patch jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  update public.jarvis_engineering_tasks t
     set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object('release', p_release),
         status = coalesce(p_patch->>'status', t.status),
         result_summary = coalesce(p_patch->>'result_summary', t.result_summary),
         commit_sha = coalesce(p_patch->>'commit_sha', t.commit_sha),
         blocker = coalesce(p_patch->>'blocker', t.blocker)
   where t.id = p_task
     and (
       (p_from is null and not (coalesce(t.metadata, '{}'::jsonb) ? 'release'))
       or (t.metadata->'release'->>'state') = p_from
     );
  return found;
end;
$function$;

revoke all on function public.jarvis_cas_release(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.jarvis_cas_release(uuid, text, jsonb, jsonb) to service_role;

-- Adam's approval, written by the app as the signed-in owner (RLS applies).
-- Only the release_approval key is touched.
create or replace function public.jarvis_set_release_approval(p_task uuid, p_approval jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  update public.jarvis_engineering_tasks t
     set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object('release_approval', p_approval)
   where t.id = p_task
     and t.status = 'ready_for_release'
     and t.is_fixture = false;
  return found;
end;
$function$;

revoke all on function public.jarvis_set_release_approval(uuid, jsonb) from public, anon;
grant execute on function public.jarvis_set_release_approval(uuid, jsonb) to authenticated, service_role;
