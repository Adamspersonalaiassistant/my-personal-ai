/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MODEL_POLICY } from "@/lib/model-policy";

type RouteStopInput = {
  accountId?: string | null;
  prospectId?: string | null;
  officeName: string;
  address: string;
  city?: string | null;
  visitPriority?: string | null;
};

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function routeTitle(routeDate: string, area?: string | null) {
  const [year, month, day] = routeDate.split("-");
  return `${month}/${day}/${year}- (${area?.trim() || "HPO"}) Marketing Route`;
}

async function getTimezone(db: any, userId: string) {
  const { data } = await db
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.timezone || "America/New_York";
}

function localDateKey(value: string | null | undefined, timeZone: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map["year"]}-${map["month"]}-${map["day"]}`;
}

function localClock(value: string | null | undefined, timeZone: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function zonedDateTimeToUtc(dateString: string, timeString: string, timeZone: string) {
  const [yearRaw, monthRaw, dayRaw] = dateString.split("-");
  const [hourRaw, minuteRaw] = timeString.split(":");
  const year = Number(yearRaw ?? 1970);
  const month = Number(monthRaw ?? 1);
  const day = Number(dayRaw ?? 1);
  const hour = Number(hourRaw ?? 0);
  const minute = Number(minuteRaw ?? 0);
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(map["year"]),
      Number(map["month"]) - 1,
      Number(map["day"]),
      Number(map["hour"]),
      Number(map["minute"]),
      0,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item?.text ?? "")
    .join("")
    .trim();
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function miles(meters: number | null | undefined) {
  return meters == null ? null : meters / 1609.344;
}

function secondsToMinutes(seconds: number | null | undefined) {
  return seconds == null ? null : Math.round(seconds / 60);
}

function extractNextAction(note: string) {
  const sentences = note
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const action = [...sentences]
    .reverse()
    .find((part) => /\b(follow\s*up|text|call|email|reach out|set up|schedule|confirm|lunch|meeting|revisit|go back)\b/i.test(part));
  return action ? action.replace(/^((i|we)\s+(will|am going to|need to|plan to)\s+)/i, "").trim() : null;
}

function inferOutcome(note: string) {
  if (/\b(side of (a )?house|not an office|bad address|wrong address|invalid address)\b/i.test(note))
    return "Bad / unusable location";
  if (/\b(closed|office was closed|door was closed)\b/i.test(note)) return "Office closed";
  if (/\b(wasn['’]?t there|was not there|not present|out of office|in a deposition)\b/i.test(note))
    return "Contact not available";
  if (/\b(spoke with|talked to|met with)\b/i.test(note)) return "Spoke with office";
  if (/\b(left|gave|dropped off|passed)\b.*\b(info|information|materials|cards?)\b/i.test(note))
    return "Information delivered";
  return "Visit completed";
}

function inferStatus(note: string) {
  if (/\b(side of (a )?house|not an office|bad address|wrong address|invalid address)\b/i.test(note))
    return "bad_address";
  if (/\b(closed|office was closed|door was closed)\b/i.test(note)) return "closed";
  if (/\b(skip|skipped|couldn['’]?t go|didn['’]?t visit)\b/i.test(note)) return "skipped";
  return "completed";
}

async function geocode(address: string) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=1&q=" +
    encodeURIComponent(address);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "EmeryPersonalAI/1.0 personal-route-planner",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Could not geocode ${address}`);
  const rows = (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const first = rows[0];
  const lat = Number(first?.lat);
  const lon = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new Error(`Could not locate ${address}`);
  return { lat, lon, displayName: first?.display_name ?? address };
}

async function roadMatrix(points: Array<{ lat: number; lon: number }>) {
  const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${coordinates}?annotations=duration,distance`,
    { headers: { "User-Agent": "EmeryPersonalAI/1.0 personal-route-planner" } },
  );
  if (!response.ok) throw new Error("Road-time optimization is temporarily unavailable.");
  const payload = await response.json();
  if (!Array.isArray(payload?.durations) || !Array.isArray(payload?.distances))
    throw new Error("Road-time optimization returned incomplete data.");
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
  if (stopIndexes.length <= 2) return [...stopIndexes];

  const remaining = new Set(stopIndexes);
  const sequence: number[] = [];
  let current = startIndex;

  if (current == null) {
    const first = stopIndexes[0]!;
    sequence.push(first);
    remaining.delete(first);
    current = first;
  }

  while (remaining.size) {
    let best: number | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      const cost = current == null ? 0 : durations[current]?.[candidate] ?? Number.POSITIVE_INFINITY;
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
    if (best == null) {
      sequence.push(...remaining);
      break;
    }
    sequence.push(best);
    remaining.delete(best);
    current = best;
  }

  let improved = true;
  let passes = 0;
  while (improved && passes < 8) {
    improved = false;
    passes += 1;
    const base = routeCost(sequence, durations, startIndex, endIndex);
    for (let i = startIndex == null ? 1 : 0; i < sequence.length - 1; i += 1) {
      for (let j = i + 1; j < sequence.length; j += 1) {
        const candidate = [
          ...sequence.slice(0, i),
          ...sequence.slice(i, j + 1).reverse(),
          ...sequence.slice(j + 1),
        ];
        const next = routeCost(candidate, durations, startIndex, endIndex);
        if (next + 1 < base) {
          sequence.splice(0, sequence.length, ...candidate);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return sequence;
}

async function syncRouteStatus(db: any, userId: string, routeId: string) {
  const { data: stops } = await db
    .from("hpo_route_stops")
    .select("status")
    .eq("user_id", userId)
    .eq("route_id", routeId);
  const statuses = (stops ?? []).map((row: any) => row.status);
  const completed = statuses.length > 0 && statuses.every((status: string) => TERMINAL.has(status));
  const active = statuses.some((status: string) => TERMINAL.has(status));
  const status = completed ? "completed" : active ? "active" : "planned";
  await db
    .from("hpo_route_plans")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", routeId)
    .eq("user_id", userId);
  return status;
}

async function upsertInteractionForStop(
  db: any,
  userId: string,
  stop: any,
  patch: {
    notes?: string | null;
    visitOutcome?: string | null;
    nextAction?: string | null;
    nextActionDueAt?: string | null;
    status?: string | null;
  },
) {
  if (!stop.account_id || !patch.notes?.trim()) return;

  const currentMetadata =
    stop.metadata && typeof stop.metadata === "object" && !Array.isArray(stop.metadata)
      ? stop.metadata
      : {};
  const interactionId =
    typeof currentMetadata.route_interaction_id === "string"
      ? currentMetadata.route_interaction_id
      : null;

  const occurredAt = stop.visited_at ?? new Date().toISOString();
  const payload = {
    summary: patch.notes.trim(),
    outcome: patch.visitOutcome?.trim() || null,
    next_action: patch.nextAction?.trim() || null,
    next_action_due_at: patch.nextActionDueAt || null,
    occurred_at: occurredAt,
    interaction_type: "visit",
    source_type: "route",
    source_ref: stop.id,
    metadata: { route_id: stop.route_id, route_stop_id: stop.id, non_phi: true },
  };

  let id = interactionId;
  if (interactionId) {
    const { error } = await db
      .from("hpo_interactions")
      .update(payload)
      .eq("id", interactionId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { data, error } = await db
      .from("hpo_interactions")
      .insert({ user_id: userId, account_id: stop.account_id, ...payload })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
    await db
      .from("hpo_route_stops")
      .update({ metadata: { ...currentMetadata, route_interaction_id: id } })
      .eq("id", stop.id)
      .eq("user_id", userId);
  }

  const accountPatch: Record<string, unknown> = {
    last_touch_at: occurredAt,
    updated_at: new Date().toISOString(),
  };
  if (patch.nextAction?.trim()) accountPatch["next_action"] = patch.nextAction.trim();
  if (patch.nextActionDueAt) accountPatch["next_action_due_at"] = patch.nextActionDueAt;
  await db
    .from("hpo_accounts")
    .update(accountPatch)
    .eq("id", stop.account_id)
    .eq("user_id", userId);
}

export const getHpoRoutePlanner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    const today = new Date();
    const { data: profile } = await db
      .from("profiles")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();
    const timezone = profile?.timezone || "America/New_York";
    const localDate = (date: Date) => {
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
    };
    const past = localDate(new Date(today.getTime() - 75 * 24 * 60 * 60 * 1000));
    const future = localDate(new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000));

    const nowIso = new Date().toISOString();
    const horizonIso = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString();
    const [routesResult, accountsResult, prospectsResult, meetingsResult, tasksResult] = await Promise.all([
      db
        .from("hpo_route_plans")
        .select(
          "id,route_date,area,status,start_window,end_window,start_address,end_address,start_latitude,start_longitude,end_latitude,end_longitude,optimized_distance_meters,optimized_duration_seconds,optimized_at,notes,metadata,created_at,updated_at",
        )
        .eq("user_id", userId)
        .gte("route_date", past)
        .lte("route_date", future)
        .order("route_date", { ascending: false })
        .limit(90),
      db
        .from("hpo_accounts")
        .select("id,name,account_type,specialty,city,address,priority,relationship_stage,status")
        .eq("user_id", userId)
        .eq("status", "active")
        .not("address", "is", null)
        .order("priority", { ascending: false })
        .limit(300),
      db
        .from("hpo_prospects")
        .select("id,name,prospect_type,specialty,city,address,fit_status,verification_status")
        .eq("user_id", userId)
        .not("address", "is", null)
        .neq("fit_status", "rejected")
        .order("name", { ascending: true })
        .limit(300),
      db
        .from("meetings")
        .select("id,title,meeting_at,end_at,participants,metadata")
        .eq("user_id", userId)
        .gte("meeting_at", nowIso)
        .lte("meeting_at", horizonIso)
        .order("meeting_at", { ascending: true })
        .limit(150),
      db
        .from("tasks")
        .select("id,title,due_at,priority,status,metadata")
        .eq("user_id", userId)
        .neq("status", "completed")
        .not("due_at", "is", null)
        .gte("due_at", nowIso)
        .lte("due_at", horizonIso)
        .order("due_at", { ascending: true })
        .limit(150),
    ]);

    for (const result of [routesResult, accountsResult, prospectsResult, meetingsResult, tasksResult]) {
      if (result.error) throw result.error;
    }

    const routeIds = (routesResult.data ?? []).map((route: any) => route.id);
    let stops: any[] = [];
    if (routeIds.length) {
      const { data, error } = await db
        .from("hpo_route_stops")
        .select(
          "id,route_id,account_id,prospect_id,stop_order,visit_priority,status,planned_at,visited_at,office_name,address,city,latitude,longitude,distance_meters_from_previous,drive_seconds_from_previous,notes,visit_summary,visit_outcome,next_action,next_action_due_at,metadata,created_at,updated_at",
        )
        .eq("user_id", userId)
        .in("route_id", routeIds)
        .order("stop_order", { ascending: true });
      if (error) throw error;
      stops = data ?? [];
    }

    const byRoute = new Map<string, any[]>();
    for (const stop of stops) {
      const existing = byRoute.get(stop.route_id) ?? [];
      existing.push(stop);
      byRoute.set(stop.route_id, existing);
    }

    const calendar = [
      ...(meetingsResult.data ?? []).map((item: any) => ({
        kind: "event",
        id: item.id,
        title: item.title || "Untitled event",
        at: item.meeting_at,
        end_at: item.end_at,
        local_date: localDateKey(item.meeting_at, timezone),
        local_time: localClock(item.meeting_at, timezone),
        local_end_time: localClock(item.end_at, timezone),
        metadata: item.metadata,
      })),
      ...(tasksResult.data ?? []).map((item: any) => ({
        kind: "task",
        id: item.id,
        title: item.title,
        at: item.due_at,
        end_at: null,
        local_date: localDateKey(item.due_at, timezone),
        local_time: localClock(item.due_at, timezone),
        local_end_time: null,
        priority: item.priority,
        metadata: item.metadata,
      })),
    ].sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));

    return {
      routes: (routesResult.data ?? []).map((route: any) => ({
        ...route,
        stops: byRoute.get(route.id) ?? [],
        title: routeTitle(route.route_date, route.area),
      })),
      accounts: accountsResult.data ?? [],
      prospects: prospectsResult.data ?? [],
      calendar,
      timezone,
      today: localDate(today),
    };
  });

export const createHpoRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      routeDate: string;
      area?: string;
      startAddress?: string;
      endAddress?: string;
      startWindow?: string;
      endWindow?: string;
      syncToCalendar?: boolean;
      notes?: string;
      stops: RouteStopInput[];
    }) => {
      const routeDate = clean(input.routeDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) throw new Error("Route date is required");
      const stops = Array.isArray(input.stops) ? input.stops.slice(0, 30) : [];
      if (!stops.length) throw new Error("Add at least one office to the route");
      for (const stop of stops) {
        if (!clean(stop.officeName)) throw new Error("Every stop needs an office name");
        if (!clean(stop.address)) throw new Error(`${stop.officeName} is missing an address`);
      }
      return {
        routeDate,
        area: clean(input.area) || null,
        startAddress: clean(input.startAddress) || null,
        endAddress: clean(input.endAddress) || null,
        startWindow: clean(input.startWindow) || null,
        endWindow: clean(input.endWindow) || null,
        syncToCalendar: Boolean(input.syncToCalendar),
        notes: clean(input.notes) || null,
        stops: stops.map((stop) => ({
          accountId: clean(stop.accountId) || null,
          prospectId: clean(stop.prospectId) || null,
          officeName: clean(stop.officeName),
          address: clean(stop.address),
          city: clean(stop.city) || null,
          visitPriority: clean(stop.visitPriority) || null,
        })),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: route, error: routeError } = await db
      .from("hpo_route_plans")
      .insert({
        user_id: context.userId,
        route_date: data.routeDate,
        area: data.area,
        status: "planned",
        start_window: data.startWindow,
        end_window: data.endWindow,
        start_address: data.startAddress,
        end_address: data.endAddress,
        notes: data.notes,
        source_type: "emery_route_planner",
        metadata: {
          non_phi: true,
          planner: "emery_native_v1",
          route_title: routeTitle(data.routeDate, data.area),
        },
      })
      .select("id")
      .single();
    if (routeError) throw routeError;

    const { error: stopsError } = await db.from("hpo_route_stops").insert(
      data.stops.map((stop, index) => ({
        user_id: context.userId,
        route_id: route.id,
        account_id: stop.accountId,
        prospect_id: stop.prospectId,
        stop_order: index + 1,
        visit_priority: stop.visitPriority,
        status: "planned",
        office_name: stop.officeName,
        address: stop.address,
        city: stop.city,
        metadata: { non_phi: true, planner: "emery_native_v1" },
      })),
    );
    if (stopsError) {
      await db
        .from("hpo_route_plans")
        .delete()
        .eq("id", route.id)
        .eq("user_id", context.userId);
      throw stopsError;
    }

    let calendarAction: "created" | "skipped" = "skipped";
    if (data.syncToCalendar && data.startWindow && data.endWindow) {
      const timezone = await getTimezone(db, context.userId);
      const start = zonedDateTimeToUtc(data.routeDate, data.startWindow, timezone);
      const end = zonedDateTimeToUtc(data.routeDate, data.endWindow, timezone);
      if (Date.parse(end) > Date.parse(start)) {
        const { error: meetingError } = await db.from("meetings").insert({
          user_id: context.userId,
          title: `HPO Marketing Route — ${data.area || "Field Marketing"}`,
          meeting_at: start,
          end_at: end,
          participants: [],
          metadata: {
            domain: "hpo",
            hpo: true,
            event_type: "field_route",
            hpo_route_id: route.id,
            source_type: "route_planner",
          },
        });
        if (meetingError) throw meetingError;
        calendarAction = "created";
      }
    }
    return { routeId: route.id, calendarAction };
  });

export const optimizeHpoRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string }) => ({ routeId: clean(input.routeId) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    const { data: route, error: routeError } = await db
      .from("hpo_route_plans")
      .select("*")
      .eq("id", data.routeId)
      .eq("user_id", userId)
      .single();
    if (routeError || !route) throw routeError ?? new Error("Route not found");

    const { data: stopRows, error: stopError } = await db
      .from("hpo_route_stops")
      .select("*")
      .eq("route_id", route.id)
      .eq("user_id", userId)
      .order("stop_order", { ascending: true });
    if (stopError) throw stopError;
    const stops: any[] = stopRows ?? [];
    if (!stops.length) throw new Error("This route has no stops");

    const unresolved: any[] = [];
    for (const stop of stops) {
      if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) continue;
      if (!stop.address) throw new Error(`${stop.office_name ?? "A stop"} is missing an address`);
      unresolved.push(stop);
    }

    for (let index = 0; index < unresolved.length; index += 1) {
      const stop = unresolved[index]!;
      const point = await geocode([stop.address, stop.city, "NJ"].filter(Boolean).join(", "));
      stop.latitude = point.lat;
      stop.longitude = point.lon;
      const { error } = await db
        .from("hpo_route_stops")
        .update({ latitude: point.lat, longitude: point.lon, updated_at: new Date().toISOString() })
        .eq("id", stop.id)
        .eq("user_id", userId);
      if (error) throw error;
      if (index < unresolved.length - 1)
        await new Promise((resolve) => setTimeout(resolve, 1050));
    }

    let startPoint: { lat: number; lon: number } | null = null;
    let endPoint: { lat: number; lon: number } | null = null;
    if (route.start_address && unresolved.length) {
      await new Promise((resolve) => setTimeout(resolve, 1050));
    }
    if (route.start_address) {
      if (Number.isFinite(route.start_latitude) && Number.isFinite(route.start_longitude)) {
        startPoint = { lat: route.start_latitude, lon: route.start_longitude };
      } else {
        startPoint = await geocode(route.start_address);
      }
    }
    if (
      route.end_address &&
      !(route.start_address && route.end_address === route.start_address && startPoint)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1050));
    }
    if (route.end_address) {
      if (Number.isFinite(route.end_latitude) && Number.isFinite(route.end_longitude)) {
        endPoint = { lat: route.end_latitude, lon: route.end_longitude };
      } else {
        if (route.start_address && route.end_address === route.start_address && startPoint) {
          endPoint = startPoint;
        } else {
          endPoint = await geocode(route.end_address);
        }
      }
    }

    const points: Array<{ lat: number; lon: number; kind: "start" | "stop" | "end"; stopId?: string }> = [];
    if (startPoint) points.push({ ...startPoint, kind: "start" });
    for (const stop of stops)
      points.push({
        lat: Number(stop.latitude),
        lon: Number(stop.longitude),
        kind: "stop",
        stopId: stop.id,
      });
    if (endPoint) points.push({ ...endPoint, kind: "end" });

    if (points.length > 32) throw new Error("Keep optimized routes to 30 office stops or fewer.");

    const { durations, distances } = await roadMatrix(points);
    const startIndex = startPoint ? 0 : null;
    const stopOffset = startPoint ? 1 : 0;
    const stopIndexes = stops.map((_stop: any, index: number) => stopOffset + index);
    const endIndex = endPoint ? points.length - 1 : null;
    const optimized = optimizeSequence(stopIndexes, durations, startIndex, endIndex);
    const stopByNode = new Map<number, any>();
    stops.forEach((stop: any, index: number) => stopByNode.set(stopOffset + index, stop));

    let previousNode = startIndex;
    let totalDistance = 0;
    let totalDuration = 0;
    for (let index = 0; index < optimized.length; index += 1) {
      const nodeIndex = optimized[index]!;
      const stop = stopByNode.get(nodeIndex);
      if (!stop) continue;
      const segmentDistance =
        previousNode == null ? 0 : Number(distances[previousNode]?.[nodeIndex] ?? 0);
      const segmentDuration =
        previousNode == null ? 0 : Number(durations[previousNode]?.[nodeIndex] ?? 0);
      totalDistance += segmentDistance;
      totalDuration += segmentDuration;
      const { error } = await db
        .from("hpo_route_stops")
        .update({
          stop_order: index + 1,
          distance_meters_from_previous: Math.round(segmentDistance),
          drive_seconds_from_previous: Math.round(segmentDuration),
          updated_at: new Date().toISOString(),
        })
        .eq("id", stop.id)
        .eq("user_id", userId);
      if (error) throw error;
      previousNode = nodeIndex;
    }

    if (previousNode != null && endIndex != null) {
      totalDistance += Number(distances[previousNode]?.[endIndex] ?? 0);
      totalDuration += Number(durations[previousNode]?.[endIndex] ?? 0);
    }

    const optimizedAt = new Date().toISOString();
    const { error: updateError } = await db
      .from("hpo_route_plans")
      .update({
        status: route.status === "completed" ? "completed" : "planned",
        start_latitude: startPoint?.lat ?? null,
        start_longitude: startPoint?.lon ?? null,
        end_latitude: endPoint?.lat ?? null,
        end_longitude: endPoint?.lon ?? null,
        optimized_distance_meters: Math.round(totalDistance),
        optimized_duration_seconds: Math.round(totalDuration),
        optimized_at: optimizedAt,
        metadata: {
          ...(route.metadata ?? {}),
          planner: "emery_native_v1",
          optimization_engine: "open_road_matrix",
          mapquest_dependency: false,
        },
        updated_at: optimizedAt,
      })
      .eq("id", route.id)
      .eq("user_id", userId);
    if (updateError) throw updateError;

    return {
      routeId: route.id,
      stopCount: stops.length,
      distanceMiles: miles(totalDistance),
      driveMinutes: secondsToMinutes(totalDuration),
      optimizedAt,
    };
  });

export const reorderHpoRouteStops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string; stopIds: string[] }) => ({
    routeId: clean(input.routeId),
    stopIds: Array.isArray(input.stopIds) ? input.stopIds.map(clean).filter(Boolean).slice(0, 30) : [],
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
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
    await db
      .from("hpo_route_plans")
      .update({
        optimized_at: null,
        optimized_distance_meters: null,
        optimized_duration_seconds: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.routeId)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const updateHpoRouteStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      stopId: string;
      status?: string;
      notes?: string | null;
      visitOutcome?: string | null;
      nextAction?: string | null;
      nextActionDueAt?: string | null;
    }) => {
      const status = clean(input.status) || null;
      const allowed = new Set(["planned", "arrived", "completed", "visited", "skipped", "closed", "bad_address"]);
      if (status && !allowed.has(status)) throw new Error("Unsupported stop status");
      return {
        stopId: clean(input.stopId),
        status,
        notes: input.notes == null ? undefined : clean(input.notes),
        visitOutcome: input.visitOutcome == null ? undefined : clean(input.visitOutcome),
        nextAction: input.nextAction == null ? undefined : clean(input.nextAction),
        nextActionDueAt:
          input.nextActionDueAt && !Number.isNaN(Date.parse(input.nextActionDueAt))
            ? new Date(input.nextActionDueAt).toISOString()
            : input.nextActionDueAt === null
              ? null
              : undefined,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: stop, error: fetchError } = await db
      .from("hpo_route_stops")
      .select("*")
      .eq("id", data.stopId)
      .eq("user_id", context.userId)
      .single();
    if (fetchError || !stop) throw fetchError ?? new Error("Route stop not found");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status) {
      patch["status"] = data.status;
      if (TERMINAL.has(data.status) && !stop.visited_at) patch["visited_at"] = new Date().toISOString();
    }
    if (data.notes !== undefined) {
      patch["notes"] = data.notes || null;
      patch["visit_summary"] = data.notes || null;
    }
    if (data.visitOutcome !== undefined) patch["visit_outcome"] = data.visitOutcome || null;
    if (data.nextAction !== undefined) patch["next_action"] = data.nextAction || null;
    if (data.nextActionDueAt !== undefined) patch["next_action_due_at"] = data.nextActionDueAt;

    const { data: updated, error } = await db
      .from("hpo_route_stops")
      .update(patch)
      .eq("id", stop.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw error;

    await upsertInteractionForStop(db, context.userId, updated, {
      notes: data.notes ?? updated.notes,
      visitOutcome: data.visitOutcome ?? updated.visit_outcome,
      nextAction: data.nextAction ?? updated.next_action,
      nextActionDueAt: data.nextActionDueAt ?? updated.next_action_due_at,
      status: data.status ?? updated.status,
    });

    const routeStatus = await syncRouteStatus(db, context.userId, stop.route_id);
    return { stop: updated, routeStatus };
  });

export const captureHpoRouteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string; message: string }) => ({
    routeId: clean(input.routeId),
    message: clean(input.message),
  }))
  .handler(async ({ data, context }) => {
    if (!data.message) throw new Error("Tell Emery what happened at the stop");
    const db = context.supabase as any;
    const { data: stops, error } = await db
      .from("hpo_route_stops")
      .select("*")
      .eq("route_id", data.routeId)
      .eq("user_id", context.userId)
      .order("stop_order", { ascending: true });
    if (error) throw error;
    const rows = stops ?? [];
    if (!rows.length) throw new Error("This route has no stops");

    const numberMatch = data.message.match(/\bstop\s*#?\s*(\d{1,2})\b/i);
    const ordinalWords: Record<string, number> = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      fifth: 5,
      sixth: 6,
      seventh: 7,
      eighth: 8,
      ninth: 9,
      tenth: 10,
      eleventh: 11,
      twelfth: 12,
      thirteenth: 13,
      fourteenth: 14,
      fifteenth: 15,
      sixteenth: 16,
      seventeenth: 17,
      eighteenth: 18,
      nineteenth: 19,
      twentieth: 20,
    };
    const ordinalMatch = data.message.toLowerCase().match(
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\s+(?:stop|office)\b/,
    );
    const explicitOrder = numberMatch
      ? Number(numberMatch[1])
      : ordinalMatch
        ? ordinalWords[ordinalMatch[1] ?? ""]
        : null;
    let target =
      explicitOrder && explicitOrder > 0
        ? rows.find((row: any) => Number(row.stop_order) === explicitOrder)
        : null;

    if (!target && /\b(next stop|next office)\b/i.test(data.message)) {
      target = rows.find((row: any) => !TERMINAL.has(row.status)) ?? null;
    }

    if (!target) {
      const messageNorm = normalize(data.message);
      let best: { row: any; score: number } | null = null;
      for (const row of rows) {
        const office = normalize(row.office_name ?? "");
        if (!office) continue;
        if (messageNorm.includes(office)) {
          target = row;
          break;
        }
        const tokens = office.split(" ").filter((token) => token.length >= 4);
        const matched = tokens.filter((token) => messageNorm.includes(token)).length;
        const score = tokens.length ? matched / tokens.length : 0;
        if (!best || score > best.score) best = { row, score };
      }
      if (!target && best && best.score >= 0.5) target = best.row;
    }

    if (!target) {
      const active = rows.filter((row: any) => !TERMINAL.has(row.status));
      if (active.length === 1) target = active[0];
    }

    if (!target) {
      return {
        ok: false,
        needsClarification: true,
        question: "Which stop is this note for? You can say the stop number or office name.",
      } as const;
    }

    const status = inferStatus(data.message);
    const visitOutcome = inferOutcome(data.message);
    const nextAction = extractNextAction(data.message);

    const patch: Record<string, unknown> = {
      status,
      notes: data.message,
      visit_summary: data.message,
      visit_outcome: visitOutcome,
      next_action: nextAction,
      visited_at: target.visited_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateError } = await db
      .from("hpo_route_stops")
      .update(patch)
      .eq("id", target.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (updateError) throw updateError;

    await upsertInteractionForStop(db, context.userId, updated, {
      notes: data.message,
      visitOutcome,
      nextAction,
      nextActionDueAt: updated.next_action_due_at,
      status,
    });
    const routeStatus = await syncRouteStatus(db, context.userId, data.routeId);

    return {
      ok: true,
      needsClarification: false,
      stopId: updated.id,
      stopOrder: updated.stop_order,
      officeName: updated.office_name,
      status: updated.status,
      visitOutcome,
      nextAction,
      routeStatus,
    } as const;
  });


export const syncHpoRouteToCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string }) => ({ routeId: clean(input.routeId) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: route, error } = await db
      .from("hpo_route_plans")
      .select("id,route_date,area,start_window,end_window")
      .eq("id", data.routeId)
      .eq("user_id", context.userId)
      .single();
    if (error || !route) throw error ?? new Error("Route not found");
    if (!route.start_window || !route.end_window)
      throw new Error("Set a route start and end time first.");

    const timezone = await getTimezone(db, context.userId);
    const start = zonedDateTimeToUtc(route.route_date, route.start_window, timezone);
    const end = zonedDateTimeToUtc(route.route_date, route.end_window, timezone);
    if (Date.parse(end) <= Date.parse(start))
      throw new Error("Route end time must be after the start time.");

    const title = `HPO Marketing Route — ${route.area || "Field Marketing"}`;
    const metadata = {
      domain: "hpo",
      hpo: true,
      event_type: "field_route",
      hpo_route_id: route.id,
      source_type: "route_planner",
    };

    const { data: existing } = await db
      .from("meetings")
      .select("id")
      .eq("user_id", context.userId)
      .contains("metadata", { hpo_route_id: route.id })
      .maybeSingle();

    if (existing?.id) {
      const { error: updateError } = await db
        .from("meetings")
        .update({ title, meeting_at: start, end_at: end, metadata })
        .eq("id", existing.id)
        .eq("user_id", context.userId);
      if (updateError) throw updateError;
      return { id: existing.id, action: "updated" as const };
    }

    const { data: meeting, error: insertError } = await db
      .from("meetings")
      .insert({
        user_id: context.userId,
        title,
        meeting_at: start,
        end_at: end,
        participants: [],
        metadata,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    return { id: meeting.id, action: "created" as const };
  });

export const getHpoRouteScheduleAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string }) => ({ routeId: clean(input.routeId) }))
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("Emery AI is not configured.");
    const db = context.supabase as any;
    const timezone = await getTimezone(db, context.userId);

    const { data: route, error } = await db
      .from("hpo_route_plans")
      .select("*")
      .eq("id", data.routeId)
      .eq("user_id", context.userId)
      .single();
    if (error || !route) throw error ?? new Error("Route not found");

    const { data: stops } = await db
      .from("hpo_route_stops")
      .select("stop_order,office_name,address,city,status,visit_priority,drive_seconds_from_previous")
      .eq("route_id", route.id)
      .eq("user_id", context.userId)
      .order("stop_order", { ascending: true });

    const [{ data: meetings }, { data: tasks }] = await Promise.all([
      db
        .from("meetings")
        .select("title,meeting_at,end_at,metadata")
        .eq("user_id", context.userId)
        .order("meeting_at", { ascending: true })
        .limit(300),
      db
        .from("tasks")
        .select("title,due_at,priority,status,metadata")
        .eq("user_id", context.userId)
        .neq("status", "completed")
        .not("due_at", "is", null)
        .order("due_at", { ascending: true })
        .limit(300),
    ]);

    const calendar = [
      ...(meetings ?? [])
        .filter((item: any) => localDateKey(item.meeting_at, timezone) === route.route_date)
        .map((item: any) => ({
          kind: "event",
          title: item.title,
          start: localClock(item.meeting_at, timezone),
          end: localClock(item.end_at, timezone),
        })),
      ...(tasks ?? [])
        .filter((item: any) => localDateKey(item.due_at, timezone) === route.route_date)
        .map((item: any) => ({
          kind: "task",
          title: item.title,
          at: localClock(item.due_at, timezone),
          priority: item.priority,
        })),
    ];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_POLICY.primary,
        input: [
          {
            role: "system",
            content:
              "You are Emery helping Adam plan one Hudson Pro field-marketing day. Be concise and schedule-aware. Use only the supplied non-PHI route and Calendar facts. Never invent office hours, people, addresses, traffic, travel times, or appointments. Treat optimized driving time as an estimate. Assume roughly 15 minutes inside each office unless Adam later changes that. Identify any Calendar conflict, whether the planned block is realistic, and the single best adjustment. End with a simple recommended day sequence.",
          },
          {
            role: "user",
            content: JSON.stringify({
              timezone,
              route: {
                title: routeTitle(route.route_date, route.area),
                date: route.route_date,
                area: route.area,
                start_window: route.start_window,
                end_window: route.end_window,
                optimized_drive_minutes: route.optimized_duration_seconds
                  ? Math.round(route.optimized_duration_seconds / 60)
                  : null,
                stop_count: (stops ?? []).length,
              },
              stops: stops ?? [],
              calendar,
            }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("Emery could not review the route schedule right now.");
    return { advice: responseText(await response.json()) };
  });
