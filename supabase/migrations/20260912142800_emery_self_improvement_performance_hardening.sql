create index if not exists emery_improvement_changes_backlog_idx on public.emery_improvement_changes(backlog_id);

drop policy if exists "users manage own improvement backlog" on public.emery_improvement_backlog;
create policy "users manage own improvement backlog" on public.emery_improvement_backlog for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own self evaluations" on public.emery_self_evaluations;
create policy "users manage own self evaluations" on public.emery_self_evaluations for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own improvement changes" on public.emery_improvement_changes;
create policy "users manage own improvement changes" on public.emery_improvement_changes for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own emery config" on public.emery_config;
create policy "users manage own emery config" on public.emery_config for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own agent metrics" on public.emery_agent_metrics;
create policy "users manage own agent metrics" on public.emery_agent_metrics for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);