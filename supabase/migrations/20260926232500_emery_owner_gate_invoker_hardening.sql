
grant select on public.emery_owner_registry to authenticated;
drop policy if exists emery_owner_registry_self_read on public.emery_owner_registry;
create policy emery_owner_registry_self_read
on public.emery_owner_registry
for select
to authenticated
using (user_id = auth.uid());

alter function public.is_emery_owner() security invoker;
