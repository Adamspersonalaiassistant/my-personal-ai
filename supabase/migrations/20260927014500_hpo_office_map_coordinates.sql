-- Persistent coordinates for the always-on HPO office planning map.

alter table public.hpo_accounts
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocoded_at timestamptz;

alter table public.hpo_prospects
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocoded_at timestamptz;

create index if not exists hpo_accounts_user_geo_idx
  on public.hpo_accounts(user_id, latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists hpo_prospects_user_geo_idx
  on public.hpo_prospects(user_id, latitude, longitude)
  where latitude is not null and longitude is not null;
