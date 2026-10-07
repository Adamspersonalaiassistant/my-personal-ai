-- HPO next-morning relationship-activity recaps.
-- Uses the existing app_notifications delivery pipeline and does not create
-- PHI, duplicate activities, or a second calendar / CRM.
CREATE OR REPLACE FUNCTION public.run_hpo_activity_recaps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  person record;
  activity record;
  created_count integer := 0;
  new_id uuid;
  local_hour integer;
  local_yesterday date;
BEGIN
  FOR person IN
    SELECT user_id, coalesce(nullif(timezone, ''), 'America/New_York') AS timezone
    FROM public.profiles
  LOOP
    BEGIN
      local_hour := extract(hour from now() at time zone person.timezone)::integer;
      local_yesterday := (now() at time zone person.timezone)::date - 1;
    EXCEPTION WHEN OTHERS THEN
      local_hour := extract(hour from now() at time zone 'America/New_York')::integer;
      local_yesterday := (now() at time zone 'America/New_York')::date - 1;
      person.timezone := 'America/New_York';
    END;
    IF local_hour NOT BETWEEN 8 AND 10 THEN CONTINUE; END IF;
    FOR activity IN
      SELECT m.id, m.title, m.meeting_at, m.metadata
      FROM public.meetings m
      WHERE m.user_id = person.user_id
        AND (coalesce(m.end_at, m.meeting_at + interval '1 hour') AT TIME ZONE person.timezone)::date = local_yesterday
        AND (
          m.metadata->>'hpo_activity_type' IN ('office_visit', 'lunch', 'dinner', 'event')
          OR m.metadata->>'hpo' = 'true'
          OR m.metadata->>'domain' = 'hpo'
          OR nullif(m.metadata->>'hpo_account_id', '') IS NOT NULL
          OR nullif(m.metadata->>'account_id', '') IS NOT NULL
          OR (
            m.metadata->>'event_type' IN ('lunch','dinner','event')
            AND coalesce(m.title,'') ~* '(attorney|law firm|esq\.?|mri|medical|physician|doctor|clinic|orthop|networking|grand opening|5k|race booth|hudson pro)'
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.hpo_interactions i
          WHERE i.user_id = m.user_id AND i.meeting_id = m.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.app_notifications n
          WHERE n.user_id = m.user_id AND n.source_type = 'hpo_activity_recap'
            AND n.source_ref = m.id::text
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.hpo_interactions i
          WHERE i.user_id = m.user_id
            AND i.source_type = 'route'
            AND i.account_id::text = coalesce(nullif(m.metadata->>'hpo_account_id',''), nullif(m.metadata->>'account_id',''))
            AND i.occurred_at BETWEEN m.meeting_at - interval '15 minutes' AND m.meeting_at + interval '12 hours'
            AND length(btrim(i.summary)) >= 35
        )
    LOOP
      new_id := null;
      INSERT INTO public.app_notifications (
        user_id,title,body,scheduled_for,status,source_type,source_ref,metadata
      ) VALUES (
        person.user_id,
        'How did your HPO activity go?',
        'How did “' || coalesce(activity.title,'your HPO activity') ||
        '” go yesterday? Tell Emery who you met, what happened, and the next step so it can be saved in Activity and the right account.',
        now(),'pending','hpo_activity_recap',activity.id::text,
        jsonb_build_object('meeting_id',activity.id,'workflow','hpo_activity_recap','timezone',person.timezone)
      )
      ON CONFLICT DO NOTHING RETURNING id INTO new_id;
      IF new_id IS NOT NULL THEN created_count := created_count + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('created', created_count);
END;
$$;
REVOKE ALL ON FUNCTION public.run_hpo_activity_recaps() FROM PUBLIC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='emery-hpo-next-day-recaps') THEN
    PERFORM cron.schedule('emery-hpo-next-day-recaps', '*/30 * * * *',
      'SELECT public.run_hpo_activity_recaps();');
  END IF;
END;
$$;
