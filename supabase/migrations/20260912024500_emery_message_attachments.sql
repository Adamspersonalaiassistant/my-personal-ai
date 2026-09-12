create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.conversation_messages(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_conversation_idx
  on public.message_attachments (conversation_id, created_at);
create index if not exists message_attachments_message_idx
  on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;

drop policy if exists "Users can read own attachments" on public.message_attachments;
create policy "Users can read own attachments"
  on public.message_attachments for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own attachments" on public.message_attachments;
create policy "Users can insert own attachments"
  on public.message_attachments for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own attachments" on public.message_attachments;
create policy "Users can delete own attachments"
  on public.message_attachments for delete to authenticated
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'emery-attachments',
  'emery-attachments',
  false,
  26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif','application/pdf',
    'text/plain','text/markdown','text/csv','application/json','application/octet-stream',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own Emery attachments" on storage.objects;
create policy "Users can upload own Emery attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'emery-attachments'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "Users can read own Emery attachments" on storage.objects;
create policy "Users can read own Emery attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'emery-attachments'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "Users can delete own Emery attachments" on storage.objects;
create policy "Users can delete own Emery attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'emery-attachments'
    and split_part(name, '/', 1) = auth.uid()::text
  );
