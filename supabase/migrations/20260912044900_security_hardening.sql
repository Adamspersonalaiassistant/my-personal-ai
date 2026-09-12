-- Keep common trigger helpers from inheriting a mutable caller search_path.
alter function if exists public.set_updated_at() set search_path = pg_catalog;

-- This event-trigger helper is internal database infrastructure and should not
-- be invokable through the Data API by anonymous or signed-in app users.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
