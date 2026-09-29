/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  executeHpoRouteCreateCore,
  executeHpoRouteOptimizeCore,
} from "@/lib/hpo-route.functions";

type SelectedTarget = {
  accountId?: string | null;
  prospectId?: string | null;
};

type BuildSelectionInput = {
  routeDate: string;
  area?: string | null;
  selected: SelectedTarget[];
  sessionId?: string | null;
};

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function validDate(value: unknown) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export const buildHpoRouteFromSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BuildSelectionInput) => {
    const routeDate = validDate(input?.routeDate);
    if (!routeDate) throw new Error("Choose a valid Planner date before building the route.");
    const rawSelected = Array.isArray(input?.selected) ? input.selected : [];
    if (rawSelected.length > 30) {
      throw new Error("Keep a single optimized HPO route to 30 office stops or fewer.");
    }
    const selected = rawSelected
      .map((item) => ({
        accountId: clean(item?.accountId) || null,
        prospectId: clean(item?.prospectId) || null,
      }))
      .filter((item) => item.accountId || item.prospectId);
    if (!selected.length) throw new Error("Select at least one office before building the route.");
    return {
      routeDate,
      area: clean(input?.area) || null,
      selected,
      sessionId: clean(input?.sessionId).slice(0, 120) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    const sourceChannel = data.sessionId
      ? `hpo_planner:${data.sessionId}`
      : "hpo_planner_selection";

    const { data: existing, error: existingError } = await db
      .from("hpo_route_plans")
      .select(
        "id,status,route_date,area,metadata,optimized_distance_meters,optimized_duration_seconds,optimized_at",
      )
      .eq("user_id", userId)
      .eq("route_date", data.routeDate)
      .in("status", ["planned", "active", "in_progress"])
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      if (String(existing.status) !== "planned") {
        throw new Error(
          "This day already has an active HPO route. Open it in Planner and edit or re-optimize the existing route instead of replacing it.",
        );
      }

      const existingSource =
        existing.metadata && typeof existing.metadata === "object"
          ? clean(existing.metadata.source_channel)
          : "";
      if (existingSource && existingSource === sourceChannel) {
        const { count } = await db
          .from("hpo_route_stops")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("route_id", existing.id);
        return {
          routeId: existing.id,
          routeDate: existing.route_date,
          area: existing.area,
          stopCount: count ?? 0,
          driveMinutes: existing.optimized_duration_seconds
            ? Math.round(Number(existing.optimized_duration_seconds) / 60)
            : null,
          distanceMiles: existing.optimized_distance_meters
            ? Number(existing.optimized_distance_meters) / 1609.344
            : null,
          optimizedAt: existing.optimized_at ?? null,
          replacedExisting: false,
          reused: true,
        };
      }

      const { data: existingStops, error: existingStopsError } = await db
        .from("hpo_route_stops")
        .select("id,status")
        .eq("user_id", userId)
        .eq("route_id", existing.id);
      if (existingStopsError) throw existingStopsError;
      if ((existingStops ?? []).some((stop: any) => TERMINAL.has(String(stop.status)))) {
        throw new Error(
          "This day already has a route with completed visit history. Open that route in Planner and edit the remaining stops instead of replacing it.",
        );
      }

      const { error: meetingCleanupError } = await db
        .from("meetings")
        .delete()
        .eq("user_id", userId)
        .contains("metadata", { hpo_route_id: existing.id });
      if (meetingCleanupError) throw meetingCleanupError;
      const { error: deleteError } = await db
        .from("hpo_route_plans")
        .delete()
        .eq("user_id", userId)
        .eq("id", existing.id);
      if (deleteError) throw deleteError;
    }

    const accountIds = unique(data.selected.map((item) => item.accountId ?? ""));
    const prospectIds = unique(data.selected.map((item) => item.prospectId ?? ""));

    let accounts: any[] = [];
    if (accountIds.length) {
      const { data: rows, error } = await db
        .from("hpo_accounts")
        .select(
          "id,name,address,city,latitude,longitude,priority,status,tags,owner_name,account_type,specialty",
        )
        .eq("user_id", userId)
        .eq("status", "active")
        .in("id", accountIds);
      if (error) throw error;
      accounts = rows ?? [];
    }

    let prospects: any[] = [];
    if (prospectIds.length) {
      const { data: rows, error } = await db
        .from("hpo_prospects")
        .select(
          "id,name,address,city,latitude,longitude,fit_status,verification_status,promoted_account_id,prospect_type,specialty,metadata",
        )
        .eq("user_id", userId)
        .in("id", prospectIds);
      if (error) throw error;
      prospects = (rows ?? []).filter(
        (row: any) => !["not_fit", "closed", "duplicate"].includes(String(row.fit_status)),
      );
    }

    const accountById = new Map(accounts.map((row: any) => [String(row.id), row]));
    const prospectById = new Map(prospects.map((row: any) => [String(row.id), row]));
    const stops: any[] = [];
    const seen = new Set<string>();

    for (const selected of data.selected) {
      if (selected.accountId && accountById.has(selected.accountId)) {
        const row = accountById.get(selected.accountId);
        const key = `account:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stops.push({
          accountId: row.id,
          prospectId: null,
          officeName: row.name,
          address: row.address,
          city: row.city ?? null,
          latitude: Number.isFinite(row.latitude) ? Number(row.latitude) : null,
          longitude: Number.isFinite(row.longitude) ? Number(row.longitude) : null,
          visitPriority: Number(row.priority ?? 0) >= 5 ? "high" : null,
        });
        continue;
      }

      if (selected.prospectId && prospectById.has(selected.prospectId)) {
        const row = prospectById.get(selected.prospectId);
        const key = `prospect:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stops.push({
          accountId: row.promoted_account_id ?? null,
          prospectId: row.id,
          officeName: row.name,
          address: row.address,
          city: row.city ?? null,
          latitude: Number.isFinite(row.latitude) ? Number(row.latitude) : null,
          longitude: Number.isFinite(row.longitude) ? Number(row.longitude) : null,
          visitPriority:
            Number(row.metadata?.internal_priority ?? 0) >= 4 ? "high" : null,
        });
      }
    }

    if (!stops.length) {
      throw new Error(
        "None of the selected offices are currently eligible HPO targets. Refresh the shortlist and choose again.",
      );
    }
    if (stops.length !== data.selected.length) {
      const missing = data.selected.length - stops.length;
      if (missing > 0) {
        throw new Error(
          `${missing} selected office${missing === 1 ? " is" : "s are"} no longer eligible. Refresh the shortlist before building so the saved route matches what you approved.`,
        );
      }
    }

    const idempotencyKey = data.sessionId
      ? `hpo-planner:${data.sessionId}:${data.routeDate}:build`
      : `hpo-planner:${data.routeDate}:${crypto.randomUUID()}`;

    const created = await executeHpoRouteCreateCore({
      db,
      userId,
      payload: {
        routeDate: data.routeDate,
        area: data.area,
        syncToCalendar: false,
        stops,
        idempotencyKey,
        sourceChannel,
      },
    });

    const optimized = await executeHpoRouteOptimizeCore({
      db,
      userId,
      routeId: created.routeId,
      idempotencyKey: `${idempotencyKey}:optimize`,
      sourceChannel,
    });

    return {
      routeId: created.routeId,
      routeDate: data.routeDate,
      area: data.area,
      stopCount: created.stopCount,
      driveMinutes: optimized.driveMinutes,
      distanceMiles: optimized.distanceMiles,
      optimizedAt: optimized.optimizedAt,
      replacedExisting: Boolean(existing),
      reused: false,
    };
  });
