create or replace function public.emery_track_memory_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  now_ts timestamptz := now();
begin
  if new.source_type = 'manual_correction' and old.content is distinct from new.content then
    select id into existing_id
    from public.emery_improvement_backlog
    where user_id = new.user_id
      and area = 'memory'
      and title = 'Memory corrections are recurring'
      and status in ('observed','proposed','testing')
    order by updated_at desc
    limit 1;

    if existing_id is null then
      insert into public.emery_improvement_backlog (
        user_id, area, title, problem_statement, evidence, severity,
        expected_benefit, confidence, status, occurrence_count,
        last_observed_at, created_at, updated_at
      ) values (
        new.user_id,
        'memory',
        'Memory corrections are recurring',
        'Adam corrected a durable memory. Track repeated corrections so Emery can improve memory extraction and replacement behavior instead of stacking outdated context.',
        jsonb_build_array(jsonb_build_object('memory_id', new.id, 'at', now_ts)),
        2,
        'Fewer stale or contradictory memories and less manual cleanup.',
        0.95,
        'observed',
        1,
        now_ts,
        now_ts,
        now_ts
      );
    else
      update public.emery_improvement_backlog
      set occurrence_count = occurrence_count + 1,
          evidence = coalesce(evidence, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('memory_id', new.id, 'at', now_ts)),
          last_observed_at = now_ts,
          confidence = greatest(confidence, 0.95),
          severity = case when occurrence_count + 1 >= 3 then greatest(severity, 3) else severity end,
          updated_at = now_ts
      where id = existing_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.emery_track_memory_correction() from public;
revoke all on function public.emery_track_memory_correction() from anon;
revoke all on function public.emery_track_memory_correction() from authenticated;

drop trigger if exists emery_memory_correction_signal on public.memories;
create trigger emery_memory_correction_signal
after update of content, source_type on public.memories
for each row
execute function public.emery_track_memory_correction();