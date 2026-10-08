-- Authenticated, atomic account plus relationship contacts creation.
-- Mirrors deployed Supabase migration hpo_atomic_account_contacts_form.
CREATE OR REPLACE FUNCTION public.hpo_create_account_with_contacts(
  p_account jsonb, p_contacts jsonb DEFAULT '[]'::jsonb,
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_account_id uuid;
  v_existing uuid;
  v_contact jsonb;
  v_name text := btrim(coalesce(p_account->>'name',''));
  v_city text := nullif(btrim(coalesce(p_account->>'city','')), '');
  v_address text := nullif(btrim(coalesce(p_account->>'address','')), '');
  v_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 180 THEN RAISE EXCEPTION 'Enter a valid office name'; END IF;
  IF jsonb_typeof(p_contacts) <> 'array' OR jsonb_array_length(p_contacts) > 20
    THEN RAISE EXCEPTION 'Invalid contacts list'; END IF;
  IF (p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90))
    OR (p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180))
    THEN RAISE EXCEPTION 'Invalid map coordinates'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_user::text || lower(v_name) ||
    lower(coalesce(v_address,'')) || lower(coalesce(v_city,''))));
  SELECT id INTO v_existing FROM public.hpo_accounts
  WHERE user_id=v_user
    AND lower(btrim(name))=lower(v_name)
    AND ((v_address IS NOT NULL AND
      lower(regexp_replace(coalesce(address,''),'[^a-zA-Z0-9]','','g')) =
      lower(regexp_replace(v_address,'[^a-zA-Z0-9]','','g')))
    OR (v_address IS NULL AND lower(coalesce(city,''))=lower(coalesce(v_city,''))))
  ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('created',false,'duplicate',true,'accountId',v_existing);
  END IF;
  INSERT INTO public.hpo_accounts
    (user_id,name,account_type,specialty,territory,city,address,priority,
     owner_name,relationship_stage,status,source_origin,notes,
     latitude,longitude,geocoded_at,metadata)
  VALUES (v_user,v_name,nullif(btrim(coalesce(p_account->>'accountType','')),''),
    nullif(btrim(coalesce(p_account->>'specialty','')),''),
    nullif(btrim(coalesce(p_account->>'territory','')),''),v_city,v_address,
    greatest(1,least(5,coalesce(nullif(p_account->>'priority','')::integer,3))),
    nullif(btrim(coalesce(p_account->>'ownerName','')),''),
    coalesce(nullif(btrim(coalesce(p_account->>'relationshipStage','')),''),'prospect'),
    'active','manual_account_form',
    nullif(btrim(coalesce(p_account->>'notes','')),''),
    p_latitude,p_longitude,
    CASE WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN now() ELSE NULL END,
    jsonb_build_object('created_via','emery_hpo_account_form'))
  RETURNING id INTO v_account_id;
  FOR v_contact IN SELECT value FROM jsonb_array_elements(p_contacts)
  LOOP
    IF btrim(coalesce(v_contact->>'name',''))='' THEN CONTINUE; END IF;
    INSERT INTO public.hpo_contacts
      (user_id,account_id,name,role_title,phone,email,relationship_notes,source_origin,metadata)
    VALUES (v_user,v_account_id,btrim(v_contact->>'name'),
      nullif(btrim(coalesce(v_contact->>'roleTitle','')),''),
      nullif(btrim(coalesce(v_contact->>'phone','')),''),
      nullif(btrim(coalesce(v_contact->>'email','')),''),
      nullif(btrim(coalesce(v_contact->>'relationshipNotes','')),''),
      'manual_account_form',jsonb_build_object('created_via','emery_hpo_account_form'));
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('created',true,'duplicate',false,
    'accountId',v_account_id,'contactsCreated',v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.hpo_create_account_with_contacts(jsonb,jsonb,double precision,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hpo_create_account_with_contacts(jsonb,jsonb,double precision,double precision) TO authenticated;
