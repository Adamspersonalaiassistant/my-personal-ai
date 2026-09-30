/* eslint-disable @typescript-eslint/no-explicit-any -- HPO route metadata is intentionally flexible. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type WeeklyPlannerInput = {
  weekStart?: string | null;
};

function validDateKey(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDaysKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return date.toISOString().slice(0, 10);
}

function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function mondayFor(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addDaysKey(value, delta);
}

export const getHpoWeeklyPlanner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: WeeklyPlannerInput = {}) => ({
    weekStart: validDateKey(input?.weekStart) ? String(input.weekStart) : null,
  }))
  .handler(async ({ context, data }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw profileError;

    const timezone = profile?.timezone || "America/New_York";
    const today = localDateKey(new Date(), timezone);
    const weekStart = data.weekStart ?? mondayFor(today);
    const weekEnd = addDaysKey(weekStart, 6);

    const { data: routes, error: routesError } = await db
      .from("hpo_route_plans")
      .select(
        "id,route_date,area,status,start_window,end_window,optimized_distance_meters,optimized_duration_seconds,optimized_at,notes,metadata,start_latitude,start_longitude,end_latitude,end_longitude,updated_at",
      )
      .eq("user_id", userId)
      .gte("route_date", weekStart)
      .lte("route_date", weekEnd)
      .order("route_date", { ascending: true })
      .order("updated_at", { ascending: false });
    if (routesError) throw routesError;

    const routeIds = (routes ?? []).map((route: any) => route.id);
    let stops: any[] = [];
    if (routeIds.length) {
      const { data: stopRows, error: stopsError } = await db
        .from("hpo_route_stops")
        .select(
          "id,route_id,account_id,prospect_id,stop_order,status,visited_at,office_name,address,city,notes,visit_summary,visit_outcome,next_action,next_action_due_at,latitude,longitude,metadata,updated_at",
        )
        .eq("user_id", userId)
        .in("route_id", routeIds)
        .order("stop_order", { ascending: true });
      if (stopsError) throw stopsError;
      stops = stopRows ?? [];
    }

    const stopsByRoute = new Map<string, any[]>();
    for (const stop of stops) {
      const current = stopsByRoute.get(stop.route_id) ?? [];
      current.push(stop);
      stopsByRoute.set(stop.route_id, current);
    }

    return {
      today,
      timezone,
      weekStart,
      weekEnd,
      routes: (routes ?? []).map((route: any) => ({
        ...route,
        stops: stopsByRoute.get(route.id) ?? [],
      })),
    };
  });

