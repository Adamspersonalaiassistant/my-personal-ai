-- Emery native HPO Route Planner fields.
-- Additive, non-PHI route-planning data only.

alter table public.hpo_route_plans
  add column if not exists start_address text,
  add column if not exists end_address text,
  add column if not exists start_latitude double precision,
  add column if not exists start_longitude double precision,
  add column if not exists end_latitude double precision,
  add column if not exists end_longitude double precision,
  add column if not exists optimized_distance_meters integer,
  add column if not exists optimized_duration_seconds integer,
  add column if not exists optimized_at timestamptz;

alter table public.hpo_route_stops
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists distance_meters_from_previous integer,
  add column if not exists drive_seconds_from_previous integer;

update public.hpo_route_stops s
set
  address = coalesce(
    s.address,
    (select a.address from public.hpo_accounts a where a.id = s.account_id),
    (select p.address from public.hpo_prospects p where p.id = s.prospect_id)
  ),
  city = coalesce(
    s.city,
    (select a.city from public.hpo_accounts a where a.id = s.account_id),
    (select p.city from public.hpo_prospects p where p.id = s.prospect_id)
  )
where s.address is null or s.city is null;

create index if not exists hpo_route_plans_user_date_idx
  on public.hpo_route_plans(user_id, route_date desc);

create index if not exists hpo_route_stops_user_route_order_idx
  on public.hpo_route_stops(user_id, route_id, stop_order);

comment on column public.hpo_route_plans.start_address is
  'Optional route origin entered by Adam for Emery native route optimization.';
comment on column public.hpo_route_plans.end_address is
  'Optional route destination entered by Adam for Emery native route optimization.';
comment on column public.hpo_route_plans.optimized_distance_meters is
  'Road distance estimate from the most recent Emery route optimization.';
comment on column public.hpo_route_plans.optimized_duration_seconds is
  'Driving-time estimate from the most recent Emery route optimization.';
comment on column public.hpo_route_stops.address is
  'Verified or user-entered field-stop address copied into the route journal.';
comment on column public.hpo_route_stops.visit_summary is
  'Non-PHI daily marketing note for the route journal and Excel copy workflow.';
