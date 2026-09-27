alter table public.emery_config
  add column if not exists hpo_map_v2 boolean not null default false;

comment on column public.emery_config.hpo_map_v2 is
  'Runtime feature flag for the MapLibre-backed HPO territory map. Map V1 remains available as fallback.';
