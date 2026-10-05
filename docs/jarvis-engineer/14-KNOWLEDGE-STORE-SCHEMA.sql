-- JARVIS structured engineering-knowledge store.
-- Applied to production Supabase on 2026-10-05 during foundation bootstrap.

create table public.jarvis_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null check (category in (
    'product_decision','user_preference','constraint','failure_signal',
    'workflow_requirement','acceptance_test','architecture','history','lesson','research_reference'
  )),
  title text not null,
  content text not null,
  status text not null default 'current' check (status in ('current','historical','superseded')),
  importance smallint not null default 3 check (importance between 1 and 5),
  source_type text not null,
  source_ref text,
  source_timestamp timestamptz,
  supersedes_id uuid references public.jarvis_knowledge_items(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jarvis_knowledge_user_category_idx
  on public.jarvis_knowledge_items(user_id,status,category,importance desc,updated_at desc);
create index jarvis_knowledge_source_idx
  on public.jarvis_knowledge_items(user_id,source_type,source_ref);
create index jarvis_knowledge_supersedes_idx
  on public.jarvis_knowledge_items(supersedes_id);

alter table public.jarvis_knowledge_items enable row level security;

create policy "emery_single_owner_guard" on public.jarvis_knowledge_items
for all to authenticated
using ((select is_emery_owner()) and user_id = (select auth.uid()))
with check ((select is_emery_owner()) and user_id = (select auth.uid()));

grant select,insert,update,delete on public.jarvis_knowledge_items to authenticated;
revoke all on public.jarvis_knowledge_items from anon;

create trigger set_jarvis_knowledge_items_updated_at
before update on public.jarvis_knowledge_items
for each row execute function public.set_updated_at();
