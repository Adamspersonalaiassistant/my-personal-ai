/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MODEL_POLICY } from "@/lib/model-policy";
import { serializeError } from "@/lib/emery/error-serializer";
import {
  beginExecution,
  clarifyExecution,
  completeExecution,
  failExecution,
} from "@/lib/execution-ledger";
import { executeCanonicalTaskCreate } from "@/lib/execution-kernel";
import { geocodeHpoOfficeAddress } from "@/lib/hpo-geocode";

type RouteStopInput = {
  accountId?: string | null;
  prospectId?: string | null;
  officeName: string;
  address: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  visitPriority?: string | null;
};

const TERMINAL = new Set([
  "completed",
  "visited",
  "skipped",
  "closed",
  "bad_address",
]);

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

function zonedDateTimeToUtc(
  dateString: string,
  timeString: string,
  timeZone: string,
) {
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
    const map = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
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
  if (typeof payload?.output_text === "string")
    return payload.output_text.trim();
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
    .find((part) =>
      /\b(follow\s*up|text|call|email|reach out|set up|schedule|confirm|lunch|meeting|revisit|go back)\b/i.test(
        part,
      ),
    );
  return action
    ? action
        .replace(/^((i|we)\s+(will|am going to|need to|plan to)\s+)/i, "")
        .trim()
    : null;
}

function inferOutcome(note: string) {
  if (
    /\b(side of (a )?house|not an office|bad address|wrong address|invalid address)\b/i.test(
      note,
    )
  )
    return "Bad / unusable location";
  if (/\b(closed|office was closed|door was closed)\b/i.test(note))
    return "Office closed";
  if (
    /\b(wasn['’]?t there|was not there|not present|out of office|in a deposition)\b/i.test(
      note,
    )
  )
    return "Contact not available";
  if (/\b(spoke with|talked to|met with)\b/i.test(note))
    return "Spoke with office";
  if (
    /\b(left|gave|dropped off|passed)\b.*\b(info|information|materials|cards?)\b/i.test(
      note,
    )
  )
    return "Information delivered";
  return "Visit completed";
}

function inferStatus(note: string) {
  if (
    /\b(side of (a )?house|not an office|bad address|wrong address|invalid address)\b/i.test(
      note,
    )
  )
    return "bad_address";
  if (/\b(closed|office was closed|door was closed)\b/i.test(note))
    return "closed";
  if (/\b(skip|skipped|couldn['’]?t go|didn['’]?t visit)\b/i.test(note))
    return "skipped";
  return "completed";
}

function followupDueFromNote(note: string, timeZone: string) {
  const lower = note.toLowerCase();
  if (
    !/\b(follow\s*up|call|email|text|reach out|revisit|go back|confirm)\b/i.test(
      lower,
    )
  )
    return null;

  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const base = new Date(
    Number(values["year"]),
    Number(values["month"]) - 1,
    Number(values["day"]),
    12,
    0,
    0,
  );

  let daysToAdd: number | null = null;
  if (/\btomorrow\b/.test(lower)) daysToAdd = 1;
  else if (/\bnext week\b/.test(lower)) daysToAdd = 7;
  else {
    const weekdays: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const match = lower.match(
      /\b(?:next\s+|this\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
    );
    if (match?.[1]) {
      const target = weekdays[match[1]];
      if (target == null) return null;
      const current = base.getDay();
      let delta = (target - current + 7) % 7;
      if (delta === 0 || lower.includes(`next ${match[1]}`)) delta = delta || 7;
      daysToAdd = delta;
    }
  }
  if (daysToAdd == null) return null;

  const due = new Date(base);
  due.setDate(due.getDate() + daysToAdd);
  const year = String(due.getFullYear());
  const month = String(due.getMonth() + 1).padStart(2, "0");
  const day = String(due.getDate()).padStart(2, "0");
  return zonedDateTimeToUtc(`${year}-${month}-${day}`, "12:00", timeZone);
}

export async function geocodeHpoAddress(address: string) {
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
  const rows = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  const first = rows[0];
  const lat = Number(first?.lat);
  const lon = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new Error(`Could not locate ${address}`);
  return { lat, lon, displayName: first?.display_name ?? address };
}

async function roadMatrix(points: Array<{ lat: number; lon: number }>) {
  const coordinates = points
    .map((point) => `${point.lon},${point.lat}`)
    .join(";");
  const response = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${coordinates}?annotations=duration,distance`,
    { headers: { "User-Agent": "EmeryPersonalAI/1.0 personal-route-planner" } },
  );
  if (!response.ok)
    throw new Error("Road-time optimization is temporarily unavailable.");
  const payload = await response.json();
  if (!Array.isArray(payload?.durations) || !Array.isArray(payload?.distances))
    throw new Error("Road-time optimization returned incomplete data.");
  return {
    durations: payload.durations as Array<Array<number | null>>,
    distances: payload.distances as Array<Array<number | null>>,
  };
}

async function roadRouteGeometry(points: Array<{ lat: number; lon: number }>) {
  if (points.length < 2) return null;
  const coordinates = points
    .map((point) => `${point.lon},${point.lat}`)
    .join(";");
  try {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      {
        headers: { "User-Agent": "EmeryPersonalAI/1.0 personal-route-planner" },
      },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const rawCoordinates = payload?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2)
      return null;
    const maxPoints = 260;
    const stride = Math.max(1, Math.ceil(rawCoordinates.length / maxPoints));
    return rawCoordinates
      .filter(
        (_point: unknown, index: number) =>
          index % stride === 0 || index === rawCoordinates.length - 1,
      )
      .map((point: unknown) => {
        const pair = Array.isArray(point) ? point : [];
        return [Number(pair[0]), Number(pair[1])] as [number, number];
      })
      .filter(
        (point: [number, number]) =>
          Number.isFinite(point[0]) && Number.isFinite(point[1]),
      );
  } catch {
    return null;
  }
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
  if (previous != null && endIndex != null)
    total += durations[previous]?.[endIndex] ?? 1e12;
  return total;
}

function optimizeSequenceExact(
  stopIndexes: number[],
  durations: Array<Array<number | null>>,
  startIndex: number | null,
  endIndex: number | null,
) {
  const count = stopIndexes.length;
  if (count <= 1) return [...stopIndexes];
  // Exact Held-Karp shortest Hamiltonian path for ordinary daily route sizes.
  // 14 stops = 229,376 states, which is small enough server-side and avoids
  // local-minimum route orders while still falling back to the heuristic for
  // larger field days.
  if (count > 14) return null;

  const maskCount = 1 << count;
  const stateCount = maskCount * count;
  const dp = new Float64Array(stateCount);
  dp.fill(Number.POSITIVE_INFINITY);
  const parent = new Int16Array(stateCount);
  parent.fill(-1);

  for (let local = 0; local < count; local += 1) {
    const node = stopIndexes[local]!;
    const cost =
      startIndex == null
        ? 0
        : Number(durations[startIndex]?.[node] ?? Number.POSITIVE_INFINITY);
    if (Number.isFinite(cost)) {
      dp[(1 << local) * count + local] = cost;
    }
  }

  for (let mask = 1; mask < maskCount; mask += 1) {
    for (let last = 0; last < count; last += 1) {
      if ((mask & (1 << last)) === 0) continue;
      const stateIndex = mask * count + last;
      const base = dp[stateIndex]!;
      if (!Number.isFinite(base)) continue;
      const fromNode = stopIndexes[last]!;
      for (let next = 0; next < count; next += 1) {
        if (mask & (1 << next)) continue;
        const toNode = stopIndexes[next]!;
        const edge = Number(
          durations[fromNode]?.[toNode] ?? Number.POSITIVE_INFINITY,
        );
        if (!Number.isFinite(edge)) continue;
        const nextMask = mask | (1 << next);
        const nextState = nextMask * count + next;
        const candidate = base + edge;
        if (candidate < dp[nextState]!) {
          dp[nextState] = candidate;
          parent[nextState] = last;
        }
      }
    }
  }

  const fullMask = maskCount - 1;
  let bestLast = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let last = 0; last < count; last += 1) {
    const base = dp[fullMask * count + last]!;
    if (!Number.isFinite(base)) continue;
    const node = stopIndexes[last]!;
    const finish =
      endIndex == null
        ? 0
        : Number(durations[node]?.[endIndex] ?? Number.POSITIVE_INFINITY);
    const total = base + finish;
    if (Number.isFinite(total) && total < bestCost) {
      bestCost = total;
      bestLast = last;
    }
  }
  if (bestLast < 0) return null;

  const reversed: number[] = [];
  let mask = fullMask;
  let last = bestLast;
  while (last >= 0) {
    reversed.push(stopIndexes[last]!);
    const stateIndex = mask * count + last;
    const previous = parent[stateIndex]!;
    mask ^= 1 << last;
    last = previous;
  }
  reversed.reverse();
  return reversed.length === count ? reversed : null;
}

function optimizeSequence(
  stopIndexes: number[],
  durations: Array<Array<number | null>>,
  startIndex: number | null,
  endIndex: number | null,
) {
  if (stopIndexes.length <= 1) return [...stopIndexes];

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
      const cost =
        current == null
          ? 0
          : (durations[current]?.[candidate] ?? Number.POSITIVE_INFINITY);
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
  const completed =
    statuses.length > 0 &&
    statuses.every((status: string) => TERMINAL.has(status));
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
    executionRunId?: string | null;
    sourceChannel?: string | null;
    traceId?: string | null;
  },
) {
  if (!stop.account_id || !patch.notes?.trim()) return;

  const currentMetadata =
    stop.metadata &&
    typeof stop.metadata === "object" &&
    !Array.isArray(stop.metadata)
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
    metadata: {
      route_id: stop.route_id,
      route_stop_id: stop.id,
      execution_run_id: patch.executionRunId ?? null,
      source_channel: patch.sourceChannel ?? null,
      trace_id: patch.traceId ?? null,
      non_phi: true,
    },
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
  if (patch.nextAction?.trim())
    accountPatch["next_action"] = patch.nextAction.trim();
  if (patch.nextActionDueAt)
    accountPatch["next_action_due_at"] = patch.nextActionDueAt;
  await db
    .from("hpo_accounts")
    .update(accountPatch)
    .eq("id", stop.account_id)
    .eq("user_id", userId);
}

export const getHpoRouteNextStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId?: string | null } = {}) => ({
    routeId: clean(input?.routeId) || null,
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    const timezone = await getTimezone(db, userId);
    const today = localDateKey(new Date().toISOString(), timezone);

    let route: any = null;
    if (data.routeId) {
      const { data: selected, error } = await db
        .from("hpo_route_plans")
        .select("*")
        .eq("id", data.routeId)
        .eq("user_id", userId)
        .single();
      if (error || !selected) throw error ?? new Error("Route not found");
      route = selected;
    } else {
      const { data: routes, error } = await db
        .from("hpo_route_plans")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["draft", "planned", "active", "in_progress"])
        .gte("route_date", today)
        .order("route_date", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      const rows = routes ?? [];
      route =
        rows.find(
          (row: any) =>
            row.route_date === today &&
            ["active", "in_progress"].includes(row.status),
        ) ??
        rows.find((row: any) => row.route_date === today) ??
        rows.find((row: any) =>
          ["active", "in_progress"].includes(row.status),
        ) ??
        null;
    }

    if (!route) {
      return {
        route: null,
        nextStop: null,
        completed: 0,
        total: 0,
        remaining: 0,
        accountContext: null,
      };
    }

    const { data: stops, error: stopsError } = await db
      .from("hpo_route_stops")
      .select("*")
      .eq("user_id", userId)
      .eq("route_id", route.id)
      .order("stop_order", { ascending: true });
    if (stopsError) throw stopsError;
    const rows = stops ?? [];
    const completed = rows.filter((stop: any) =>
      TERMINAL.has(String(stop.status)),
    ).length;
    const nextStop =
      rows.find((stop: any) => !TERMINAL.has(String(stop.status))) ?? null;

    let accountContext: any = null;
    if (nextStop?.account_id) {
      const [{ data: account }, { data: interaction }] = await Promise.all([
        db
          .from("hpo_accounts")
          .select(
            "id,name,account_type,specialty,address,city,priority,owner_name,relationship_stage,relationship_health,last_touch_at,next_action,next_action_due_at,notes",
          )
          .eq("id", nextStop.account_id)
          .eq("user_id", userId)
          .maybeSingle(),
        db
          .from("hpo_interactions")
          .select(
            "id,occurred_at,summary,outcome,next_action,next_action_due_at",
          )
          .eq("account_id", nextStop.account_id)
          .eq("user_id", userId)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      accountContext = account
        ? { ...account, latestInteraction: interaction ?? null }
        : null;
    }

    return {
      route,
      nextStop,
      completed,
      total: rows.length,
      remaining: Math.max(0, rows.length - completed),
      accountContext,
    };
  });

export const prepareHpoOfficeMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) => ({
    limit: Math.max(1, Math.min(500, Number(input?.limit ?? 500) || 500)),
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const userId = context.userId;

    const [
      { data: accounts, error: accountError },
      { data: prospects, error: prospectError },
    ] = await Promise.all([
      db
        .from("hpo_accounts")
        .select("id,name,address,city,latitude,longitude,geocoded_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .not("address", "is", null)
        .or("latitude.is.null,longitude.is.null")
        .limit(data.limit),
      db
        .from("hpo_prospects")
        .select("id,name,address,city,latitude,longitude,geocoded_at")
        .eq("user_id", userId)
        .in("fit_status", ["undecided", "qualified"])
        .not("address", "is", null)
        .or("latitude.is.null,longitude.is.null")
        .limit(data.limit),
    ]);
    if (accountError) throw accountError;
    if (prospectError) throw prospectError;

    const work = [
      ...(accounts ?? []).map((row: any) => ({
        ...row,
        kind: "account" as const,
      })),
      ...(prospects ?? []).map((row: any) => ({
        ...row,
        kind: "prospect" as const,
      })),
    ].slice(0, data.limit);

    let mapped = 0;
    let attempted = 0;
    const chunkSize = 8;
    for (let start = 0; start < work.length; start += chunkSize) {
      const chunk = work.slice(start, start + chunkSize);
      const results = await Promise.all(
        chunk.map(async (row: any) => {
          attempted += 1;
          try {
            const point = await geocodeHpoOfficeAddress(
              String(row.address ?? ""),
              row.city,
            );
            const table =
              row.kind === "account" ? "hpo_accounts" : "hpo_prospects";
            const patch: Record<string, unknown> = {
              geocoded_at: new Date().toISOString(),
            };
            if (point) {
              patch["latitude"] = point.lat;
              patch["longitude"] = point.lon;
            }
            const { error } = await db
              .from(table)
              .update(patch)
              .eq("id", row.id)
              .eq("user_id", userId);
            if (error) throw error;
            if (point) mapped += 1;
            return point;
          } catch {
            return null;
          }
        }),
      );
      void results;
      if (start + chunkSize < work.length)
        await new Promise((resolve) => setTimeout(resolve, 180));
    }

    const [{ count: remainingAccounts }, { count: remainingProspects }] =
      await Promise.all([
        db
          .from("hpo_accounts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "active")
          .not("address", "is", null)
          .is("latitude", null),
        db
          .from("hpo_prospects")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("fit_status", ["undecided", "qualified"])
          .not("address", "is", null)
          .is("latitude", null),
      ]);

    return {
      mapped,
      attempted,
      remaining:
        Number(remainingAccounts ?? 0) + Number(remainingProspects ?? 0),
    };
  });

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
    const past = localDate(
      new Date(today.getTime() - 75 * 24 * 60 * 60 * 1000),
    );
    const future = localDate(
      new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000),
    );

    const nowIso = new Date().toISOString();
    const horizonIso = new Date(
      today.getTime() + 45 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [
      routesResult,
      accountsResult,
      prospectsResult,
      meetingsResult,
      tasksResult,
      configResult,
    ] = await Promise.all([
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
        .select(
          "id,name,account_type,specialty,city,address,latitude,longitude,geocoded_at,priority,relationship_stage,relationship_health,status,owner_name,last_touch_at,next_action,next_action_due_at,tags,source_origin",
        )
        .eq("user_id", userId)
        .eq("status", "active")
        .not("address", "is", null)
        .order("priority", { ascending: false })
        .limit(1000),
      db
        .from("hpo_prospects")
        .select(
          "id,name,prospect_type,specialty,city,address,latitude,longitude,geocoded_at,fit_status,verification_status,promoted_account_id,metadata",
        )
        .eq("user_id", userId)
        .not("address", "is", null)
        .in("fit_status", ["undecided", "qualified"])
        .order("name", { ascending: true })
        .limit(1000),
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
        .select(
          "id,title,due_at,scheduled_start_at,scheduled_end_at,priority,status,metadata",
        )
        .eq("user_id", userId)
        .neq("status", "completed")
        .not("scheduled_start_at", "is", null)
        .gte("scheduled_start_at", nowIso)
        .lte("scheduled_start_at", horizonIso)
        .order("scheduled_start_at", { ascending: true })
        .limit(150),
      db
        .from("emery_config")
        .select("hpo_map_v2")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    for (const result of [
      routesResult,
      accountsResult,
      prospectsResult,
      meetingsResult,
      tasksResult,
      configResult,
    ]) {
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
        at: item.scheduled_start_at,
        end_at: item.scheduled_end_at,
        local_date: localDateKey(item.scheduled_start_at, timezone),
        local_time: localClock(item.scheduled_start_at, timezone),
        local_end_time: localClock(item.scheduled_end_at, timezone),
        priority: item.priority,
        metadata: item.metadata,
      })),
    ].sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));

    const routeAccounts = (accountsResult.data ?? []).filter((account: any) => {
      const tags = Array.isArray(account.tags) ? account.tags : [];
      if (tags.includes("exclude_from_adam_route")) return false;
      const owner = clean(account.owner_name).toLowerCase();
      return !owner || owner === "adam";
    });
    const routeProspects = (prospectsResult.data ?? []).filter(
      (prospect: any) => {
        const metadata =
          prospect.metadata &&
          typeof prospect.metadata === "object" &&
          !Array.isArray(prospect.metadata)
            ? prospect.metadata
            : {};
        if (metadata["exclude_from_adam_route"] === true) return false;
        if (!prospect.promoted_account_id) return true;
        return metadata["map_as_location"] === true;
      },
    );

    return {
      routes: (routesResult.data ?? []).map((route: any) => ({
        ...route,
        stops: byRoute.get(route.id) ?? [],
        title: routeTitle(route.route_date, route.area),
      })),
      accounts: routeAccounts,
      prospects: routeProspects,
      calendar,
      timezone,
      today: localDate(today),
      featureFlags: {
        hpoMapV2: Boolean(configResult.data?.hpo_map_v2),
      },
    };
  });

export type HpoRouteCreateInput = {
  routeDate: string;
  area?: string | null;
  startAddress?: string | null;
  endAddress?: string | null;
  startWindow?: string | null;
  endWindow?: string | null;
  syncToCalendar?: boolean;
  notes?: string | null;
  stops: RouteStopInput[];
  idempotencyKey: string;
  sourceChannel: string;
  sourceMessageId?: string | null;
};

export async function executeHpoRouteCreateCore(input: {
  db: any;
  userId: string;
  payload: HpoRouteCreateInput;
}) {
  const data = input.payload;
  const action = "hpo.route.create";
  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action,
    sourceMessageId: data.sourceMessageId ?? null,
    idempotencyKey: data.idempotencyKey,
    targetType: "hpo_route",
    requestPayload: {
      capability: action,
      routeDate: data.routeDate,
      area: data.area ?? null,
      startAddress: data.startAddress ?? null,
      endAddress: data.endAddress ?? null,
      startWindow: data.startWindow ?? null,
      endWindow: data.endWindow ?? null,
      stopCount: data.stops.length,
      sourceChannel: data.sourceChannel,
    },
  });
  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeCreateResult"]
  ) {
    return execution.resultPayload["routeCreateResult"] as {
      ok: true;
      action: string;
      executionRunId: string;
      routeId: string;
      stopCount: number;
      calendarAction: "created" | "skipped";
      reused: boolean;
    };
  }

  try {
    const existingRouteQuery = await input.db
      .from("hpo_route_plans")
      .select("id")
      .eq("user_id", input.userId)
      .eq("route_date", data.routeDate)
      .in("status", ["planned", "active", "in_progress"])
      .limit(1)
      .maybeSingle();
    if (existingRouteQuery.error) throw existingRouteQuery.error;
    if (existingRouteQuery.data) {
      throw new Error("An open HPO route already exists for this date.");
    }

    const { data: route, error: routeError } = await input.db
      .from("hpo_route_plans")
      .insert({
        user_id: input.userId,
        route_date: data.routeDate,
        area: data.area ?? null,
        status: "planned",
        start_window: data.startWindow ?? null,
        end_window: data.endWindow ?? null,
        start_address: data.startAddress ?? null,
        end_address: data.endAddress ?? null,
        notes: data.notes ?? null,
        source_type: "emery_route_planner",
        metadata: {
          non_phi: true,
          planner: "emery_native_v2",
          route_title: routeTitle(data.routeDate, data.area ?? null),
          execution_run_id: execution.id,
          source_channel: data.sourceChannel,
        },
      })
      .select("id")
      .single();
    if (routeError || !route)
      throw routeError ?? new Error("Route creation returned no record");

    const { data: insertedStops, error: stopsError } = await input.db
      .from("hpo_route_stops")
      .insert(
        data.stops.map((stop, index) => ({
          user_id: input.userId,
          route_id: route.id,
          account_id: clean(stop.accountId) || null,
          prospect_id: clean(stop.prospectId) || null,
          stop_order: index + 1,
          visit_priority: clean(stop.visitPriority) || null,
          status: "planned",
          office_name: clean(stop.officeName),
          address: clean(stop.address),
          city: clean(stop.city) || null,
          latitude:
            typeof stop.latitude === "number" && Number.isFinite(stop.latitude)
              ? stop.latitude
              : null,
          longitude:
            typeof stop.longitude === "number" &&
            Number.isFinite(stop.longitude)
              ? stop.longitude
              : null,
          metadata: {
            non_phi: true,
            planner: "emery_native_v2",
            execution_run_id: execution.id,
            source_channel: data.sourceChannel,
          },
        })),
      )
      .select("id");
    if (stopsError) {
      await input.db
        .from("hpo_route_plans")
        .delete()
        .eq("id", route.id)
        .eq("user_id", input.userId);
      throw stopsError;
    }

    const { data: verifiedRoute, error: verifyRouteError } = await input.db
      .from("hpo_route_plans")
      .select("id,status,route_date,area")
      .eq("id", route.id)
      .eq("user_id", input.userId)
      .single();
    if (verifyRouteError || !verifiedRoute) {
      throw verifyRouteError ?? new Error("Route verification failed");
    }
    const { data: verifiedStops, error: verifyStopsError } = await input.db
      .from("hpo_route_stops")
      .select("id")
      .eq("route_id", route.id)
      .eq("user_id", input.userId);
    if (
      verifyStopsError ||
      (verifiedStops ?? []).length !== data.stops.length
    ) {
      throw verifyStopsError ?? new Error("Route-stop verification failed");
    }

    let calendarAction: "created" | "skipped" = "skipped";
    if (data.syncToCalendar && data.startWindow && data.endWindow) {
      const timezone = await getTimezone(input.db, input.userId);
      const start = zonedDateTimeToUtc(
        data.routeDate,
        data.startWindow,
        timezone,
      );
      const end = zonedDateTimeToUtc(data.routeDate, data.endWindow, timezone);
      if (Date.parse(end) > Date.parse(start)) {
        const { error: meetingError } = await input.db.from("meetings").insert({
          user_id: input.userId,
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
            execution_run_id: execution.id,
          },
        });
        if (meetingError) throw meetingError;
        calendarAction = "created";
      }
    }

    const result = {
      ok: true as const,
      action,
      executionRunId: execution.id,
      routeId: route.id,
      stopCount: (insertedStops ?? []).length,
      calendarAction,
      reused: execution.reused,
    };
    await completeExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      resultPayload: {
        routeCreateResult: result as unknown as Record<string, unknown>,
      },
      targetType: "hpo_route",
      targetId: route.id,
    });
    return result;
  } catch (error) {
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      errorCode: "hpo_route_create_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
    }).catch(() => undefined);
    throw error;
  }
}

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
      idempotencyKey?: string | null;
      sourceChannel?: string | null;
    }) => {
      const routeDate = clean(input.routeDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate))
        throw new Error("Route date is required");
      const stops = Array.isArray(input.stops) ? input.stops.slice(0, 30) : [];
      if (!stops.length)
        throw new Error("Add at least one office to the route");
      for (const stop of stops) {
        if (!clean(stop.officeName))
          throw new Error("Every stop needs an office name");
        if (!clean(stop.address))
          throw new Error(`${stop.officeName} is missing an address`);
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
        stops,
        idempotencyKey: clean(input.idempotencyKey) || null,
        sourceChannel: clean(input.sourceChannel) || "ui",
      };
    },
  )
  .handler(async ({ data, context }) =>
    executeHpoRouteCreateCore({
      db: context.supabase as any,
      userId: context.userId,
      payload: {
        ...data,
        idempotencyKey:
          data.idempotencyKey || `ui:${crypto.randomUUID()}:hpo.route.create`,
        sourceChannel: data.sourceChannel,
      },
    }),
  );

export async function executeHpoRouteOptimizeCore(input: {
  db: any;
  userId: string;
  routeId: string;
  idempotencyKey: string;
  sourceChannel: string;
  sourceMessageId?: string | null;
  plannerSessionId?: string;
}) {
  const action = "hpo.route.optimize";
  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action,
    sourceMessageId: input.sourceMessageId ?? null,
    idempotencyKey: input.idempotencyKey,
    targetType: "hpo_route",
    targetId: input.routeId,
    requestPayload: {
      capability: action,
      routeId: input.routeId,
      sourceChannel: input.sourceChannel,
    },
  });
  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeOptimizeResult"]
  ) {
    return execution.resultPayload["routeOptimizeResult"] as {
      ok: true;
      action: string;
      executionRunId: string;
      routeId: string;
      stopCount: number;
      distanceMiles: number;
      driveMinutes: number;
      optimizedAt: string;
      reused: boolean;
    };
  }

  let originalStopIds: string[] = [];
  try {
    const db = input.db;
    const userId = input.userId;
    const { data: route, error: routeError } = await db
      .from("hpo_route_plans")
      .select("*")
      .eq("id", input.routeId)
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

    if (
      input.plannerSessionId &&
      (route.status !== "planned" ||
        route.metadata?.source_channel !==
          `hpo_planner:${input.plannerSessionId}`)
    )
      throw new Error(
        "This route is active or belongs to another session. Open it in Planner.",
      );
    originalStopIds = stops.map((stop: any) => String(stop.id));
    if (stops.some((stop: any) => TERMINAL.has(String(stop.status)))) {
      throw new Error(
        "This route already has completed field history. Reoptimize the remaining stops instead.",
      );
    }

    const unresolved: any[] = [];
    for (const stop of stops) {
      if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
        continue;
      if (!stop.address)
        throw new Error(
          `${stop.office_name ?? "A stop"} is missing an address`,
        );
      unresolved.push(stop);
    }

    for (let index = 0; index < unresolved.length; index += 1) {
      const stop = unresolved[index]!;
      const point = await geocodeHpoAddress(
        [stop.address, stop.city].filter(Boolean).join(", "),
      );
      stop.latitude = point.lat;
      stop.longitude = point.lon;
      const { error } = await db
        .from("hpo_route_stops")
        .update({
          latitude: point.lat,
          longitude: point.lon,
          updated_at: new Date().toISOString(),
        })
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
      if (
        Number.isFinite(route.start_latitude) &&
        Number.isFinite(route.start_longitude)
      ) {
        startPoint = { lat: route.start_latitude, lon: route.start_longitude };
      } else {
        startPoint = await geocodeHpoAddress(route.start_address);
      }
    }
    if (
      route.end_address &&
      !(
        route.start_address &&
        route.end_address === route.start_address &&
        startPoint
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1050));
    }
    if (route.end_address) {
      if (
        Number.isFinite(route.end_latitude) &&
        Number.isFinite(route.end_longitude)
      ) {
        endPoint = { lat: route.end_latitude, lon: route.end_longitude };
      } else if (
        route.start_address &&
        route.end_address === route.start_address &&
        startPoint
      ) {
        endPoint = startPoint;
      } else {
        endPoint = await geocodeHpoAddress(route.end_address);
      }
    }

    const points: Array<{
      lat: number;
      lon: number;
      kind: "start" | "stop" | "end";
      stopId?: string;
    }> = [];
    if (startPoint) points.push({ ...startPoint, kind: "start" });
    for (const stop of stops) {
      points.push({
        lat: Number(stop.latitude),
        lon: Number(stop.longitude),
        kind: "stop",
        stopId: stop.id,
      });
    }
    if (endPoint) points.push({ ...endPoint, kind: "end" });
    if (points.length > 32)
      throw new Error("Keep optimized routes to 30 office stops or fewer.");

    const { durations, distances } =
      points.length === 1
        ? { durations: [[0]], distances: [[0]] }
        : await roadMatrix(points);
    const startIndex = startPoint ? 0 : null;
    const stopOffset = startPoint ? 1 : 0;
    const stopIndexes = stops.map(
      (_stop: any, index: number) => stopOffset + index,
    );
    const endIndex = endPoint ? points.length - 1 : null;
    const optimized =
      optimizeSequenceExact(stopIndexes, durations, startIndex, endIndex) ??
      optimizeSequence(stopIndexes, durations, startIndex, endIndex);
    const stopByNode = new Map<number, any>();
    stops.forEach((stop: any, index: number) =>
      stopByNode.set(stopOffset + index, stop),
    );

    let previousNode = startIndex;
    let totalDistance = 0;
    let totalDuration = 0;
    const orderedStopIds: string[] = [];
    const orderedDistances: Array<number | null> = [];
    const orderedDrives: Array<number | null> = [];
    for (let index = 0; index < optimized.length; index += 1) {
      const nodeIndex = optimized[index]!;
      const stop = stopByNode.get(nodeIndex);
      if (!stop) continue;
      const segmentDistance =
        previousNode == null
          ? 0
          : Number(distances[previousNode]?.[nodeIndex] ?? 0);
      const segmentDuration =
        previousNode == null
          ? 0
          : Number(durations[previousNode]?.[nodeIndex] ?? 0);
      if (
        input.plannerSessionId &&
        previousNode != null &&
        (distances[previousNode]?.[nodeIndex] == null ||
          durations[previousNode]?.[nodeIndex] == null ||
          !Number.isFinite(segmentDistance) ||
          !Number.isFinite(segmentDuration))
      )
        throw new Error(
          "Road-time optimization could not connect every selected stop. Retry Finalize Route.",
        );
      totalDistance += segmentDistance;
      totalDuration += segmentDuration;
      orderedStopIds.push(String(stop.id));
      orderedDistances.push(Math.round(segmentDistance));
      orderedDrives.push(Math.round(segmentDuration));
      previousNode = nodeIndex;
    }

    const { error: orderError } = input.plannerSessionId
      ? { error: null }
      : await db.rpc("emery_hpo_apply_route_order", {
          p_route_id: route.id,
          p_stop_ids: orderedStopIds,
          p_distance_meters: orderedDistances,
          p_drive_seconds: orderedDrives,
        });
    if (orderError) throw orderError;
    if (previousNode != null && endIndex != null) {
      totalDistance += Number(distances[previousNode]?.[endIndex] ?? 0);
      totalDuration += Number(durations[previousNode]?.[endIndex] ?? 0);
    }

    const orderedRoadPoints: Array<{ lat: number; lon: number }> = [];
    if (startPoint) orderedRoadPoints.push(startPoint);
    for (const nodeIndex of optimized) {
      const stop = stopByNode.get(nodeIndex);
      if (
        stop &&
        Number.isFinite(stop.latitude) &&
        Number.isFinite(stop.longitude)
      ) {
        orderedRoadPoints.push({
          lat: Number(stop.latitude),
          lon: Number(stop.longitude),
        });
      }
    }
    if (endPoint) orderedRoadPoints.push(endPoint);
    const routeGeometry =
      orderedRoadPoints.length >= 2
        ? await roadRouteGeometry(orderedRoadPoints)
        : null;

    if (
      input.plannerSessionId &&
      orderedRoadPoints.length >= 2 &&
      (!routeGeometry || routeGeometry.length < 2)
    )
      throw new Error(
        "Road geometry is temporarily unavailable. Your offices are saved; retry Finalize Route.",
      );
    const optimizedAt = new Date().toISOString();
    const routePatch = {
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
        planner: "emery_native_v2",
        optimization_engine:
          stopIndexes.length <= 14
            ? "open_road_matrix_exact_v2"
            : "open_road_matrix_heuristic_v2",
        route_geometry: routeGeometry,
        mapquest_dependency: false,
        optimization_execution_run_id: execution.id,
      },
      updated_at: optimizedAt,
    };
    const { data: verifiedRoute, error: updateError } = input.plannerSessionId
      ? await db.rpc("emery_hpo_finalize_planner_order", {
          p_route_id: route.id,
          p_session_id: input.plannerSessionId,
          p_stop_ids: orderedStopIds,
          p_distance_meters: orderedDistances,
          p_drive_seconds: orderedDrives,
          p_patch: routePatch,
        })
      : await db
          .from("hpo_route_plans")
          .update(routePatch)
          .eq("id", route.id)
          .eq("user_id", userId)
          .select(
            "id,optimized_at,optimized_distance_meters,optimized_duration_seconds",
          )
          .single();
    const optimizedTimestampMatches =
      verifiedRoute?.optimized_at != null &&
      new Date(verifiedRoute.optimized_at).getTime() ===
        new Date(optimizedAt).getTime();
    if (updateError || !verifiedRoute || !optimizedTimestampMatches) {
      throw updateError ?? new Error("Route optimization verification failed");
    }

    const result = {
      ok: true as const,
      action,
      executionRunId: execution.id,
      routeId: route.id,
      stopCount: stops.length,
      distanceMiles: miles(totalDistance),
      driveMinutes: secondsToMinutes(totalDuration),
      optimizedAt,
      reused: execution.reused,
    };
    await completeExecution({
      db,
      userId,
      runId: execution.id,
      resultPayload: {
        routeOptimizeResult: result as unknown as Record<string, unknown>,
      },
      targetType: "hpo_route",
      targetId: route.id,
    });
    return result;
  } catch (error) {
    const serialized = serializeError(error, {
      capability: "hpo.route",
      operation: "optimize",
    });
    let restored = false;
    if (originalStopIds.length && !input.plannerSessionId) {
      const rollback = await input.db.rpc("emery_hpo_apply_route_order", {
        p_route_id: input.routeId,
        p_stop_ids: originalStopIds,
        p_distance_meters: originalStopIds.map(() => null),
        p_drive_seconds: originalStopIds.map(() => null),
      });
      restored = !rollback.error;
    }
    const safeMessage = restored
      ? `Route optimization failed, and the original stop order was restored. ${serialized.message}`
      : serialized.message;
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      errorCode: "hpo_route_optimize_failed",
      errorMessage: safeMessage,
      retryable: true,
      resultPayload: { originalOrderRestored: restored },
    }).catch(() => undefined);
    throw new Error(safeMessage);
  }
}

export const optimizeHpoRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      routeId: string;
      idempotencyKey?: string | null;
      sourceChannel?: string | null;
    }) => ({
      routeId: clean(input.routeId),
      idempotencyKey: clean(input.idempotencyKey) || null,
      sourceChannel: clean(input.sourceChannel) || "ui",
    }),
  )
  .handler(async ({ data, context }) =>
    executeHpoRouteOptimizeCore({
      db: context.supabase as any,
      userId: context.userId,
      routeId: data.routeId,
      idempotencyKey:
        data.idempotencyKey || `ui:${crypto.randomUUID()}:hpo.route.optimize`,
      sourceChannel: data.sourceChannel,
    }),
  );

export const reorderHpoRouteStops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string; stopIds: string[] }) => ({
    routeId: clean(input.routeId),
    stopIds: Array.isArray(input.stopIds)
      ? input.stopIds.map(clean).filter(Boolean).slice(0, 30)
      : [],
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error: reorderError } = await db.rpc(
      "emery_hpo_apply_route_order",
      {
        p_route_id: data.routeId,
        p_stop_ids: data.stopIds,
        p_distance_meters: data.stopIds.map(() => null),
        p_drive_seconds: data.stopIds.map(() => null),
      },
    );
    if (reorderError) throw reorderError;
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

function routeOutcomeSummary(status: string) {
  if (status === "closed")
    return { note: "Office closed.", outcome: "Office closed" };
  if (status === "bad_address")
    return {
      note: "Bad or unusable office address.",
      outcome: "Bad / unusable address",
    };
  if (status === "skipped")
    return { note: "Route stop skipped.", outcome: "Skipped" };
  return { note: "Visit completed.", outcome: "Visit completed" };
}

export async function executeHpoRouteStopOutcomeCore(input: {
  db: any;
  userId: string;
  stopId: string;
  status: "completed" | "visited" | "closed" | "bad_address" | "skipped";
  notes?: string | null | undefined;
  visitOutcome?: string | null | undefined;
  nextAction?: string | null | undefined;
  nextActionDueAt?: string | null | undefined;
  idempotencyKey: string;
  sourceChannel: string;
  sourceMessageId?: string | null;
  parentRunId?: string | null;
  traceId?: string | null;
  baseUpdatedAt?: string | null;
}) {
  const action = "hpo.route_stop.set_outcome";
  const idempotencyKey = clean(input.idempotencyKey);
  if (!idempotencyKey)
    throw new Error("Route-stop outcome requires an idempotency key");

  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action,
    sourceMessageId: input.sourceMessageId ?? null,
    parentRunId: input.parentRunId ?? null,
    idempotencyKey,
    targetType: "hpo_route_stop",
    targetId: input.stopId,
    requestPayload: {
      capability: action,
      stopId: input.stopId,
      status: input.status,
      notes: input.notes ?? null,
      visitOutcome: input.visitOutcome ?? null,
      nextAction: input.nextAction ?? null,
      nextActionDueAt: input.nextActionDueAt ?? null,
      sourceChannel: input.sourceChannel,
      traceId: input.traceId ?? null,
      baseUpdatedAt: input.baseUpdatedAt ?? null,
    },
  });

  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeStopOutcomeResult"]
  ) {
    return execution.resultPayload["routeStopOutcomeResult"] as {
      ok: true;
      action: string;
      executionRunId: string;
      stop: any;
      routeStatus: string;
      reused: boolean;
    };
  }

  try {
    const { data: stop, error: fetchError } = await input.db
      .from("hpo_route_stops")
      .select("*")
      .eq("id", input.stopId)
      .eq("user_id", input.userId)
      .single();
    if (fetchError || !stop)
      throw fetchError ?? new Error("Route stop not found");
    if (
      input.baseUpdatedAt &&
      !Number.isNaN(Date.parse(input.baseUpdatedAt)) &&
      !Number.isNaN(Date.parse(stop.updated_at)) &&
      Date.parse(stop.updated_at) > Date.parse(input.baseUpdatedAt) + 1000
    ) {
      throw new Error(
        "offline_conflict: This stop changed after the offline snapshot. Refresh before retrying.",
      );
    }

    const patch: Record<string, unknown> = {
      status: input.status,
      updated_at: new Date().toISOString(),
    };
    if (TERMINAL.has(input.status) && !stop.visited_at) {
      patch["visited_at"] = new Date().toISOString();
    }
    if (input.notes !== undefined) {
      const stopMetadata =
        stop.metadata &&
        typeof stop.metadata === "object" &&
        !Array.isArray(stop.metadata)
          ? stop.metadata
          : {};
      const hasLockedFieldNote =
        stopMetadata["route_note_locked"] === true && Boolean(clean(stop.notes));
      if (!hasLockedFieldNote) {
        patch["notes"] = input.notes?.trim() || null;
      }
      patch["visit_summary"] = input.notes?.trim() || null;
    }
    if (input.visitOutcome !== undefined) {
      patch["visit_outcome"] = input.visitOutcome?.trim() || null;
    }
    if (input.nextAction !== undefined) {
      patch["next_action"] = input.nextAction?.trim() || null;
    }
    if (input.nextActionDueAt !== undefined) {
      patch["next_action_due_at"] = input.nextActionDueAt;
    }

    const { data: updated, error: updateError } = await input.db
      .from("hpo_route_stops")
      .update(patch)
      .eq("id", stop.id)
      .eq("user_id", input.userId)
      .select("*")
      .single();
    if (updateError || !updated)
      throw updateError ?? new Error("Route stop update returned no record");

    const { data: verified, error: verifyError } = await input.db
      .from("hpo_route_stops")
      .select("*")
      .eq("id", stop.id)
      .eq("user_id", input.userId)
      .single();
    if (verifyError || !verified)
      throw verifyError ?? new Error("Route stop verification failed");
    if (verified.status !== input.status)
      throw new Error("Route stop outcome verification failed");

    const outcomeSummary = routeOutcomeSummary(input.status);
    await upsertInteractionForStop(input.db, input.userId, verified, {
      notes:
        input.notes?.trim() ||
        verified.visit_summary?.trim() ||
        outcomeSummary.note,
      visitOutcome:
        input.visitOutcome?.trim() ||
        verified.visit_outcome?.trim() ||
        outcomeSummary.outcome,
      nextAction: input.nextAction ?? verified.next_action,
      nextActionDueAt: input.nextActionDueAt ?? verified.next_action_due_at,
      status: input.status,
      executionRunId: execution.id,
      sourceChannel: input.sourceChannel,
      traceId: input.traceId ?? null,
    });

    const routeStatus = await syncRouteStatus(
      input.db,
      input.userId,
      verified.route_id,
    );
    const result = {
      ok: true as const,
      action,
      executionRunId: execution.id,
      stop: verified,
      routeStatus,
      reused: execution.reused,
    };

    await completeExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      resultPayload: {
        routeStopOutcomeResult: result as unknown as Record<string, unknown>,
      },
      targetType: "hpo_route_stop",
      targetId: verified.id,
    });
    return result;
  } catch (error) {
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      errorCode: "hpo_route_stop_outcome_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
      resultPayload: {
        action,
        stopId: input.stopId,
        requestedStatus: input.status,
      },
    }).catch(() => undefined);
    throw error;
  }
}

export async function executeHpoRouteStopFollowupCore(input: {
  db: any;
  userId: string;
  stopId: string;
  nextAction: string;
  nextActionDueAt?: string | null | undefined;
  idempotencyKey: string;
  sourceChannel: string;
  sourceMessageId?: string | null;
  parentRunId?: string | null;
  traceId?: string | null;
  baseUpdatedAt?: string | null;
  createTask?: boolean;
}) {
  const action = "hpo.route_stop.set_followup";
  const nextAction = clean(input.nextAction);
  if (!nextAction) throw new Error("Follow-up action is required");
  const key = clean(input.idempotencyKey);
  if (!key) throw new Error("Follow-up action requires an idempotency key");

  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action,
    sourceMessageId: input.sourceMessageId ?? null,
    parentRunId: input.parentRunId ?? null,
    idempotencyKey: key,
    targetType: "hpo_route_stop",
    targetId: input.stopId,
    requestPayload: {
      capability: action,
      stopId: input.stopId,
      nextAction,
      nextActionDueAt: input.nextActionDueAt ?? null,
      sourceChannel: input.sourceChannel,
      traceId: input.traceId ?? null,
      baseUpdatedAt: input.baseUpdatedAt ?? null,
    },
  });

  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeStopFollowupResult"]
  ) {
    return execution.resultPayload["routeStopFollowupResult"] as {
      ok: true;
      action: string;
      executionRunId: string;
      stopId: string;
      accountId: string | null;
      nextAction: string;
      nextActionDueAt: string | null;
      taskId: string | null;
      reused: boolean;
    };
  }

  try {
    const { data: stop, error: stopError } = await input.db
      .from("hpo_route_stops")
      .select("*")
      .eq("id", input.stopId)
      .eq("user_id", input.userId)
      .single();
    if (stopError || !stop)
      throw stopError ?? new Error("Route stop not found");
    if (
      input.baseUpdatedAt &&
      !Number.isNaN(Date.parse(input.baseUpdatedAt)) &&
      !Number.isNaN(Date.parse(stop.updated_at)) &&
      Date.parse(stop.updated_at) > Date.parse(input.baseUpdatedAt) + 1000
    ) {
      throw new Error(
        "offline_conflict: This stop changed after the offline snapshot. Refresh before retrying.",
      );
    }

    const dueAt = input.nextActionDueAt ?? null;
    const { data: updated, error: updateError } = await input.db
      .from("hpo_route_stops")
      .update({
        next_action: nextAction,
        next_action_due_at: dueAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stop.id)
      .eq("user_id", input.userId)
      .select("id,account_id,next_action,next_action_due_at,metadata")
      .single();
    if (updateError || !updated)
      throw updateError ?? new Error("Follow-up update returned no record");
    if (updated.next_action !== nextAction)
      throw new Error("Follow-up verification failed");

    const metadata =
      updated.metadata &&
      typeof updated.metadata === "object" &&
      !Array.isArray(updated.metadata)
        ? updated.metadata
        : {};
    const interactionId =
      typeof metadata.route_interaction_id === "string"
        ? metadata.route_interaction_id
        : null;

    if (interactionId) {
      const { error } = await input.db
        .from("hpo_interactions")
        .update({
          next_action: nextAction,
          next_action_due_at: dueAt,
          metadata: {
            route_id: stop.route_id,
            route_stop_id: stop.id,
            execution_run_id: execution.id,
            source_channel: input.sourceChannel,
            trace_id: input.traceId ?? null,
            non_phi: true,
          },
        })
        .eq("id", interactionId)
        .eq("user_id", input.userId);
      if (error) throw error;
    }

    if (stop.account_id) {
      const { error } = await input.db
        .from("hpo_accounts")
        .update({
          next_action: nextAction,
          next_action_due_at: dueAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", stop.account_id)
        .eq("user_id", input.userId);
      if (error) throw error;

      const { data: accountVerify, error: accountVerifyError } = await input.db
        .from("hpo_accounts")
        .select("id,next_action,next_action_due_at")
        .eq("id", stop.account_id)
        .eq("user_id", input.userId)
        .single();
      if (accountVerifyError || !accountVerify) {
        throw (
          accountVerifyError ??
          new Error("Account follow-up verification failed")
        );
      }
      if (accountVerify.next_action !== nextAction)
        throw new Error("Account follow-up verification failed");
    }

    let taskId: string | null = null;
    if (input.createTask) {
      const taskReceipt = await executeCanonicalTaskCreate({
        db: input.db,
        userId: input.userId,
        idempotencyKey: `${key}:task.create`,
        title: `Follow up with ${stop.office_name || "HPO office"}`,
        details: `HPO field follow-up from route stop ${stop.stop_order}: ${nextAction}`,
        dueAt,
        priority: 3,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
        parentRunId: execution.id,
        source: "hpo-route-followup",
      });
      if (
        !taskReceipt.ok ||
        taskReceipt.status !== "completed" ||
        !taskReceipt.task?.id
      ) {
        throw new Error(
          taskReceipt.errorMessage || "Follow-up task creation failed",
        );
      }
      taskId = taskReceipt.task.id;
      const taskMetadata =
        taskReceipt.task &&
        typeof (taskReceipt.task as any).metadata === "object"
          ? (taskReceipt.task as any).metadata
          : {};
      const { error: taskMetadataError } = await input.db
        .from("tasks")
        .update({
          metadata: {
            ...taskMetadata,
            domain: "hpo",
            hpo: true,
            hpo_route_id: stop.route_id,
            hpo_route_stop_id: stop.id,
            hpo_account_id: stop.account_id ?? null,
            execution_run_id: execution.id,
          },
        })
        .eq("id", taskId)
        .eq("user_id", input.userId);
      if (taskMetadataError) throw taskMetadataError;
    }

    const result = {
      ok: true as const,
      action,
      executionRunId: execution.id,
      stopId: stop.id,
      accountId: stop.account_id ?? null,
      nextAction,
      nextActionDueAt: dueAt,
      taskId,
      reused: execution.reused,
    };
    await completeExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      resultPayload: {
        routeStopFollowupResult: result as unknown as Record<string, unknown>,
      },
      targetType: "hpo_route_stop",
      targetId: stop.id,
    });
    return result;
  } catch (error) {
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      errorCode: "hpo_route_stop_followup_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
      resultPayload: { action, stopId: input.stopId, nextAction },
    }).catch(() => undefined);
    throw error;
  }
}

export const setHpoRouteStopOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      stopId: string;
      status: "completed" | "visited" | "closed" | "bad_address" | "skipped";
      idempotencyKey?: string | null;
      sourceChannel?: string | null;
      baseUpdatedAt?: string | null;
    }) => {
      const status = clean(input.status);
      const allowed = new Set([
        "completed",
        "visited",
        "closed",
        "bad_address",
        "skipped",
      ]);
      if (!allowed.has(status))
        throw new Error("Unsupported route-stop outcome");
      return {
        stopId: clean(input.stopId),
        status: status as
          "completed" | "visited" | "closed" | "bad_address" | "skipped",
        idempotencyKey: clean(input.idempotencyKey) || null,
        sourceChannel: clean(input.sourceChannel) || "ui",
        baseUpdatedAt:
          input.baseUpdatedAt && !Number.isNaN(Date.parse(input.baseUpdatedAt))
            ? new Date(input.baseUpdatedAt).toISOString()
            : null,
      };
    },
  )
  .handler(async ({ data, context }) =>
    executeHpoRouteStopOutcomeCore({
      db: context.supabase as any,
      userId: context.userId,
      stopId: data.stopId,
      status: data.status,
      idempotencyKey:
        data.idempotencyKey ||
        `ui:${crypto.randomUUID()}:hpo.route_stop.set_outcome`,
      sourceChannel: data.sourceChannel,
      baseUpdatedAt: data.baseUpdatedAt,
    }),
  );

export async function executeHpoRouteStopVisitCore(input: {
  db: any;
  userId: string;
  stopId: string;
  status: "completed" | "visited" | "closed" | "bad_address" | "skipped";
  notes: string;
  visitOutcome?: string | null | undefined;
  nextAction?: string | null | undefined;
  nextActionDueAt?: string | null | undefined;
  idempotencyKey: string;
  sourceChannel: string;
  sourceMessageId?: string | null;
  parentRunId?: string | null;
  traceId?: string | null;
  baseUpdatedAt?: string | null;
  createFollowupTask?: boolean;
}) {
  const action = "hpo.route_stop.log_visit";
  const key = clean(input.idempotencyKey);
  if (!key) throw new Error("Visit logging requires an idempotency key");

  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action,
    sourceMessageId: input.sourceMessageId ?? null,
    parentRunId: input.parentRunId ?? null,
    idempotencyKey: key,
    targetType: "hpo_route_stop",
    targetId: input.stopId,
    requestPayload: {
      capability: action,
      stopId: input.stopId,
      status: input.status,
      notes: input.notes,
      visitOutcome: input.visitOutcome ?? null,
      nextAction: input.nextAction ?? null,
      nextActionDueAt: input.nextActionDueAt ?? null,
      sourceChannel: input.sourceChannel,
      traceId: input.traceId ?? null,
      baseUpdatedAt: input.baseUpdatedAt ?? null,
      createFollowupTask: Boolean(input.createFollowupTask),
    },
  });

  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeStopVisitResult"]
  ) {
    return execution.resultPayload["routeStopVisitResult"] as {
      ok: true;
      action: string;
      executionRunId: string;
      stop: any;
      interactionId: string | null;
      routeStatus: string;
      followupExecutionRunId?: string | null;
      followupTaskId?: string | null;
      reused: boolean;
    };
  }

  try {
    const outcome = await executeHpoRouteStopOutcomeCore({
      db: input.db,
      userId: input.userId,
      stopId: input.stopId,
      status: input.status,
      notes: input.notes,
      visitOutcome: input.visitOutcome,
      nextAction: input.nextAction,
      nextActionDueAt: input.nextActionDueAt,
      idempotencyKey: `${key}:outcome`,
      sourceChannel: input.sourceChannel,
      sourceMessageId: input.sourceMessageId ?? null,
      parentRunId: execution.id,
      traceId: input.traceId ?? execution.id,
      baseUpdatedAt: input.baseUpdatedAt ?? null,
    });

    let followupResult: any = null;
    if (input.nextAction?.trim()) {
      followupResult = await executeHpoRouteStopFollowupCore({
        db: input.db,
        userId: input.userId,
        stopId: input.stopId,
        nextAction: input.nextAction,
        nextActionDueAt: input.nextActionDueAt,
        idempotencyKey: `${key}:followup`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
        parentRunId: execution.id,
        traceId: input.traceId ?? execution.id,
        createTask: Boolean(input.createFollowupTask),
      });
    }

    let interactionId: string | null = null;
    if (outcome.stop.account_id) {
      const { data: interaction, error: interactionError } = await input.db
        .from("hpo_interactions")
        .select("id,source_ref")
        .eq("user_id", input.userId)
        .eq("interaction_type", "visit")
        .eq("source_type", "route")
        .eq("source_ref", outcome.stop.id)
        .maybeSingle();
      if (interactionError) throw interactionError;
      interactionId = interaction?.id ?? null;
      if (!interactionId)
        throw new Error("Visit interaction verification failed");
    }

    const result = {
      ok: true as const,
      action,
      executionRunId: execution.id,
      stop: outcome.stop,
      interactionId,
      routeStatus: outcome.routeStatus,
      followupExecutionRunId: followupResult?.executionRunId ?? null,
      followupTaskId: followupResult?.taskId ?? null,
      reused: execution.reused,
    };
    await completeExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      resultPayload: {
        routeStopVisitResult: result as unknown as Record<string, unknown>,
      },
      targetType: "hpo_route_stop",
      targetId: outcome.stop.id,
    });
    return result;
  } catch (error) {
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      errorCode: "hpo_route_stop_visit_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
      resultPayload: { action, stopId: input.stopId },
    }).catch(() => undefined);
    throw error;
  }
}

type SavedHpoNoteAnalysis = {
  outcome: string | null;
  relationshipSignal: "positive" | "neutral" | "negative" | "mixed" | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  calendarEvent: {
    shouldCreate: boolean;
    title: string | null;
    startAt: string | null;
    endAt: string | null;
    eventType: "lunch" | "meeting" | "appointment" | "event" | null;
    clarificationQuestion: string | null;
  };
};

async function analyzeSavedHpoNote(input: {
  apiKey: string;
  note: string;
  officeName: string;
  timezone: string;
}): Promise<SavedHpoNoteAnalysis> {
  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timezone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(new Date());

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_POLICY.action,
      input: [
        {
          role: "system",
          content: `You are Emery's HPO saved-note analyzer.

Current local time: ${localNow}
Timezone: ${input.timezone}
Office: ${input.officeName}

Adam has already pressed Save Note. The original note is already being saved verbatim to the associated HPO record. Your job is ONLY to extract safe structured follow-through from that saved relationship note.

OUTCOME + RELATIONSHIP SIGNAL
- outcome: a short factual description of what this interaction accomplished or revealed, only when directly supported by the note. Do not invent a conclusion.
- relationship_signal: choose positive, neutral, negative, mixed, or null based only on explicit evidence in the note.
- Do NOT change account relationship stage, priority, or close/won status. Those remain separate deliberate CRM decisions.
- If the note does not support an outcome or signal, return null.

NEXT ACTION
- Extract one concrete relationship-level next action only when the note explicitly states it or it is the direct operational consequence of a confirmed commitment.
- Do not invent outreach, meetings, lunches, people, dates, or times.
- A confirmed scheduled commitment can become the next action, e.g. "Attend lunch with [office]".
- If there is no confident next action, return null.
- next_action_due_at must be null unless the note provides enough timing information to resolve an exact timestamp.
- Resolve relative dates from the supplied current local time.
- All timestamps must be ISO-8601 with an explicit UTC offset.

CALENDAR
- Create a calendar event ONLY for a confirmed future commitment such as a lunch, meeting, or appointment that is already scheduled/set/booked/confirmed in the note.
- The note must provide a usable date AND start time. Do not invent a missing date or time.
- "Need to schedule", "try to schedule", "follow up", "maybe", "planning to", office hours, and historical/past meetings are NOT calendar events.
- If there is clearly a confirmed commitment but the date or start time is missing, should_create=false and provide one concise clarification_question.
- If no end time/duration is given, end_at may be null; the app will use its normal 60-minute event default.
- Titles should be concise and include the office, e.g. "Lunch — Morris Medical Associates".
- Never put patient names, DOBs, diagnoses, case/claim numbers, treatment details, or other PHI into the extracted outcome, relationship signal, next action, or calendar event.

Return strict JSON only.`,
        },
        {
          role: "user",
          content: [{ type: "input_text", text: input.note }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "hpo_saved_note_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              outcome: { type: ["string", "null"] },
              relationship_signal: {
                type: ["string", "null"],
                enum: ["positive", "neutral", "negative", "mixed", null],
              },
              next_action: { type: ["string", "null"] },
              next_action_due_at: { type: ["string", "null"] },
              calendar_event: {
                type: "object",
                additionalProperties: false,
                properties: {
                  should_create: { type: "boolean" },
                  title: { type: ["string", "null"] },
                  start_at: { type: ["string", "null"] },
                  end_at: { type: ["string", "null"] },
                  event_type: {
                    type: ["string", "null"],
                    enum: ["lunch", "meeting", "appointment", "event", null],
                  },
                  clarification_question: { type: ["string", "null"] },
                },
                required: [
                  "should_create",
                  "title",
                  "start_at",
                  "end_at",
                  "event_type",
                  "clarification_question",
                ],
              },
            },
            required: [
              "outcome",
              "relationship_signal",
              "next_action",
              "next_action_due_at",
              "calendar_event",
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Saved-note analysis failed (${response.status}).`);
  }

  const parsed = JSON.parse(responseText(await response.json()));
  const dueAt =
    typeof parsed.next_action_due_at === "string" &&
    !Number.isNaN(Date.parse(parsed.next_action_due_at))
      ? new Date(parsed.next_action_due_at).toISOString()
      : null;
  const startAt =
    typeof parsed.calendar_event?.start_at === "string" &&
    !Number.isNaN(Date.parse(parsed.calendar_event.start_at))
      ? new Date(parsed.calendar_event.start_at).toISOString()
      : null;
  const endAt =
    typeof parsed.calendar_event?.end_at === "string" &&
    !Number.isNaN(Date.parse(parsed.calendar_event.end_at))
      ? new Date(parsed.calendar_event.end_at).toISOString()
      : null;

  return {
    outcome:
      typeof parsed.outcome === "string" && parsed.outcome.trim()
        ? parsed.outcome.trim()
        : null,
    relationshipSignal: ["positive", "neutral", "negative", "mixed"].includes(
      String(parsed.relationship_signal ?? ""),
    )
      ? parsed.relationship_signal
      : null,
    nextAction:
      typeof parsed.next_action === "string" && parsed.next_action.trim()
        ? parsed.next_action.trim()
        : null,
    nextActionDueAt: dueAt,
    calendarEvent: {
      shouldCreate: parsed.calendar_event?.should_create === true && Boolean(startAt),
      title:
        typeof parsed.calendar_event?.title === "string" &&
        parsed.calendar_event.title.trim()
          ? parsed.calendar_event.title.trim()
          : null,
      startAt,
      endAt,
      eventType: ["lunch", "meeting", "appointment", "event"].includes(
        String(parsed.calendar_event?.event_type ?? ""),
      )
        ? parsed.calendar_event.event_type
        : null,
      clarificationQuestion:
        typeof parsed.calendar_event?.clarification_question === "string" &&
        parsed.calendar_event.clarification_question.trim()
          ? parsed.calendar_event.clarification_question.trim()
          : null,
    },
  };
}

async function applySavedHpoNoteIntelligence(input: {
  db: any;
  userId: string;
  apiKey: string;
  idempotencyKey: string;
  saved: any;
}) {
  const timezone = await getTimezone(input.db, input.userId);
  const analysis = await analyzeSavedHpoNote({
    apiKey: input.apiKey,
    note: input.saved.note,
    officeName: input.saved.officeName || "HPO office",
    timezone,
  });
  if (analysis.nextAction && !analysis.nextActionDueAt) {
    analysis.nextActionDueAt = followupDueFromNote(
      String(input.saved.note ?? ""),
      timezone,
    );
  }

  const savedStopMetadata =
    input.saved.stop?.metadata &&
    typeof input.saved.stop.metadata === "object" &&
    !Array.isArray(input.saved.stop.metadata)
      ? input.saved.stop.metadata
      : {};
  const previousDerivedNextAction =
    typeof savedStopMetadata["route_note_derived_next_action"] === "string"
      ? clean(savedStopMetadata["route_note_derived_next_action"])
      : "";

  if (input.saved.interactionId) {
    const interactionUpdate = await input.db
      .from("hpo_interactions")
      .update({
        outcome: analysis.outcome,
        relationship_signal: analysis.relationshipSignal,
        next_action: analysis.nextAction,
        next_action_due_at: analysis.nextActionDueAt,
      })
      .eq("id", input.saved.interactionId)
      .eq("user_id", input.userId);
    if (interactionUpdate.error) throw interactionUpdate.error;
  }

  const now = new Date().toISOString();
  let currentAccount: any = null;
  if (input.saved.accountId) {
    const accountLookup = await input.db
      .from("hpo_accounts")
      .select("id,next_action,next_action_due_at,metadata")
      .eq("id", input.saved.accountId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (accountLookup.error) throw accountLookup.error;
    currentAccount = accountLookup.data ?? null;
  }

  if (input.saved.accountId && analysis.nextAction) {
    const accountPatch: Record<string, unknown> = {
      next_action: analysis.nextAction,
      next_action_due_at: analysis.nextActionDueAt,
      updated_at: now,
    };
    const accountUpdate = await input.db
      .from("hpo_accounts")
      .update(accountPatch)
      .eq("id", input.saved.accountId)
      .eq("user_id", input.userId);
    if (accountUpdate.error) throw accountUpdate.error;
  } else if (
    input.saved.accountId &&
    previousDerivedNextAction &&
    clean(currentAccount?.next_action) === previousDerivedNextAction
  ) {
    const accountUpdate = await input.db
      .from("hpo_accounts")
      .update({
        next_action: null,
        next_action_due_at: null,
        updated_at: now,
      })
      .eq("id", input.saved.accountId)
      .eq("user_id", input.userId);
    if (accountUpdate.error) throw accountUpdate.error;
  }

  const currentStopNextAction = clean(input.saved.stop?.next_action);
  const stopPatch: Record<string, unknown> = {
    metadata: {
      ...savedStopMetadata,
      route_note_derived_next_action: analysis.nextAction,
      route_note_derived_next_action_due_at: analysis.nextActionDueAt,
      route_note_outcome: analysis.outcome,
      route_note_relationship_signal: analysis.relationshipSignal,
    },
    updated_at: now,
  };
  if (analysis.nextAction) {
    stopPatch["next_action"] = analysis.nextAction;
    stopPatch["next_action_due_at"] = analysis.nextActionDueAt;
  } else if (
    previousDerivedNextAction &&
    currentStopNextAction === previousDerivedNextAction
  ) {
    stopPatch["next_action"] = null;
    stopPatch["next_action_due_at"] = null;
  }
  const stopUpdate = await input.db
    .from("hpo_route_stops")
    .update(stopPatch)
    .eq("id", input.saved.stopId)
    .eq("user_id", input.userId);
  if (stopUpdate.error) throw stopUpdate.error;

  if (input.saved.accountId && currentAccount) {
    const accountMetadata =
      currentAccount.metadata &&
      typeof currentAccount.metadata === "object" &&
      !Array.isArray(currentAccount.metadata)
        ? currentAccount.metadata
        : {};
    if (
      accountMetadata["latest_field_note_route_stop_id"] === input.saved.stopId
    ) {
      const accountMetaUpdate = await input.db
        .from("hpo_accounts")
        .update({
          metadata: {
            ...accountMetadata,
            latest_field_note_outcome: analysis.outcome,
            latest_field_note_relationship_signal: analysis.relationshipSignal,
            latest_field_note_next_action: analysis.nextAction,
            latest_field_note_next_action_due_at: analysis.nextActionDueAt,
          },
          updated_at: now,
        })
        .eq("id", input.saved.accountId)
        .eq("user_id", input.userId);
      if (accountMetaUpdate.error) throw accountMetaUpdate.error;
    }
  }

  let calendarEvent: {
    id: string;
    title: string;
    startAt: string;
    endAt: string | null;
    eventType: string;
    duplicate: boolean;
    updated: boolean;
  } | null = null;

  const event = analysis.calendarEvent;
  if (
    event.shouldCreate &&
    event.title &&
    event.startAt &&
    Date.parse(event.startAt) > Date.now() - 5 * 60 * 1000
  ) {
    const startMs = Date.parse(event.startAt);
    const resolvedEnd =
      event.endAt && Date.parse(event.endAt) > startMs
        ? event.endAt
        : new Date(startMs + 60 * 60 * 1000).toISOString();

    const linkedEventResult = await input.db
      .from("meetings")
      .select("id,title,meeting_at,end_at,metadata")
      .eq("user_id", input.userId)
      .contains("metadata", { hpo_route_stop_id: input.saved.stopId })
      .order("meeting_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (linkedEventResult.error) throw linkedEventResult.error;
    const linkedEvent = linkedEventResult.data ?? null;

    if (linkedEvent) {
      const linkedMetadata =
        linkedEvent.metadata &&
        typeof linkedEvent.metadata === "object" &&
        !Array.isArray(linkedEvent.metadata)
          ? linkedEvent.metadata
          : {};
      const nextMetadata = {
        ...linkedMetadata,
        event_type: event.eventType ?? linkedMetadata["event_type"] ?? "event",
        hpo_account_id: input.saved.accountId ?? null,
        hpo_route_id: input.saved.routeId,
        hpo_route_stop_id: input.saved.stopId,
        hpo_interaction_id: input.saved.interactionId ?? null,
        source_workflow: "hpo_saved_note",
        non_phi: true,
      };
      const unchanged =
        clean(linkedEvent.title) === clean(event.title) &&
        Date.parse(linkedEvent.meeting_at) === Date.parse(event.startAt) &&
        Date.parse(linkedEvent.end_at ?? "") === Date.parse(resolvedEnd);

      if (!unchanged) {
        const updatedEvent = await input.db
          .from("meetings")
          .update({
            title: event.title,
            meeting_at: event.startAt,
            end_at: resolvedEnd,
            metadata: nextMetadata,
          })
          .eq("id", linkedEvent.id)
          .eq("user_id", input.userId)
          .select("id,title,meeting_at,end_at,metadata")
          .single();
        if (updatedEvent.error) throw updatedEvent.error;
        const row = updatedEvent.data;
        calendarEvent = {
          id: row.id,
          title: row.title,
          startAt: row.meeting_at,
          endAt: row.end_at ?? null,
          eventType: String(
            row.metadata?.event_type ?? event.eventType ?? "event",
          ),
          duplicate: false,
          updated: true,
        };
      } else {
        calendarEvent = {
          id: linkedEvent.id,
          title: linkedEvent.title,
          startAt: linkedEvent.meeting_at,
          endAt: linkedEvent.end_at ?? null,
          eventType: String(
            linkedMetadata["event_type"] ?? event.eventType ?? "event",
          ),
          duplicate: true,
          updated: false,
        };
      }
    } else {
      const windowStart = new Date(startMs - 5 * 60 * 1000).toISOString();
      const windowEnd = new Date(startMs + 5 * 60 * 1000).toISOString();
      const { data: nearbyEvents, error: nearbyError } = await input.db
        .from("meetings")
        .select("id,title,meeting_at,end_at,metadata")
        .eq("user_id", input.userId)
        .gte("meeting_at", windowStart)
        .lte("meeting_at", windowEnd);
      if (nearbyError) throw nearbyError;

      const officeToken = clean(input.saved.officeName).toLowerCase();
      const requestedTitle = clean(event.title).toLowerCase();
      const duplicate = (nearbyEvents ?? []).find((row: any) => {
        const title = clean(row.title).toLowerCase();
        const metadata =
          row.metadata &&
          typeof row.metadata === "object" &&
          !Array.isArray(row.metadata)
            ? row.metadata
            : {};
        return (
          metadata["hpo_account_id"] === input.saved.accountId ||
          (requestedTitle &&
            (title === requestedTitle ||
              title.includes(requestedTitle) ||
              requestedTitle.includes(title))) ||
          (officeToken && title.includes(officeToken))
        );
      });

      if (duplicate) {
        const duplicateMetadata =
          duplicate.metadata &&
          typeof duplicate.metadata === "object" &&
          !Array.isArray(duplicate.metadata)
            ? duplicate.metadata
            : {};
        const metadata = {
          ...duplicateMetadata,
          hpo_account_id: input.saved.accountId ?? null,
          hpo_route_id: input.saved.routeId,
          hpo_route_stop_id: input.saved.stopId,
          hpo_interaction_id: input.saved.interactionId ?? null,
          source_workflow: "hpo_saved_note",
          non_phi: true,
        };
        const linkedDuplicate = await input.db
          .from("meetings")
          .update({ metadata })
          .eq("id", duplicate.id)
          .eq("user_id", input.userId)
          .select("id,title,meeting_at,end_at,metadata")
          .single();
        if (linkedDuplicate.error) throw linkedDuplicate.error;
        const row = linkedDuplicate.data;
        calendarEvent = {
          id: row.id,
          title: row.title,
          startAt: row.meeting_at,
          endAt: row.end_at ?? null,
          eventType: String(
            row.metadata?.event_type ?? event.eventType ?? "event",
          ),
          duplicate: true,
          updated: false,
        };
      } else {
        const calendarExecution = await beginExecution({
          db: input.db,
          userId: input.userId,
          domain: "calendar",
          action: "create_event",
          idempotencyKey: `${input.idempotencyKey}:saved_note_calendar`,
          targetType: "hpo_route_stop",
          targetId: input.saved.stopId,
          requestPayload: {
            source: "hpo_saved_note",
            accountId: input.saved.accountId ?? null,
            stopId: input.saved.stopId,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            eventType: event.eventType ?? "event",
          },
        });

        if (
          calendarExecution.reused &&
          calendarExecution.status === "completed" &&
          calendarExecution.resultPayload["savedNoteCalendarEvent"]
        ) {
          const reused = calendarExecution.resultPayload[
            "savedNoteCalendarEvent"
          ] as any;
          calendarEvent = {
            ...reused,
            duplicate: Boolean(reused?.duplicate),
            updated: Boolean(reused?.updated),
          };
        } else {
          const created = await input.db.rpc("emery_action_create_event", {
            p_user_id: input.userId,
            p_title: event.title,
            p_start_at: event.startAt,
            p_end_at: resolvedEnd,
            p_participants: [],
            p_event_type: event.eventType ?? "event",
            p_source: "emery",
          });
          if (created.error) throw created.error;
          const row = Array.isArray(created.data)
            ? created.data[0]
            : created.data;
          if (!row?.id)
            throw new Error("Calendar event creation returned no record.");

          const currentMetadata =
            row.metadata &&
            typeof row.metadata === "object" &&
            !Array.isArray(row.metadata)
              ? row.metadata
              : {};
          const metadata = {
            ...currentMetadata,
            hpo_account_id: input.saved.accountId ?? null,
            hpo_route_id: input.saved.routeId,
            hpo_route_stop_id: input.saved.stopId,
            hpo_interaction_id: input.saved.interactionId ?? null,
            source_workflow: "hpo_saved_note",
            non_phi: true,
          };
          const metadataUpdate = await input.db
            .from("meetings")
            .update({ metadata })
            .eq("id", row.id)
            .eq("user_id", input.userId);
          if (metadataUpdate.error) throw metadataUpdate.error;

          calendarEvent = {
            id: row.id,
            title: row.title || event.title,
            startAt: row.meeting_at || event.startAt,
            endAt: row.end_at || resolvedEnd,
            eventType: String(
              row.metadata?.event_type ?? event.eventType ?? "event",
            ),
            duplicate: false,
            updated: false,
          };

          await completeExecution({
            db: input.db,
            userId: input.userId,
            runId: calendarExecution.id,
            resultPayload: {
              savedNoteCalendarEvent:
                calendarEvent as unknown as Record<string, unknown>,
            },
            targetType: "event",
            targetId: row.id,
          });
        }
      }
    }

    if (calendarEvent) {
      const { data: latestStop, error: latestStopError } = await input.db
        .from("hpo_route_stops")
        .select("metadata")
        .eq("id", input.saved.stopId)
        .eq("user_id", input.userId)
        .single();
      if (latestStopError) throw latestStopError;
      const latestMetadata =
        latestStop.metadata &&
        typeof latestStop.metadata === "object" &&
        !Array.isArray(latestStop.metadata)
          ? latestStop.metadata
          : {};
      const calendarLinkUpdate = await input.db
        .from("hpo_route_stops")
        .update({
          metadata: {
            ...latestMetadata,
            route_note_calendar_event_id: calendarEvent.id,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.saved.stopId)
        .eq("user_id", input.userId);
      if (calendarLinkUpdate.error) throw calendarLinkUpdate.error;
    }
  }

  return {
    analyzed: true,
    outcome: analysis.outcome,
    relationshipSignal: analysis.relationshipSignal,
    nextAction: analysis.nextAction,
    nextActionDueAt: analysis.nextActionDueAt,
    calendarEvent,
    calendarClarification: analysis.calendarEvent.clarificationQuestion,
  };
}

export async function addHpoRouteStopNoteCore(input: {
  db: any;
  userId: string;
  stopId: string;
  note: string;
  idempotencyKey?: string | null;
  sourceChannel?: string | null;
  sourceMessageId?: string | null;
}) {
  const note = clean(input.note);
  if (!note) throw new Error("Add a note before saving.");

  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action: "hpo.route_stop.add_note",
    sourceMessageId: input.sourceMessageId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    targetType: "hpo_route_stop",
    targetId: input.stopId,
    requestPayload: {
      stopId: input.stopId,
      note,
      sourceChannel: input.sourceChannel ?? "ui",
    },
  });

  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeNote"]
  ) {
    return execution.resultPayload["routeNote"] as any;
  }

  try {
    const { data: stop, error: stopError } = await input.db
      .from("hpo_route_stops")
      .select("*")
      .eq("id", input.stopId)
      .eq("user_id", input.userId)
      .single();
    if (stopError || !stop)
      throw stopError ?? new Error("Route stop not found.");

    const now = new Date().toISOString();
    const currentMetadata =
      stop.metadata &&
      typeof stop.metadata === "object" &&
      !Array.isArray(stop.metadata)
        ? stop.metadata
        : {};
    const previousStopNote = clean(stop.notes);
    const noteSourceRef = `route_note:${stop.id}`;

    let existingInteraction: any = null;
    if (stop.account_id) {
      const storedInteractionId =
        typeof currentMetadata["route_note_interaction_id"] === "string"
          ? currentMetadata["route_note_interaction_id"]
          : null;

      if (storedInteractionId) {
        const lookup = await input.db
          .from("hpo_interactions")
          .select("*")
          .eq("id", storedInteractionId)
          .eq("user_id", input.userId)
          .eq("account_id", stop.account_id)
          .maybeSingle();
        if (lookup.error) throw lookup.error;
        existingInteraction = lookup.data ?? null;
      }

      if (!existingInteraction) {
        const lookup = await input.db
          .from("hpo_interactions")
          .select("*")
          .eq("user_id", input.userId)
          .eq("account_id", stop.account_id)
          .eq("interaction_type", "note")
          .eq("source_type", "route")
          .in("source_ref", [noteSourceRef, stop.id])
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lookup.error) throw lookup.error;
        existingInteraction = lookup.data ?? null;
      }
    }

    const savedAt =
      existingInteraction?.occurred_at ||
      (typeof currentMetadata["route_note_saved_at"] === "string"
        ? currentMetadata["route_note_saved_at"]
        : now);
    const hasCanonicalFieldNote =
      Boolean(existingInteraction) ||
      currentMetadata["route_note_locked"] === true ||
      typeof currentMetadata["route_note_interaction_id"] === "string";
    const isEdit = hasCanonicalFieldNote;
    const legacyVisitSummary =
      !hasCanonicalFieldNote &&
      previousStopNote &&
      !clean(stop.visit_summary)
        ? previousStopNote
        : null;
    let interactionId: string | null = existingInteraction?.id ?? null;

    if (stop.account_id) {
      const interactionMetadata = {
        ...(existingInteraction?.metadata &&
        typeof existingInteraction.metadata === "object" &&
        !Array.isArray(existingInteraction.metadata)
          ? existingInteraction.metadata
          : {}),
        route_id: stop.route_id,
        route_stop_id: stop.id,
        note_only: true,
        field_note: true,
        note_saved_at: savedAt,
        note_updated_at: now,
        source_channel: input.sourceChannel ?? "ui",
        source_message_id: input.sourceMessageId ?? null,
        non_phi: true,
      };

      if (existingInteraction?.id) {
        const updatedInteraction = await input.db
          .from("hpo_interactions")
          .update({
            summary: note,
            source_ref: noteSourceRef,
            metadata: interactionMetadata,
          })
          .eq("id", existingInteraction.id)
          .eq("user_id", input.userId)
          .eq("account_id", stop.account_id)
          .select("id")
          .single();
        if (updatedInteraction.error) throw updatedInteraction.error;
        interactionId = updatedInteraction.data?.id ?? existingInteraction.id;
      } else {
        const insertedInteraction = await input.db
          .from("hpo_interactions")
          .insert({
            user_id: input.userId,
            account_id: stop.account_id,
            interaction_type: "note",
            occurred_at: savedAt,
            summary: note,
            source_type: "route",
            source_ref: noteSourceRef,
            metadata: interactionMetadata,
          })
          .select("id")
          .single();
        if (insertedInteraction.error) throw insertedInteraction.error;
        interactionId = insertedInteraction.data?.id ?? null;
      }
    }

    const stopMetadata = {
      ...currentMetadata,
      route_note_interaction_id: interactionId,
      route_note_saved_at: savedAt,
      route_note_updated_at: now,
      route_note_version:
        Math.max(0, Number(currentMetadata["route_note_version"] ?? 0)) + 1,
      route_note_locked: true,
    };

    const { data: updatedStop, error: updateError } = await input.db
      .from("hpo_route_stops")
      .update({
        notes: note,
        ...(legacyVisitSummary ? { visit_summary: legacyVisitSummary } : {}),
        metadata: stopMetadata,
        updated_at: now,
      })
      .eq("id", stop.id)
      .eq("user_id", input.userId)
      .select("*")
      .single();
    if (updateError) throw updateError;

    if (stop.account_id) {
      const { data: accountRow, error: accountLoadError } = await input.db
        .from("hpo_accounts")
        .select("metadata,last_touch_at")
        .eq("id", stop.account_id)
        .eq("user_id", input.userId)
        .maybeSingle();
      if (accountLoadError) throw accountLoadError;

      const accountMetadata =
        accountRow?.metadata &&
        typeof accountRow.metadata === "object" &&
        !Array.isArray(accountRow.metadata)
          ? accountRow.metadata
          : {};
      const previousLatestAt =
        typeof accountMetadata["latest_field_note_at"] === "string"
          ? accountMetadata["latest_field_note_at"]
          : null;
      const shouldSetLatest =
        !previousLatestAt ||
        Number.isNaN(Date.parse(previousLatestAt)) ||
        Date.parse(savedAt) >= Date.parse(previousLatestAt);
      const nextMetadata = shouldSetLatest
        ? {
            ...accountMetadata,
            latest_field_note_at: savedAt,
            latest_field_note_updated_at: now,
            latest_field_note_interaction_id: interactionId,
            latest_field_note_route_id: stop.route_id,
            latest_field_note_route_stop_id: stop.id,
            latest_field_note_summary: note,
          }
        : accountMetadata;

      const currentLastTouch = Date.parse(accountRow?.last_touch_at ?? "");
      const noteTouch = Date.parse(savedAt);
      const { error: accountError } = await input.db
        .from("hpo_accounts")
        .update({
          metadata: nextMetadata,
          last_touch_at:
            Number.isFinite(noteTouch) &&
            (!Number.isFinite(currentLastTouch) || noteTouch > currentLastTouch)
              ? savedAt
              : accountRow?.last_touch_at ?? null,
          updated_at: now,
        })
        .eq("id", stop.account_id)
        .eq("user_id", input.userId);
      if (accountError) throw accountError;
    } else if (stop.prospect_id) {
      const { data: prospect, error: prospectError } = await input.db
        .from("hpo_prospects")
        .select("metadata")
        .eq("id", stop.prospect_id)
        .eq("user_id", input.userId)
        .maybeSingle();
      if (prospectError) throw prospectError;

      const prospectMetadata =
        prospect?.metadata &&
        typeof prospect.metadata === "object" &&
        !Array.isArray(prospect.metadata)
          ? prospect.metadata
          : {};
      const { error: updateProspectError } = await input.db
        .from("hpo_prospects")
        .update({
          metadata: {
            ...prospectMetadata,
            latest_field_note_at: savedAt,
            latest_field_note_updated_at: now,
            latest_field_note_route_id: stop.route_id,
            latest_field_note_route_stop_id: stop.id,
            latest_field_note_summary: note,
          },
          updated_at: now,
        })
        .eq("id", stop.prospect_id)
        .eq("user_id", input.userId);
      if (updateProspectError) throw updateProspectError;
    }

    const result = {
      ok: true,
      routeId: stop.route_id,
      stopId: stop.id,
      accountId: stop.account_id ?? null,
      prospectId: stop.prospect_id ?? null,
      officeName: stop.office_name ?? null,
      note,
      interactionId,
      savedAt,
      updatedAt: now,
      isEdit,
      stop: updatedStop,
    };

    await completeExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      resultPayload: { routeNote: result },
      targetType: "hpo_route_stop",
      targetId: stop.id,
    });

    return result;
  } catch (error) {
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      errorCode: "hpo_route_stop_note_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

export const addHpoRouteStopNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      stopId: string;
      note: string;
      idempotencyKey?: string | null;
      sourceChannel?: string | null;
    }) => ({
      stopId: clean(input.stopId),
      note: clean(input.note),
      idempotencyKey: clean(input.idempotencyKey) || null,
      sourceChannel: clean(input.sourceChannel) || "ui",
    }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const idempotencyKey =
      data.idempotencyKey ??
      `ui:${crypto.randomUUID()}:hpo.route_stop.add_note`;
    const saved = await addHpoRouteStopNoteCore({
      db,
      userId: context.userId,
      stopId: data.stopId,
      note: data.note,
      idempotencyKey,
      sourceChannel: data.sourceChannel,
    });

    let routeStatus: string | null = null;
    try {
      const { data: currentStop, error: currentStopError } = await db
        .from("hpo_route_stops")
        .select("id,status,visited_at")
        .eq("id", saved.stopId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (currentStopError) throw currentStopError;
      if (currentStop && ["planned", "arrived"].includes(String(currentStop.status))) {
        const nowIso = new Date().toISOString();
        const { error: visitError } = await db
          .from("hpo_route_stops")
          .update({
            status: "visited",
            visited_at: currentStop.visited_at ?? saved.savedAt ?? nowIso,
            updated_at: nowIso,
          })
          .eq("id", saved.stopId)
          .eq("user_id", context.userId);
        if (visitError) throw visitError;
      }
      if (saved.routeId) {
        routeStatus = await syncRouteStatus(db, context.userId, saved.routeId);
      }
    } catch (error) {
      console.error("Saved HPO note visit status update failed", error);
    }

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      return {
        ...saved,
        routeStatus,
        intelligence: {
          analyzed: false,
          nextAction: null,
          nextActionDueAt: null,
          calendarEvent: null,
          calendarClarification: null,
          error: "ai_service_not_configured",
        },
      };
    }

    try {
      const intelligence = await applySavedHpoNoteIntelligence({
        db,
        userId: context.userId,
        apiKey,
        idempotencyKey,
        saved,
      });
      return { ...saved, routeStatus, intelligence };
    } catch (error) {
      console.error("Saved HPO note intelligence failed", error);
      return {
        ...saved,
        routeStatus,
        intelligence: {
          analyzed: false,
          nextAction: null,
          nextActionDueAt: null,
          calendarEvent: null,
          calendarClarification: null,
          error: "saved_note_intelligence_failed",
        },
      };
    }
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
      idempotencyKey?: string | null;
      sourceChannel?: string | null;
      baseUpdatedAt?: string | null;
    }) => {
      const status = clean(input.status) || null;
      const allowed = new Set([
        "planned",
        "arrived",
        "completed",
        "visited",
        "skipped",
        "closed",
        "bad_address",
      ]);
      if (status && !allowed.has(status))
        throw new Error("Unsupported stop status");
      return {
        stopId: clean(input.stopId),
        status,
        notes: input.notes == null ? undefined : clean(input.notes),
        visitOutcome:
          input.visitOutcome == null ? undefined : clean(input.visitOutcome),
        nextAction:
          input.nextAction == null ? undefined : clean(input.nextAction),
        nextActionDueAt:
          input.nextActionDueAt &&
          !Number.isNaN(Date.parse(input.nextActionDueAt))
            ? new Date(input.nextActionDueAt).toISOString()
            : input.nextActionDueAt === null
              ? null
              : undefined,
        idempotencyKey: clean(input.idempotencyKey) || null,
        sourceChannel: clean(input.sourceChannel) || "ui",
        baseUpdatedAt:
          input.baseUpdatedAt && !Number.isNaN(Date.parse(input.baseUpdatedAt))
            ? new Date(input.baseUpdatedAt).toISOString()
            : null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    if (data.status && TERMINAL.has(data.status)) {
      const key =
        data.idempotencyKey ||
        `ui:${crypto.randomUUID()}:hpo.route_stop.log_visit`;
      const hasVisitContent =
        data.notes !== undefined ||
        data.visitOutcome !== undefined ||
        data.nextAction !== undefined ||
        data.nextActionDueAt !== undefined;
      if (hasVisitContent) {
        return executeHpoRouteStopVisitCore({
          db,
          userId: context.userId,
          stopId: data.stopId,
          status: data.status as
            "completed" | "visited" | "closed" | "bad_address" | "skipped",
          notes: data.notes ?? "",
          visitOutcome: data.visitOutcome,
          nextAction: data.nextAction,
          nextActionDueAt: data.nextActionDueAt,
          idempotencyKey: key,
          sourceChannel: data.sourceChannel,
          baseUpdatedAt: data.baseUpdatedAt,
        });
      }
      return executeHpoRouteStopOutcomeCore({
        db,
        userId: context.userId,
        stopId: data.stopId,
        status: data.status as
          "completed" | "visited" | "closed" | "bad_address" | "skipped",
        idempotencyKey: key,
        sourceChannel: data.sourceChannel,
        baseUpdatedAt: data.baseUpdatedAt,
      });
    }
    const { data: stop, error: fetchError } = await db
      .from("hpo_route_stops")
      .select("*")
      .eq("id", data.stopId)
      .eq("user_id", context.userId)
      .single();
    if (fetchError || !stop)
      throw fetchError ?? new Error("Route stop not found");
    if (
      data.baseUpdatedAt &&
      !Number.isNaN(Date.parse(data.baseUpdatedAt)) &&
      !Number.isNaN(Date.parse(stop.updated_at)) &&
      Date.parse(stop.updated_at) > Date.parse(data.baseUpdatedAt) + 1000
    ) {
      throw new Error(
        "offline_conflict: This stop changed after the offline snapshot. Refresh before retrying.",
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.status) {
      patch["status"] = data.status;
      if (TERMINAL.has(data.status) && !stop.visited_at)
        patch["visited_at"] = new Date().toISOString();
    }
    if (data.notes !== undefined) {
      const stopMetadata =
        stop.metadata &&
        typeof stop.metadata === "object" &&
        !Array.isArray(stop.metadata)
          ? stop.metadata
          : {};
      const hasLockedFieldNote =
        stopMetadata["route_note_locked"] === true && Boolean(clean(stop.notes));
      if (!hasLockedFieldNote) {
        patch["notes"] = data.notes || null;
      }
      patch["visit_summary"] = data.notes || null;
    }
    if (data.visitOutcome !== undefined)
      patch["visit_outcome"] = data.visitOutcome || null;
    if (data.nextAction !== undefined)
      patch["next_action"] = data.nextAction || null;
    if (data.nextActionDueAt !== undefined)
      patch["next_action_due_at"] = data.nextActionDueAt;

    const { data: updated, error } = await db
      .from("hpo_route_stops")
      .update(patch)
      .eq("id", stop.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw error;

    const interactionStatus = String(
      data.status ?? stop.status ?? updated.status,
    );
    if (TERMINAL.has(interactionStatus)) {
      await upsertInteractionForStop(db, context.userId, updated, {
        notes:
          data.notes ??
          updated.visit_summary ??
          (updated.metadata?.route_note_locked ? null : updated.notes),
        visitOutcome: data.visitOutcome ?? updated.visit_outcome,
        nextAction: data.nextAction ?? updated.next_action,
        nextActionDueAt: data.nextActionDueAt ?? updated.next_action_due_at,
        status: data.status ?? updated.status,
      });
    }

    const routeStatus = await syncRouteStatus(
      db,
      context.userId,
      stop.route_id,
    );
    return { stop: updated, routeStatus };
  });

export const setHpoRouteStopFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      stopId: string;
      nextAction: string;
      nextActionDueAt?: string | null;
      idempotencyKey?: string | null;
      sourceChannel?: string | null;
      baseUpdatedAt?: string | null;
    }) => ({
      stopId: clean(input.stopId),
      nextAction: clean(input.nextAction),
      nextActionDueAt:
        input.nextActionDueAt &&
        !Number.isNaN(Date.parse(input.nextActionDueAt))
          ? new Date(input.nextActionDueAt).toISOString()
          : input.nextActionDueAt === null
            ? null
            : undefined,
      idempotencyKey: clean(input.idempotencyKey) || null,
      sourceChannel: clean(input.sourceChannel) || "ui",
      baseUpdatedAt:
        input.baseUpdatedAt && !Number.isNaN(Date.parse(input.baseUpdatedAt))
          ? new Date(input.baseUpdatedAt).toISOString()
          : null,
    }),
  )
  .handler(async ({ data, context }) =>
    executeHpoRouteStopFollowupCore({
      db: context.supabase as any,
      userId: context.userId,
      stopId: data.stopId,
      nextAction: data.nextAction,
      nextActionDueAt: data.nextActionDueAt,
      idempotencyKey:
        data.idempotencyKey ||
        `ui:${crypto.randomUUID()}:hpo.route_stop.set_followup`,
      sourceChannel: data.sourceChannel,
      baseUpdatedAt: data.baseUpdatedAt,
    }),
  );

export async function captureHpoRouteNoteCore(input: {
  db: any;
  userId: string;
  routeId: string;
  message: string;
  idempotencyKey?: string | null;
  sourceChannel?: string | null;
  sourceMessageId?: string | null;
  preferredStopId?: string | null;
}) {
  const message = clean(input.message);
  if (!message) throw new Error("Tell Emery what happened at the stop");
  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action: "capture_route_note",
    sourceMessageId: input.sourceMessageId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    targetType: "hpo_route",
    targetId: input.routeId,
    requestPayload: {
      routeId: input.routeId,
      message,
      sourceChannel: input.sourceChannel ?? "route_note",
      preferredStopId: input.preferredStopId ?? null,
    },
  });
  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeNoteResult"]
  ) {
    return execution.resultPayload["routeNoteResult"] as any;
  }
  const { data: stops, error } = await input.db
    .from("hpo_route_stops")
    .select("*")
    .eq("route_id", input.routeId)
    .eq("user_id", input.userId)
    .order("stop_order", { ascending: true });
  if (error) throw error;
  const rows = stops ?? [];
  if (!rows.length) throw new Error("This route has no stops");

  const { data: routeRecord, error: routeRecordError } = await input.db
    .from("hpo_route_plans")
    .select("id,metadata")
    .eq("id", input.routeId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (routeRecordError) throw routeRecordError;
  const routeMetadata =
    routeRecord?.metadata &&
    typeof routeRecord.metadata === "object" &&
    !Array.isArray(routeRecord.metadata)
      ? routeRecord.metadata
      : {};
  const fieldSession =
    routeMetadata.field_session &&
    typeof routeMetadata.field_session === "object" &&
    !Array.isArray(routeMetadata.field_session)
      ? routeMetadata.field_session
      : {};
  const armedStopId =
    typeof fieldSession.expected_note_target_stop_id === "string" &&
    fieldSession.expected_note_target_stop_id
      ? fieldSession.expected_note_target_stop_id
      : null;

  const numberMatch = message.match(/\bstop\s*#?\s*(\d{1,2})\b/i);
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
  const ordinalMatch = message
    .toLowerCase()
    .match(
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

  if (!target && /\b(next stop|next office)\b/i.test(message)) {
    target = rows.find((row: any) => !TERMINAL.has(row.status)) ?? null;
  }

  if (!target) {
    const messageNorm = normalize(message);
    let best: { row: any; score: number } | null = null;
    for (const row of rows) {
      const office = normalize(row.office_name ?? "");
      if (!office) continue;
      if (messageNorm.includes(office)) {
        target = row;
        break;
      }
      const tokens = office.split(" ").filter((token) => token.length >= 4);
      const matched = tokens.filter((token) =>
        messageNorm.includes(token),
      ).length;
      const score = tokens.length ? matched / tokens.length : 0;
      if (!best || score > best.score) best = { row, score };
    }
    if (!target && best && best.score >= 0.5) target = best.row;
  }

  if (!target && input.preferredStopId) {
    target =
      rows.find(
        (row: any) =>
          row.id === input.preferredStopId && !TERMINAL.has(String(row.status)),
      ) ?? null;
  }

  if (!target && armedStopId) {
    target =
      rows.find(
        (row: any) =>
          row.id === armedStopId && !TERMINAL.has(String(row.status)),
      ) ?? null;
  }

  if (!target) {
    const active = rows.filter((row: any) => !TERMINAL.has(row.status));
    if (active.length === 1) target = active[0];
  }

  if (!target) {
    const result = {
      ok: false,
      needsClarification: true,
      question:
        "Which stop is this note for? You can say the stop number or office name.",
    } as const;
    await clarifyExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      question: result.question,
      resultPayload: {
        routeNoteResult: result as unknown as Record<string, unknown>,
      },
    });
    return result;
  }

  const status = inferStatus(message);
  const visitOutcome = inferOutcome(message);
  const nextAction = extractNextAction(message);
  const timezone = await getTimezone(input.db, input.userId);
  const parsedNextActionDueAt = nextAction
    ? followupDueFromNote(message, timezone)
    : null;
  const visitExecution = await executeHpoRouteStopVisitCore({
    db: input.db,
    userId: input.userId,
    stopId: target.id,
    status: status as
      "completed" | "visited" | "closed" | "bad_address" | "skipped",
    notes: message,
    visitOutcome,
    nextAction,
    nextActionDueAt: parsedNextActionDueAt ?? target.next_action_due_at ?? null,
    idempotencyKey: `route-note:${execution.id}:${target.id}:hpo.route_stop.log_visit`,
    sourceChannel: input.sourceChannel ?? "voice_or_route_note",
    sourceMessageId: input.sourceMessageId ?? null,
    parentRunId: execution.id,
    traceId: input.sourceMessageId ?? execution.id,
    createFollowupTask:
      Boolean(nextAction) &&
      /\b(add it|add that|make (?:that|it) a task|create (?:a )?task|add (?:a )?task|put (?:that|it) (?:in|on) (?:my )?task)/i.test(
        message,
      ),
  });
  const updated = visitExecution.stop;
  const routeStatus = visitExecution.routeStatus;

  if (armedStopId && updated.id === armedStopId) {
    const { error: consumeError } = await input.db.rpc(
      "emery_hpo_consume_field_note_target",
      {
        p_route_id: input.routeId,
        p_stop_id: updated.id,
      },
    );
    if (consumeError) {
      console.error(
        "Field-session note target could not be consumed",
        consumeError,
      );
    }
  }

  const result = {
    ok: true,
    needsClarification: false,
    stopId: updated.id,
    stopOrder: updated.stop_order,
    officeName: updated.office_name,
    status: updated.status,
    visitOutcome,
    nextAction,
    nextActionDueAt: parsedNextActionDueAt ?? target.next_action_due_at ?? null,
    followupTaskId: visitExecution.followupTaskId ?? null,
    executionRunId: execution.id,
    routeStatus,
  } as const;
  await completeExecution({
    db: input.db,
    userId: input.userId,
    runId: execution.id,
    resultPayload: {
      routeNoteResult: result as unknown as Record<string, unknown>,
    },
    targetType: "hpo_route_stop",
    targetId: updated.id,
  });
  return result;
}

export const captureHpoRouteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string; message: string }) => ({
    routeId: clean(input.routeId),
    message: clean(input.message),
  }))
  .handler(async ({ data, context }) =>
    captureHpoRouteNoteCore({
      db: context.supabase as any,
      userId: context.userId,
      routeId: data.routeId,
      message: data.message,
      idempotencyKey: `ui:${crypto.randomUUID()}:hpo.route_stop.log_visit`,
      sourceChannel: "ui",
    }),
  );

export async function executeHpoRouteSyncCalendarCore(input: {
  db: any;
  userId: string;
  routeId: string;
  idempotencyKey: string;
  sourceChannel: string;
  sourceMessageId?: string | null;
}) {
  const action = "hpo.route.sync_calendar";
  const execution = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_route",
    action,
    sourceMessageId: input.sourceMessageId ?? null,
    idempotencyKey: input.idempotencyKey,
    targetType: "hpo_route",
    targetId: input.routeId,
    requestPayload: {
      capability: action,
      routeId: input.routeId,
      sourceChannel: input.sourceChannel,
    },
  });
  if (
    execution.reused &&
    execution.status === "completed" &&
    execution.resultPayload["routeCalendarSync"]
  ) {
    return execution.resultPayload["routeCalendarSync"] as {
      ok: true;
      action: string;
      executionRunId: string;
      routeId: string;
      eventId: string;
      calendarAction: "created" | "updated";
      start: string;
      end: string;
      reused: boolean;
    };
  }

  try {
    const db = input.db;
    const { data: route, error } = await db
      .from("hpo_route_plans")
      .select("id,route_date,area,start_window,end_window")
      .eq("id", input.routeId)
      .eq("user_id", input.userId)
      .single();
    if (error || !route) throw error ?? new Error("Route not found");
    if (!route.start_window || !route.end_window) {
      throw new Error("Set a route start and end time first.");
    }

    const timezone = await getTimezone(db, input.userId);
    const start = zonedDateTimeToUtc(
      route.route_date,
      route.start_window,
      timezone,
    );
    const end = zonedDateTimeToUtc(
      route.route_date,
      route.end_window,
      timezone,
    );
    if (Date.parse(end) <= Date.parse(start)) {
      throw new Error("Route end time must be after the start time.");
    }

    const title = `HPO Marketing Route — ${route.area || "Field Marketing"}`;
    const metadata = {
      domain: "hpo",
      hpo: true,
      event_type: "field_route",
      hpo_route_id: route.id,
      source_type: "route_planner",
      execution_run_id: execution.id,
      source_channel: input.sourceChannel,
    };

    const { data: existing, error: existingError } = await db
      .from("meetings")
      .select("id")
      .eq("user_id", input.userId)
      .contains("metadata", { hpo_route_id: route.id })
      .maybeSingle();
    if (existingError) throw existingError;

    let eventId: string;
    let calendarAction: "created" | "updated";
    if (existing?.id) {
      const { data: updated, error: updateError } = await db
        .from("meetings")
        .update({ title, meeting_at: start, end_at: end, metadata })
        .eq("id", existing.id)
        .eq("user_id", input.userId)
        .select("id,meeting_at,end_at,metadata")
        .single();
      if (
        updateError ||
        !updated ||
        updated.meeting_at !== start ||
        updated.end_at !== end ||
        updated.metadata?.hpo_route_id !== route.id
      ) {
        throw (
          updateError ?? new Error("Route Calendar update verification failed")
        );
      }
      eventId = updated.id;
      calendarAction = "updated";
    } else {
      const { data: meeting, error: insertError } = await db
        .from("meetings")
        .insert({
          user_id: input.userId,
          title,
          meeting_at: start,
          end_at: end,
          participants: [],
          metadata,
        })
        .select("id,meeting_at,end_at,metadata")
        .single();
      if (
        insertError ||
        !meeting ||
        meeting.meeting_at !== start ||
        meeting.end_at !== end ||
        meeting.metadata?.hpo_route_id !== route.id
      ) {
        throw (
          insertError ??
          new Error("Route Calendar creation verification failed")
        );
      }
      eventId = meeting.id;
      calendarAction = "created";
    }

    const result = {
      ok: true as const,
      action,
      executionRunId: execution.id,
      routeId: route.id,
      eventId,
      calendarAction,
      start,
      end,
      reused: execution.reused,
    };
    await completeExecution({
      db,
      userId: input.userId,
      runId: execution.id,
      resultPayload: {
        routeCalendarSync: result as unknown as Record<string, unknown>,
      },
      targetType: "meeting",
      targetId: eventId,
    });
    return result;
  } catch (error) {
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: execution.id,
      errorCode: "hpo_route_sync_calendar_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
    }).catch(() => undefined);
    throw error;
  }
}

export const syncHpoRouteToCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      routeId: string;
      idempotencyKey?: string | null;
      sourceChannel?: string | null;
    }) => ({
      routeId: clean(input.routeId),
      idempotencyKey: clean(input.idempotencyKey) || null,
      sourceChannel: clean(input.sourceChannel) || "ui",
    }),
  )
  .handler(async ({ data, context }) =>
    executeHpoRouteSyncCalendarCore({
      db: context.supabase as any,
      userId: context.userId,
      routeId: data.routeId,
      idempotencyKey:
        data.idempotencyKey ||
        `ui:${crypto.randomUUID()}:hpo.route.sync_calendar`,
      sourceChannel: data.sourceChannel,
    }),
  );

export const getHpoRouteScheduleAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { routeId: string }) => ({
    routeId: clean(input.routeId),
  }))
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
      .select(
        "stop_order,office_name,address,city,status,visit_priority,drive_seconds_from_previous",
      )
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
        .select(
          "title,due_at,scheduled_start_at,scheduled_end_at,priority,status,metadata",
        )
        .eq("user_id", context.userId)
        .neq("status", "completed")
        .not("scheduled_start_at", "is", null)
        .order("scheduled_start_at", { ascending: true })
        .limit(300),
    ]);

    const calendar = [
      ...(meetings ?? [])
        .filter(
          (item: any) =>
            localDateKey(item.meeting_at, timezone) === route.route_date,
        )
        .map((item: any) => ({
          kind: "event",
          title: item.title,
          start: localClock(item.meeting_at, timezone),
          end: localClock(item.end_at, timezone),
        })),
      ...(tasks ?? [])
        .filter(
          (item: any) =>
            localDateKey(item.scheduled_start_at, timezone) ===
            route.route_date,
        )
        .map((item: any) => ({
          kind: "task",
          title: item.title,
          at: localClock(item.scheduled_start_at, timezone),
          end: localClock(item.scheduled_end_at, timezone),
          deadline: item.due_at,
          priority: item.priority,
        })),
    ];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
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
    if (!response.ok)
      throw new Error("Emery could not review the route schedule right now.");
    return { advice: responseText(await response.json()) };
  });
