/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  beginExecution,
  completeExecution,
  failExecution,
} from "@/lib/execution-ledger";

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function timezoneFor(db: any, userId: string) {
  const { data } = await db.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  return data?.timezone || "America/New_York";
}

function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map["year"]}-${map["month"]}-${map["day"]}`;
}

function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const lat1 = aLat * rad;
  const lat2 = bLat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function roadMatrix(points: Array<{ lat: number; lon: number }>) {
  const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${coordinates}?annotations=duration,distance`,
    { headers: { "User-Agent": "EmeryPersonalAI/1.0 HPO-field-os" } },
  );
  if (!response.ok) throw new Error("Road-time routing is temporarily unavailable.");
  const payload = await response.json();
  if (!Array.isArray(payload?.durations) || !Array.isArray(payload?.distances)) {
    throw new Error("Road-time routing returned incomplete data.");
  }
  return {
    durations: payload.durations as Array<Array<number | null>>,
    distances: payload.distances as Array<Array<number | null>>,
  };
}

function routeCost(
  sequence: number[],
  durations: Array<Array<number | null>>,
  startIndex: number | null,
  endIndex: number | null,
) {
  let total = 0;
  let previous = startIndex;
  for (const index of sequence) {
    if (previous != null) total += durations[previous]?.[index] ?? 1e12;
    previous = index;
  }
  if (previous != null && endIndex != null) total += durations[previous]?.[endIndex] ?? 1e12;
  return total;
}

function optimizeSequence(
  stopIndexes: number[],
  durations: Array<Array<number | null>>,
  startIndex: number | null,
  endIndex: number | null,
) {
  if (stopIndexes.length <= 1) return [...stopIndexes];
  const remaining = new Set(stopIndexes);
  const result: number[] = [];
  let current = startIndex;
  if (current == null) {
    const first = stopIndexes[0]!;
    result.push(first);
    remaining.delete(first);
    current = first;
  }
  while (remaining.size) {
    let best: number | null = null;
    let cost = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      const next = current == null ? 0 : durations[current]?.[candidate] ?? Number.POSITIVE_INFINITY;
      if (next < cost) {
        best = candidate;
        cost = next;
      }
    }
    if (best == null) {
      result.push(...remaining);
      break;
    }
    result.push(best);
    remaining.delete(best);
    current = best;
  }

  let improved = true;
  let passes = 0;
  while (improved && passes < 8) {
    improved = false;
    passes += 1;
    const base = routeCost(result, durations, startIndex, endIndex);
    for (let i = startIndex == null ? 1 : 0; i < result.length - 1; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const candidate = [
          ...result.slice(0, i),
          ...result.slice(i, j + 1).reverse(),
          ...result.slice(j + 1),
        ];
        const next = routeCost(candidate, durations, startIndex, endIndex);
        if (next + 1 < base) {
          result.splice(0, result.length, ...candidate);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return result;
}

async function routeGeometry(points: Array<{ lat: number; lon: number }>) {
  if (points.length < 2) return null;
  try {
    const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(";");
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { headers: { "User-Agent": "EmeryPersonalAI/1.0 HPO-field-os" } },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const raw = payload?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(raw)) return null;
    const stride = Math.max(1, Math.ceil(raw.length / 260));
    return raw
      .filter((_point: unknown, index: number) => index % stride === 0 || index === raw.length - 1)
      .map((point: unknown) => {
        const pair = Array.isArray(point) ? point : [];
        return [Number(pair[0]), Number(pair[1])] as [number, number];
      })
      .filter((point: [number, number]) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  } catch {
    return null;
  }
}

async function loadRoute(db: any, userId: string, routeId: string) {
  const { data, error } = await db
    .from("hpo_route_plans")
    .select("*")
    .eq("id", routeId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw error ?? new Error("Route not found");
  return data;
}

async function loadStops(db: any, userId: string, routeId: string) {
  const { data, error } = await db
    .from("hpo_route_stops")
    .select("*")
    .eq("route_id", routeId)
    .eq("user_id", userId)
    .order("stop_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function clearRouteOptimization(db: any, userId: string, routeId: string) {
  const { data: route } = await db
    .from("hpo_route_plans")
    .select("metadata")
    .eq("id", routeId)
    .eq("user_id", userId)
    .maybeSingle();
  const metadata =
    route?.metadata && typeof route.metadata === "object" && !Array.isArray(route.metadata)
      ? { ...route.metadata }
      : {};
  delete metadata["route_geometry_remaining"];
  delete metadata["reoptimized_at"];
  const { error } = await db
    .from("hpo_route_plans")
    .update({
      optimized_at: null,
      optimized_distance_meters: null,
      optimized_duration_seconds: null,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", routeId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function getHpoFieldTodayCore(input: { db: any; userId: string }) {
  const db = input.db;
  const userId = input.userId;
  const timezone = await timezoneFor(db, userId);
  const today = localDate(timezone);
  const { data: routeRows, error: routeError } = await db
    .from("hpo_route_plans")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["draft", "planned", "active", "in_progress"])
    .gte("route_date", today)
    .order("route_date", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(12);
  if (routeError) throw routeError;

  const routes = routeRows ?? [];
  const route =
    routes.find((row: any) => row.route_date === today && ["active", "in_progress"].includes(row.status)) ??
    routes.find((row: any) => row.route_date === today) ??
    routes.find((row: any) => ["active", "in_progress"].includes(row.status)) ??
    routes[0] ??
    null;

  if (!route) {
    return {
      timezone,
      today,
      route: null,
      stops: [],
      nextStop: null,
      lastCompletedStop: null,
      completed: 0,
      total: 0,
      remaining: 0,
      progress: 0,
      accountContext: null,
    };
  }

  const stops = await loadStops(db, userId, route.id);
  const completedStops = stops.filter((stop: any) => TERMINAL.has(String(stop.status)));
  const nextStop = stops.find((stop: any) => !TERMINAL.has(String(stop.status))) ?? null;
  const lastCompletedStop = [...completedStops]
    .sort((a: any, b: any) => Date.parse(b.visited_at ?? b.updated_at) - Date.parse(a.visited_at ?? a.updated_at))[0] ?? null;

  let accountContext: any = null;
  if (nextStop?.account_id) {
    const [accountResult, contactsResult, interactionsResult, historyResult] = await Promise.all([
      db
        .from("hpo_accounts")
        .select("*")
        .eq("id", nextStop.account_id)
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("hpo_contacts")
        .select("id,name,role_title,email,phone,relationship_notes,is_primary")
        .eq("account_id", nextStop.account_id)
        .eq("user_id", userId)
        .order("is_primary", { ascending: false })
        .limit(8),
      db
        .from("hpo_interactions")
        .select("id,occurred_at,interaction_type,summary,outcome,next_action,next_action_due_at,source_type,source_ref,metadata")
        .eq("account_id", nextStop.account_id)
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(8),
      db
        .from("hpo_route_stops")
        .select("id,route_id,visited_at,status,visit_summary,visit_outcome,next_action,next_action_due_at")
        .eq("account_id", nextStop.account_id)
        .eq("user_id", userId)
        .neq("id", nextStop.id)
        .order("visited_at", { ascending: false, nullsFirst: false })
        .limit(6),
    ]);
    accountContext = accountResult.data
      ? {
          account: accountResult.data,
          contacts: contactsResult.data ?? [],
          interactions: interactionsResult.data ?? [],
          priorRouteStops: historyResult.data ?? [],
        }
      : null;
  }

  return {
    timezone,
    today,
    route,
    stops,
    nextStop,
    lastCompletedStop,
    completed: completedStops.length,
    total: stops.length,
    remaining: Math.max(0, stops.length - completedStops.length),
    progress: stops.length ? completedStops.length / stops.length : 0,
    accountContext,
  };
}

export const getHpoFieldToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    getHpoFieldTodayCore({
      db: context.supabase as any,
      userId: context.userId,
    }),
  );

export const arriveHpoRouteStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { stopId: string; idempotencyKey: string; sourceChannel?: string | null; baseUpdatedAt?: string | null }) => ({
    stopId: clean(input.stopId),
    idempotencyKey: clean(input.idempotencyKey),
    sourceChannel: clean(input.sourceChannel) || "ui",
    baseUpdatedAt:
      input.baseUpdatedAt && !Number.isNaN(Date.parse(input.baseUpdatedAt))
        ? new Date(input.baseUpdatedAt).toISOString()
        : null,
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const action = "hpo.route_stop.arrive";
    const run = await beginExecution({
      db,
      userId: context.userId,
      domain: "hpo_route",
      action,
      idempotencyKey: data.idempotencyKey,
      targetType: "hpo_route_stop",
      targetId: data.stopId,
      requestPayload: { stopId: data.stopId, sourceChannel: data.sourceChannel, baseUpdatedAt: data.baseUpdatedAt },
    });
    if (run.reused && run.status === "completed" && run.resultPayload["arrival"]) {
      return run.resultPayload["arrival"];
    }
    try {
      const { data: stop, error } = await db
        .from("hpo_route_stops")
        .select("*")
        .eq("id", data.stopId)
        .eq("user_id", context.userId)
        .single();
      if (error || !stop) throw error ?? new Error("Route stop not found");
      if (
        data.baseUpdatedAt &&
        !Number.isNaN(Date.parse(stop.updated_at)) &&
        Date.parse(stop.updated_at) > Date.parse(data.baseUpdatedAt) + 1000
      ) {
        throw new Error("offline_conflict: This stop changed after the offline snapshot. Refresh before retrying.");
      }
      if (TERMINAL.has(String(stop.status))) throw new Error("This stop already has a final outcome");
      const metadata =
        stop.metadata && typeof stop.metadata === "object" && !Array.isArray(stop.metadata)
          ? stop.metadata
          : {};
      const arrivedAt = new Date().toISOString();
      const { data: updated, error: updateError } = await db
        .from("hpo_route_stops")
        .update({
          status: "arrived",
          metadata: { ...metadata, arrived_at: arrivedAt, arrival_execution_run_id: run.id },
          updated_at: arrivedAt,
        })
        .eq("id", stop.id)
        .eq("user_id", context.userId)
        .select("*")
        .single();
      if (updateError || !updated || updated.status !== "arrived") {
        throw updateError ?? new Error("Arrival verification failed");
      }
      await db
        .from("hpo_route_plans")
        .update({ status: "active", updated_at: arrivedAt })
        .eq("id", stop.route_id)
        .eq("user_id", context.userId);
      const result = {
        ok: true,
        action,
        executionRunId: run.id,
        stop: updated,
        arrivedAt,
        reused: run.reused,
      };
      await completeExecution({
        db,
        userId: context.userId,
        runId: run.id,
        resultPayload: { arrival: result },
        targetType: "hpo_route_stop",
        targetId: stop.id,
      });
      return result;
    } catch (error) {
      await failExecution({
        db,
        userId: context.userId,
        runId: run.id,
        errorCode: "hpo_route_stop_arrive_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      }).catch(() => undefined);
      throw error;
    }
  });

export const addHpoRouteStops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    routeId: string;
    stops: Array<{
      accountId?: string | null;
      prospectId?: string | null;
      officeName: string;
      address: string;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      visitPriority?: string | null;
    }>;
    idempotencyKey: string;
    sourceChannel?: string | null;
  }) => ({
    routeId: clean(input.routeId),
    stops: (Array.isArray(input.stops) ? input.stops : []).slice(0, 20).map((stop) => ({
      accountId: clean(stop.accountId) || null,
      prospectId: clean(stop.prospectId) || null,
      officeName: clean(stop.officeName),
      address: clean(stop.address),
      city: clean(stop.city) || null,
      latitude: Number.isFinite(stop.latitude) ? Number(stop.latitude) : null,
      longitude: Number.isFinite(stop.longitude) ? Number(stop.longitude) : null,
      visitPriority: clean(stop.visitPriority) || null,
    })),
    idempotencyKey: clean(input.idempotencyKey),
    sourceChannel: clean(input.sourceChannel) || "ui",
  }))
  .handler(async ({ data, context }) => {
    if (!data.stops.length) throw new Error("Choose at least one office to add");
    const db = context.supabase as any;
    const action = "hpo.route.add_stops";
    const run = await beginExecution({
      db,
      userId: context.userId,
      domain: "hpo_route",
      action,
      idempotencyKey: data.idempotencyKey,
      targetType: "hpo_route",
      targetId: data.routeId,
      requestPayload: { routeId: data.routeId, stops: data.stops, sourceChannel: data.sourceChannel },
    });
    if (run.reused && run.status === "completed" && run.resultPayload["routeAddStops"]) {
      return run.resultPayload["routeAddStops"];
    }
    try {
      const route = await loadRoute(db, context.userId, data.routeId);
      if (route.status === "completed") throw new Error("Completed routes cannot receive new stops");
      const existing = await loadStops(db, context.userId, data.routeId);
      const accountIds = new Set(existing.map((stop: any) => stop.account_id).filter(Boolean));
      const prospectIds = new Set(existing.map((stop: any) => stop.prospect_id).filter(Boolean));
      const eligible = data.stops.filter(
        (stop) =>
          (!stop.accountId || !accountIds.has(stop.accountId)) &&
          (!stop.prospectId || !prospectIds.has(stop.prospectId)),
      );
      if (!eligible.length) {
        const result = {
          ok: true,
          action,
          executionRunId: run.id,
          added: [],
          skippedDuplicates: data.stops.length,
          reused: run.reused,
        };
        await completeExecution({
          db,
          userId: context.userId,
          runId: run.id,
          resultPayload: { routeAddStops: result },
          targetType: "hpo_route",
          targetId: route.id,
        });
        return result;
      }
      const maxOrder = existing.reduce((max: number, stop: any) => Math.max(max, Number(stop.stop_order) || 0), 0);
      const { data: inserted, error } = await db
        .from("hpo_route_stops")
        .insert(
          eligible.map((stop, index) => ({
            user_id: context.userId,
            route_id: route.id,
            account_id: stop.accountId,
            prospect_id: stop.prospectId,
            stop_order: maxOrder + index + 1,
            visit_priority: stop.visitPriority,
            status: "planned",
            office_name: stop.officeName,
            address: stop.address,
            city: stop.city,
            latitude: stop.latitude,
            longitude: stop.longitude,
            metadata: {
              non_phi: true,
              source_channel: data.sourceChannel,
              execution_run_id: run.id,
              added_during_route: true,
            },
          })),
        )
        .select("*");
      if (error) throw error;
      const ids = (inserted ?? []).map((stop: any) => stop.id);
      const { data: verified, error: verifyError } = await db
        .from("hpo_route_stops")
        .select("*")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .eq("user_id", context.userId);
      if (verifyError || (verified ?? []).length !== ids.length) {
        throw verifyError ?? new Error("Added route stops could not be verified");
      }
      await clearRouteOptimization(db, context.userId, route.id);
      const result = {
        ok: true,
        action,
        executionRunId: run.id,
        added: verified ?? [],
        skippedDuplicates: data.stops.length - eligible.length,
        reused: run.reused,
      };
      await completeExecution({
        db,
        userId: context.userId,
        runId: run.id,
        resultPayload: { routeAddStops: result },
        targetType: "hpo_route",
        targetId: route.id,
      });
      return result;
    } catch (error) {
      await failExecution({
        db,
        userId: context.userId,
        runId: run.id,
        errorCode: "hpo_route_add_stops_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      }).catch(() => undefined);
      throw error;
    }
  });

export const removeHpoRouteStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string; stopId: string; idempotencyKey: string; sourceChannel?: string | null }) => ({
    routeId: clean(input.routeId),
    stopId: clean(input.stopId),
    idempotencyKey: clean(input.idempotencyKey),
    sourceChannel: clean(input.sourceChannel) || "ui",
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const action = "hpo.route.remove_stop";
    const run = await beginExecution({
      db,
      userId: context.userId,
      domain: "hpo_route",
      action,
      idempotencyKey: data.idempotencyKey,
      targetType: "hpo_route_stop",
      targetId: data.stopId,
      requestPayload: { routeId: data.routeId, stopId: data.stopId, sourceChannel: data.sourceChannel },
    });
    if (run.reused && run.status === "completed" && run.resultPayload["routeRemoveStop"]) {
      return run.resultPayload["routeRemoveStop"];
    }
    try {
      const stops = await loadStops(db, context.userId, data.routeId);
      const stop = stops.find((row: any) => row.id === data.stopId);
      if (!stop) throw new Error("Route stop not found");
      if (TERMINAL.has(String(stop.status))) {
        throw new Error("Completed/closed/skipped stops stay in route history and cannot be removed");
      }
      const { error } = await db
        .from("hpo_route_stops")
        .delete()
        .eq("id", stop.id)
        .eq("route_id", data.routeId)
        .eq("user_id", context.userId);
      if (error) throw error;
      const remaining = (await loadStops(db, context.userId, data.routeId)).sort(
        (a: any, b: any) => a.stop_order - b.stop_order,
      );
      for (let index = 0; index < remaining.length; index += 1) {
        const row = remaining[index]!;
        if (row.stop_order === index + 1) continue;
        const { error: orderError } = await db
          .from("hpo_route_stops")
          .update({ stop_order: index + 1, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("user_id", context.userId);
        if (orderError) throw orderError;
      }
      const { data: verify } = await db
        .from("hpo_route_stops")
        .select("id")
        .eq("id", stop.id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (verify) throw new Error("Route stop removal verification failed");
      await clearRouteOptimization(db, context.userId, data.routeId);
      const result = {
        ok: true,
        action,
        executionRunId: run.id,
        removedStopId: stop.id,
        remaining: remaining.length,
        reused: run.reused,
      };
      await completeExecution({
        db,
        userId: context.userId,
        runId: run.id,
        resultPayload: { routeRemoveStop: result },
        targetType: "hpo_route",
        targetId: data.routeId,
      });
      return result;
    } catch (error) {
      await failExecution({
        db,
        userId: context.userId,
        runId: run.id,
        errorCode: "hpo_route_remove_stop_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      }).catch(() => undefined);
      throw error;
    }
  });

export const reorderHpoRouteStopsCanonical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string; stopIds: string[]; idempotencyKey: string; sourceChannel?: string | null }) => ({
    routeId: clean(input.routeId),
    stopIds: (Array.isArray(input.stopIds) ? input.stopIds : []).map(clean).filter(Boolean).slice(0, 30),
    idempotencyKey: clean(input.idempotencyKey),
    sourceChannel: clean(input.sourceChannel) || "ui",
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const action = "hpo.route.reorder";
    const run = await beginExecution({
      db,
      userId: context.userId,
      domain: "hpo_route",
      action,
      idempotencyKey: data.idempotencyKey,
      targetType: "hpo_route",
      targetId: data.routeId,
      requestPayload: { routeId: data.routeId, stopIds: data.stopIds, sourceChannel: data.sourceChannel },
    });
    if (run.reused && run.status === "completed" && run.resultPayload["routeReorder"]) {
      return run.resultPayload["routeReorder"];
    }
    try {
      const current = await loadStops(db, context.userId, data.routeId);
      const currentIds = current.map((row: any) => row.id).sort();
      const requestedIds = [...data.stopIds].sort();
      if (
        currentIds.length !== requestedIds.length ||
        currentIds.some((id: string, index: number) => id !== requestedIds[index])
      ) {
        throw new Error("Manual reorder must include every current route stop exactly once");
      }
      for (let index = 0; index < data.stopIds.length; index += 1) {
        const { error } = await db
          .from("hpo_route_stops")
          .update({
            stop_order: index + 1,
            distance_meters_from_previous: null,
            drive_seconds_from_previous: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.stopIds[index])
          .eq("route_id", data.routeId)
          .eq("user_id", context.userId);
        if (error) throw error;
      }
      await clearRouteOptimization(db, context.userId, data.routeId);
      const verified = await loadStops(db, context.userId, data.routeId);
      const verifiedIds = verified.sort((a: any, b: any) => a.stop_order - b.stop_order).map((row: any) => row.id);
      if (verifiedIds.join("|") !== data.stopIds.join("|")) throw new Error("Route reorder verification failed");
      const result = {
        ok: true,
        action,
        executionRunId: run.id,
        stopIds: verifiedIds,
        reused: run.reused,
      };
      await completeExecution({
        db,
        userId: context.userId,
        runId: run.id,
        resultPayload: { routeReorder: result },
        targetType: "hpo_route",
        targetId: data.routeId,
      });
      return result;
    } catch (error) {
      await failExecution({
        db,
        userId: context.userId,
        runId: run.id,
        errorCode: "hpo_route_reorder_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      }).catch(() => undefined);
      throw error;
    }
  });

export const reoptimizeHpoRouteRemaining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    routeId: string;
    latitude?: number | null;
    longitude?: number | null;
    idempotencyKey: string;
    sourceChannel?: string | null;
  }) => ({
    routeId: clean(input.routeId),
    latitude: Number.isFinite(input.latitude) ? Number(input.latitude) : null,
    longitude: Number.isFinite(input.longitude) ? Number(input.longitude) : null,
    idempotencyKey: clean(input.idempotencyKey),
    sourceChannel: clean(input.sourceChannel) || "ui",
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const action = "hpo.route.reoptimize";
    const run = await beginExecution({
      db,
      userId: context.userId,
      domain: "hpo_route",
      action,
      idempotencyKey: data.idempotencyKey,
      targetType: "hpo_route",
      targetId: data.routeId,
      requestPayload: {
        routeId: data.routeId,
        latitude: data.latitude,
        longitude: data.longitude,
        sourceChannel: data.sourceChannel,
      },
    });
    if (run.reused && run.status === "completed" && run.resultPayload["routeReoptimize"]) {
      return run.resultPayload["routeReoptimize"];
    }
    try {
      const route = await loadRoute(db, context.userId, data.routeId);
      const stops = await loadStops(db, context.userId, data.routeId);
      const open = stops.filter((stop: any) => !TERMINAL.has(String(stop.status)));
      if (open.length <= 1) {
        const result = {
          ok: true,
          action,
          executionRunId: run.id,
          reordered: open.map((stop: any) => stop.id),
          remaining: open.length,
          driveMinutes: 0,
          distanceMiles: 0,
          reused: run.reused,
        };
        await completeExecution({
          db,
          userId: context.userId,
          runId: run.id,
          resultPayload: { routeReoptimize: result },
          targetType: "hpo_route",
          targetId: route.id,
        });
        return result;
      }
      for (const stop of open) {
        if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) {
          throw new Error(`${stop.office_name ?? "A remaining stop"} is missing map coordinates. Refresh pins or optimize the full route first.`);
        }
      }

      const completed = stops.filter((stop: any) => TERMINAL.has(String(stop.status)));
      const lastCompleted = [...completed]
        .filter((stop: any) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
        .sort((a: any, b: any) => Date.parse(b.visited_at ?? b.updated_at) - Date.parse(a.visited_at ?? a.updated_at))[0];

      const startPoint =
        data.latitude != null && data.longitude != null
          ? { lat: data.latitude, lon: data.longitude }
          : lastCompleted
            ? { lat: Number(lastCompleted.latitude), lon: Number(lastCompleted.longitude) }
            : Number.isFinite(route.start_latitude) && Number.isFinite(route.start_longitude)
              ? { lat: Number(route.start_latitude), lon: Number(route.start_longitude) }
              : null;
      const endPoint =
        Number.isFinite(route.end_latitude) && Number.isFinite(route.end_longitude)
          ? { lat: Number(route.end_latitude), lon: Number(route.end_longitude) }
          : null;

      const points: Array<{ lat: number; lon: number; kind: "start" | "stop" | "end"; stopId?: string }> = [];
      if (startPoint) points.push({ ...startPoint, kind: "start" });
      for (const stop of open) {
        points.push({
          lat: Number(stop.latitude),
          lon: Number(stop.longitude),
          kind: "stop",
          stopId: stop.id,
        });
      }
      if (endPoint) points.push({ ...endPoint, kind: "end" });

      const { durations, distances } = await roadMatrix(points);
      const startIndex = startPoint ? 0 : null;
      const stopOffset = startPoint ? 1 : 0;
      const openIndexes = open.map((_stop: any, index: number) => stopOffset + index);
      const endIndex = endPoint ? points.length - 1 : null;
      const optimizedIndexes = optimizeSequence(openIndexes, durations, startIndex, endIndex);
      const stopByNode = new Map<number, any>();
      open.forEach((stop: any, index: number) => stopByNode.set(stopOffset + index, stop));
      const orderedOpen = optimizedIndexes.map((index) => stopByNode.get(index)).filter(Boolean);
      const openSlots = open.map((stop: any) => Number(stop.stop_order)).sort((a: number, b: number) => a - b);

      let previousNode = startIndex;
      let totalDistance = 0;
      let totalDuration = 0;
      for (let index = 0; index < orderedOpen.length; index += 1) {
        const stop = orderedOpen[index]!;
        const node = optimizedIndexes[index]!;
        const distance = previousNode == null ? 0 : Number(distances[previousNode]?.[node] ?? 0);
        const duration = previousNode == null ? 0 : Number(durations[previousNode]?.[node] ?? 0);
        totalDistance += distance;
        totalDuration += duration;
        const { error } = await db
          .from("hpo_route_stops")
          .update({
            stop_order: openSlots[index],
            distance_meters_from_previous: Math.round(distance),
            drive_seconds_from_previous: Math.round(duration),
            updated_at: new Date().toISOString(),
          })
          .eq("id", stop.id)
          .eq("user_id", context.userId);
        if (error) throw error;
        previousNode = node;
      }
      if (previousNode != null && endIndex != null) {
        totalDistance += Number(distances[previousNode]?.[endIndex] ?? 0);
        totalDuration += Number(durations[previousNode]?.[endIndex] ?? 0);
      }

      const geometryPoints = [
        ...(startPoint ? [startPoint] : []),
        ...orderedOpen.map((stop: any) => ({ lat: Number(stop.latitude), lon: Number(stop.longitude) })),
        ...(endPoint ? [endPoint] : []),
      ];
      const geometry = await routeGeometry(geometryPoints);
      const reoptimizedAt = new Date().toISOString();
      const metadata =
        route.metadata && typeof route.metadata === "object" && !Array.isArray(route.metadata)
          ? route.metadata
          : {};
      const { error: routeUpdateError } = await db
        .from("hpo_route_plans")
        .update({
          status: "active",
          metadata: {
            ...metadata,
            route_geometry_remaining: geometry,
            reoptimized_at: reoptimizedAt,
            reoptimization_engine: "open_road_matrix",
          },
          updated_at: reoptimizedAt,
        })
        .eq("id", route.id)
        .eq("user_id", context.userId);
      if (routeUpdateError) throw routeUpdateError;

      const verified = await loadStops(db, context.userId, route.id);
      const verifiedOpen = verified.filter((stop: any) => !TERMINAL.has(String(stop.status)));
      const result = {
        ok: true,
        action,
        executionRunId: run.id,
        reordered: verifiedOpen.sort((a: any, b: any) => a.stop_order - b.stop_order).map((stop: any) => stop.id),
        remaining: verifiedOpen.length,
        driveMinutes: Math.round(totalDuration / 60),
        distanceMiles: Number((totalDistance / 1609.344).toFixed(1)),
        reoptimizedAt,
        reused: run.reused,
      };
      await completeExecution({
        db,
        userId: context.userId,
        runId: run.id,
        resultPayload: { routeReoptimize: result },
        targetType: "hpo_route",
        targetId: route.id,
      });
      return result;
    } catch (error) {
      await failExecution({
        db,
        userId: context.userId,
        runId: run.id,
        errorCode: "hpo_route_reoptimize_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      }).catch(() => undefined);
      throw error;
    }
  });

export const getHpoNearbyBackups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    routeId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    maxMinutes?: number;
  } = {}) => ({
    routeId: clean(input.routeId) || null,
    latitude: Number.isFinite(input.latitude) ? Number(input.latitude) : null,
    longitude: Number.isFinite(input.longitude) ? Number(input.longitude) : null,
    maxMinutes: Math.max(5, Math.min(30, Number(input.maxMinutes ?? 10) || 10)),
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    let route: any = null;
    let routeStops: any[] = [];
    if (data.routeId) {
      route = await loadRoute(db, context.userId, data.routeId);
      routeStops = await loadStops(db, context.userId, data.routeId);
    }

    let origin =
      data.latitude != null && data.longitude != null
        ? { lat: data.latitude, lon: data.longitude }
        : null;
    if (!origin && routeStops.length) {
      const lastVisited = [...routeStops]
        .filter((stop: any) => TERMINAL.has(String(stop.status)) && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
        .sort((a: any, b: any) => Date.parse(b.visited_at ?? b.updated_at) - Date.parse(a.visited_at ?? a.updated_at))[0];
      const next = routeStops.find(
        (stop: any) => !TERMINAL.has(String(stop.status)) && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude),
      );
      const row = lastVisited ?? next;
      if (row) origin = { lat: Number(row.latitude), lon: Number(row.longitude) };
    }
    if (!origin) throw new Error("Current location is needed to find nearby backup offices");

    const existingAccounts = new Set(routeStops.map((stop: any) => stop.account_id).filter(Boolean));
    const existingProspects = new Set(routeStops.map((stop: any) => stop.prospect_id).filter(Boolean));
    const [accountsResult, prospectsResult] = await Promise.all([
      db
        .from("hpo_accounts")
        .select("id,name,account_type,specialty,address,city,latitude,longitude,priority,owner_name,last_touch_at,next_action,next_action_due_at,tags,status")
        .eq("user_id", context.userId)
        .eq("status", "active")
        .not("latitude", "is", null)
        .not("longitude", "is", null),
      db
        .from("hpo_prospects")
        .select("id,name,prospect_type,specialty,address,city,latitude,longitude,fit_status,verification_status,metadata")
        .eq("user_id", context.userId)
        .neq("fit_status", "rejected")
        .not("latitude", "is", null)
        .not("longitude", "is", null),
    ]);
    if (accountsResult.error) throw accountsResult.error;
    if (prospectsResult.error) throw prospectsResult.error;

    const now = Date.now();
    const rough = [
      ...(accountsResult.data ?? [])
        .filter((row: any) => !existingAccounts.has(row.id))
        .filter((row: any) => !(Array.isArray(row.tags) && row.tags.includes("exclude_from_adam_route")))
        .map((row: any) => ({
          key: `account:${row.id}`,
          kind: "account" as const,
          accountId: row.id,
          prospectId: null,
          officeName: row.name,
          address: row.address,
          city: row.city,
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          priority: Number(row.priority ?? 3),
          lastTouchAt: row.last_touch_at,
          nextAction: row.next_action,
          nextActionDueAt: row.next_action_due_at,
          detail: [row.account_type, row.specialty].filter(Boolean).join(" · "),
          directMiles: haversineMiles(origin.lat, origin.lon, Number(row.latitude), Number(row.longitude)),
        })),
      ...(prospectsResult.data ?? [])
        .filter((row: any) => !existingProspects.has(row.id))
        .map((row: any) => ({
          key: `prospect:${row.id}`,
          kind: "prospect" as const,
          accountId: null,
          prospectId: row.id,
          officeName: row.name,
          address: row.address,
          city: row.city,
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          priority: Number(row.metadata?.internal_priority ?? 2),
          lastTouchAt: null,
          nextAction: null,
          nextActionDueAt: null,
          detail: [row.prospect_type, row.specialty, row.verification_status].filter(Boolean).join(" · "),
          directMiles: haversineMiles(origin.lat, origin.lon, Number(row.latitude), Number(row.longitude)),
          prospectFit: row.fit_status,
          verified: row.verification_status === "verified",
        })),
    ]
      .sort((a, b) => a.directMiles - b.directMiles)
      .slice(0, 18);

    if (!rough.length) return { origin, options: [], recommended: null };
    const { durations, distances } = await roadMatrix([
      origin,
      ...rough.map((row) => ({ lat: row.latitude, lon: row.longitude })),
    ]);

    const options = rough
      .map((row, index) => {
        const seconds = Number(durations[0]?.[index + 1] ?? Number.POSITIVE_INFINITY);
        const meters = Number(distances[0]?.[index + 1] ?? Number.POSITIVE_INFINITY);
        const driveMinutes = Math.round(seconds / 60);
        const overdue =
          row.nextActionDueAt && Date.parse(row.nextActionDueAt) < now ? 1 : 0;
        const daysSinceTouch = row.lastTouchAt
          ? Math.max(0, Math.floor((now - Date.parse(row.lastTouchAt)) / 86400000))
          : row.kind === "account"
            ? 120
            : 0;
        const score =
          row.priority * 12 +
          overdue * 35 +
          (row.kind === "account" ? 14 : 0) +
          Math.min(24, Math.floor(daysSinceTouch / 10) * 3) +
          (row.kind === "prospect" && (row as any).verified ? 6 : 0) +
          (row.kind === "prospect" && (row as any).prospectFit === "accepted" ? 8 : 0) -
          driveMinutes * 2;
        return {
          ...row,
          driveMinutes,
          distanceMiles: Number((meters / 1609.344).toFixed(1)),
          score,
          reasons: [
            overdue ? "follow-up overdue" : null,
            row.kind === "account" && daysSinceTouch >= 30 ? `${daysSinceTouch} days since touch` : null,
            row.priority >= 4 ? "high priority" : null,
            `${driveMinutes} min away`,
          ].filter(Boolean),
        };
      })
      .filter((row) => Number.isFinite(row.driveMinutes) && row.driveMinutes <= data.maxMinutes)
      .sort((a, b) => b.score - a.score || a.driveMinutes - b.driveMinutes)
      .slice(0, 5);

    return { origin, options, recommended: options[0] ?? null };
  });

export const completeHpoRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string; idempotencyKey: string; sourceChannel?: string | null }) => ({
    routeId: clean(input.routeId),
    idempotencyKey: clean(input.idempotencyKey),
    sourceChannel: clean(input.sourceChannel) || "ui",
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const stops = await loadStops(db, context.userId, data.routeId);
    const open = stops.filter((stop: any) => !TERMINAL.has(String(stop.status)));
    if (open.length) {
      return {
        ok: false,
        blocked: true,
        openStops: open.map((stop: any) => ({
          id: stop.id,
          stopOrder: stop.stop_order,
          officeName: stop.office_name,
          status: stop.status,
        })),
      };
    }

    const action = "hpo.route.complete";
    const run = await beginExecution({
      db,
      userId: context.userId,
      domain: "hpo_route",
      action,
      idempotencyKey: data.idempotencyKey,
      targetType: "hpo_route",
      targetId: data.routeId,
      requestPayload: { routeId: data.routeId, sourceChannel: data.sourceChannel },
    });
    if (run.reused && run.status === "completed" && run.resultPayload["routeComplete"]) {
      return run.resultPayload["routeComplete"];
    }
    try {
      const completedAt = new Date().toISOString();
      const route = await loadRoute(db, context.userId, data.routeId);
      const metadata =
        route.metadata && typeof route.metadata === "object" && !Array.isArray(route.metadata)
          ? route.metadata
          : {};
      const { data: updated, error } = await db
        .from("hpo_route_plans")
        .update({
          status: "completed",
          metadata: { ...metadata, completed_at: completedAt, completion_execution_run_id: run.id },
          updated_at: completedAt,
        })
        .eq("id", data.routeId)
        .eq("user_id", context.userId)
        .select("id,status,updated_at,metadata")
        .single();
      if (error || !updated || updated.status !== "completed") {
        throw error ?? new Error("Route completion verification failed");
      }
      const result = {
        ok: true,
        action,
        executionRunId: run.id,
        route: updated,
        reused: run.reused,
      };
      await completeExecution({
        db,
        userId: context.userId,
        runId: run.id,
        resultPayload: { routeComplete: result },
        targetType: "hpo_route",
        targetId: data.routeId,
      });
      return result;
    } catch (error) {
      await failExecution({
        db,
        userId: context.userId,
        runId: run.id,
        errorCode: "hpo_route_complete_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      }).catch(() => undefined);
      throw error;
    }
  });

export const getHpoAccountFieldContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string }) => ({ accountId: clean(input.accountId) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const [accountResult, contactsResult, interactionsResult, routeStopsResult] = await Promise.all([
      db.from("hpo_accounts").select("*").eq("id", data.accountId).eq("user_id", context.userId).single(),
      db
        .from("hpo_contacts")
        .select("*")
        .eq("account_id", data.accountId)
        .eq("user_id", context.userId)
        .order("is_primary", { ascending: false }),
      db
        .from("hpo_interactions")
        .select("*")
        .eq("account_id", data.accountId)
        .eq("user_id", context.userId)
        .order("occurred_at", { ascending: false })
        .limit(20),
      db
        .from("hpo_route_stops")
        .select("id,route_id,stop_order,status,visited_at,visit_summary,visit_outcome,next_action,next_action_due_at,updated_at")
        .eq("account_id", data.accountId)
        .eq("user_id", context.userId)
        .order("visited_at", { ascending: false, nullsFirst: false })
        .limit(20),
    ]);
    if (accountResult.error) throw accountResult.error;
    if (contactsResult.error) throw contactsResult.error;
    if (interactionsResult.error) throw interactionsResult.error;
    if (routeStopsResult.error) throw routeStopsResult.error;
    return {
      account: accountResult.data,
      contacts: contactsResult.data ?? [],
      interactions: interactionsResult.data ?? [],
      routeStops: routeStopsResult.data ?? [],
    };
  });
