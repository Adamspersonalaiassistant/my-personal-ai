/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  executeHpoRouteCreateCore,
  executeHpoRouteOptimizeCore,
} from "@/lib/hpo-route.functions";
import {
  executeHpoRouteAddStopsCore,
  executeHpoRouteRemoveStopCore,
  executeHpoRouteReoptimizeCore,
} from "@/lib/hpo-field.functions";

export type HpoRouteCommandAction =
  | "none"
  | "hpo.route.create"
  | "hpo.route.add_stops"
  | "hpo.route.remove_stop"
  | "hpo.route.optimize"
  | "hpo.route.reoptimize";

export type HpoRouteCommandResult = {
  recognized: boolean;
  performed: boolean;
  needsClarification: boolean;
  question: string | null;
  action: HpoRouteCommandAction;
  routeId: string | null;
  executionRunId: string | null;
  reply: string | null;
  error: string | null;
};

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localDateParts(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

function dateKey(timeZone: string, offsetDays = 0) {
  const now = new Date();
  const anchor = new Date(now.getTime() + offsetDays * 86400000);
  const parts = localDateParts(timeZone, anchor);
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

const weekdayIndex: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function resolveDate(message: string, timeZone: string) {
  const text = normalize(message);
  const explicit = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (explicit) return explicit[0];
  if (/\btomorrow\b/.test(text)) return dateKey(timeZone, 1);
  if (/\btoday\b/.test(text)) return dateKey(timeZone, 0);

  const weekday = Object.keys(weekdayIndex).find((day) => text.includes(day));
  if (weekday) {
    const currentParts = localDateParts(timeZone);
    const current = weekdayIndex[String(currentParts["weekday"] ?? "").toLowerCase()] ?? new Date().getDay();
    const target = weekdayIndex[weekday]!;
    let offset = (target - current + 7) % 7;
    if (offset === 0 || text.includes(`next ${weekday}`)) offset += 7;
    return dateKey(timeZone, offset);
  }
  return null;
}

function clockValue(hourRaw: string, minuteRaw: string | undefined, meridiem: string | undefined) {
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? 0);
  const suffix = String(meridiem ?? "").toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (!suffix && hour >= 1 && hour <= 6) hour += 12;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function resolveWindow(message: string) {
  const match = message.match(
    /\bfrom\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:to|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );
  if (!match) return { startWindow: null, endWindow: null };
  let start = clockValue(match[1]!, match[2], match[3]);
  let end = clockValue(match[4]!, match[5], match[6]);
  if (start && end && !match[3] && !match[6]) {
    const startHour = Number(start.slice(0, 2));
    let endHour = Number(end.slice(0, 2));
    if (endHour <= startHour && endHour < 12) {
      endHour += 12;
      end = `${String(endHour).padStart(2, "0")}:${end.slice(3)}`;
    }
  }
  return { startWindow: start, endWindow: end };
}

function nameScore(needle: string, name: string) {
  const a = normalize(needle);
  const b = normalize(name);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 85;
  const tokens = a.split(" ").filter((token) => token.length >= 3);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => b.includes(token)).length;
  return Math.round((hits / tokens.length) * 70);
}

async function activeRoute(db: any, userId: string, timeZone: string) {
  const today = dateKey(timeZone);
  const { data, error } = await db
    .from("hpo_route_plans")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "in_progress", "planned", "draft"])
    .gte("route_date", today)
    .order("route_date", { ascending: true })
    .limit(8);
  if (error) throw error;
  const rows = data ?? [];
  return (
    rows.find((route: any) => ["active", "in_progress"].includes(String(route.status))) ??
    rows.find((route: any) => route.route_date === today) ??
    rows[0] ??
    null
  );
}

async function routeStops(db: any, userId: string, routeId: string) {
  const { data, error } = await db
    .from("hpo_route_stops")
    .select("*")
    .eq("user_id", userId)
    .eq("route_id", routeId)
    .order("stop_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function findOffice(db: any, userId: string, phrase: string) {
  const [accounts, prospects] = await Promise.all([
    db
      .from("hpo_accounts")
      .select("id,name,address,city,latitude,longitude,priority,status,tags")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("address", "is", null)
      .limit(300),
    db
      .from("hpo_prospects")
      .select("id,name,address,city,latitude,longitude,fit_status,verification_status,metadata")
      .eq("user_id", userId)
      .neq("fit_status", "rejected")
      .not("address", "is", null)
      .limit(300),
  ]);
  if (accounts.error) throw accounts.error;
  if (prospects.error) throw prospects.error;

  const candidates = [
    ...(accounts.data ?? [])
      .filter((row: any) => !(Array.isArray(row.tags) && row.tags.includes("exclude_from_adam_route")))
      .map((row: any) => ({
        score: nameScore(phrase, row.name),
        accountId: row.id,
        prospectId: null,
        officeName: row.name,
        address: row.address,
        city: row.city,
        latitude: row.latitude,
        longitude: row.longitude,
        visitPriority: Number(row.priority ?? 0) >= 4 ? "high" : null,
      })),
    ...(prospects.data ?? []).map((row: any) => ({
      score: nameScore(phrase, row.name),
      accountId: null,
      prospectId: row.id,
      officeName: row.name,
      address: row.address,
      city: row.city,
      latitude: row.latitude,
      longitude: row.longitude,
      visitPriority: Number(row.metadata?.internal_priority ?? 0) >= 4 ? "high" : null,
    })),
  ]
    .filter((row) => row.score >= 45)
    .sort((left, right) => right.score - left.score);

  if (!candidates.length) return { match: null, ambiguous: false };
  if (candidates.length > 1 && candidates[0]!.score - candidates[1]!.score < 10) {
    return { match: null, ambiguous: true };
  }
  return { match: candidates[0]!, ambiguous: false };
}

async function chooseRouteCandidates(db: any, userId: string, message: string, count: number) {
  const [accounts, prospects] = await Promise.all([
    db
      .from("hpo_accounts")
      .select("id,name,address,city,latitude,longitude,priority,last_touch_at,next_action,next_action_due_at,tags,status")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("address", "is", null)
      .limit(400),
    db
      .from("hpo_prospects")
      .select("id,name,address,city,latitude,longitude,fit_status,verification_status,metadata")
      .eq("user_id", userId)
      .neq("fit_status", "rejected")
      .not("address", "is", null)
      .limit(400),
  ]);
  if (accounts.error) throw accounts.error;
  if (prospects.error) throw prospects.error;

  const normalizedMessage = normalize(message);
  const cities = [
    ...new Set(
      [...(accounts.data ?? []), ...(prospects.data ?? [])]
        .map((row: any) => clean(row.city))
        .filter(Boolean),
    ),
  ];
  const matchedCities = cities.filter((city) => normalizedMessage.includes(normalize(city)));
  if (!matchedCities.length) return { candidates: [], area: null };

  const citySet = new Set(matchedCities.map((city) => normalize(city)));
  const now = Date.now();
  const candidates = [
    ...(accounts.data ?? [])
      .filter((row: any) => citySet.has(normalize(row.city ?? "")))
      .filter((row: any) => !(Array.isArray(row.tags) && row.tags.includes("exclude_from_adam_route")))
      .map((row: any) => {
        const overdue =
          row.next_action_due_at && !Number.isNaN(Date.parse(row.next_action_due_at))
            ? Date.parse(row.next_action_due_at) <= now
            : false;
        const daysSinceTouch = row.last_touch_at
          ? Math.max(0, Math.floor((now - Date.parse(row.last_touch_at)) / 86400000))
          : 120;
        const score =
          Number(row.priority ?? 3) * 12 +
          (overdue ? 35 : 0) +
          Math.min(30, Math.floor(daysSinceTouch / 10) * 3) +
          18;
        return {
          score,
          accountId: row.id,
          prospectId: null,
          officeName: row.name,
          address: row.address,
          city: row.city,
          latitude: row.latitude,
          longitude: row.longitude,
          visitPriority: Number(row.priority ?? 0) >= 4 ? "high" : null,
        };
      }),
    ...(prospects.data ?? [])
      .filter((row: any) => citySet.has(normalize(row.city ?? "")))
      .map((row: any) => {
        const priority = Number(row.metadata?.internal_priority ?? 2);
        const score =
          priority * 10 +
          (row.verification_status === "verified" ? 10 : 0) +
          (row.fit_status === "accepted" ? 14 : 0);
        return {
          score,
          accountId: null,
          prospectId: row.id,
          officeName: row.name,
          address: row.address,
          city: row.city,
          latitude: row.latitude,
          longitude: row.longitude,
          visitPriority: priority >= 4 ? "high" : null,
        };
      }),
  ]
    .filter((row) => row.address)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(30, count)));

  return { candidates, area: matchedCities.join("/") };
}

function requestedAction(message: string): HpoRouteCommandAction {
  const text = normalize(message);
  if (/\b(build|create|make)\b.*\broute\b/.test(text)) return "hpo.route.create";
  if (/\b(reoptimize|re optimize|fix (?:the )?(?:rest|remaining)|optimize (?:the )?(?:rest|remaining))\b/.test(text))
    return "hpo.route.reoptimize";
  if (/\boptimize\b/.test(text)) return "hpo.route.optimize";
  if (/\b(add|put)\b.+\b(?:route|stop|office)\b/.test(text) || /^add\s+/.test(text))
    return "hpo.route.add_stops";
  if (/\b(remove|take)\b.+\b(?:route|stop|office|out|off)\b/.test(text))
    return "hpo.route.remove_stop";
  return "none";
}

export async function processHpoRouteCommand(input: {
  db: any;
  userId: string;
  message: string;
  timezone: string;
  sourceMessageId?: string | null;
  sourceChannel: string;
}): Promise<HpoRouteCommandResult> {
  const action = requestedAction(input.message);
  const empty = (overrides: Partial<HpoRouteCommandResult> = {}): HpoRouteCommandResult => ({
    recognized: action !== "none",
    performed: false,
    needsClarification: false,
    question: null,
    action,
    routeId: null,
    executionRunId: null,
    reply: null,
    error: null,
    ...overrides,
  });
  if (action === "none") return empty({ recognized: false });

  try {
    if (action === "hpo.route.create") {
      const routeDate = resolveDate(input.message, input.timezone);
      if (!routeDate) {
        return empty({
          needsClarification: true,
          question: "What day should I build the HPO route for?",
          reply: "What day should I build the HPO route for?",
        });
      }
      const countMatch = input.message.match(/\b(\d{1,2})\s+(?:stops?|offices?)\b/i);
      const requestedCount = countMatch ? Number(countMatch[1]) : 12;
      const selected = await chooseRouteCandidates(
        input.db,
        input.userId,
        input.message,
        requestedCount,
      );
      if (!selected.area) {
        return empty({
          needsClarification: true,
          question: "Which city or HPO territory should I build the route around?",
          reply: "Which city or HPO territory should I build the route around?",
        });
      }
      if (!selected.candidates.length) {
        return empty({
          needsClarification: true,
          question: `I don't have eligible saved offices mapped in ${selected.area} yet. Want to choose the stops manually from Map?`,
          reply: `I don't have eligible saved offices mapped in ${selected.area} yet. Want to choose the stops manually from Map?`,
        });
      }
      const window = resolveWindow(input.message);
      const created = await executeHpoRouteCreateCore({
        db: input.db,
        userId: input.userId,
        payload: {
          routeDate,
          area: selected.area,
          startWindow: window.startWindow,
          endWindow: window.endWindow,
          syncToCalendar: /\b(calendar|schedule it|put .* calendar)\b/i.test(input.message),
          stops: selected.candidates,
          idempotencyKey: input.sourceMessageId
            ? `message:${input.sourceMessageId}:hpo.route.create`
            : `hpo-route:${routeDate}:${normalize(selected.area)}:create`,
          sourceChannel: input.sourceChannel,
          sourceMessageId: input.sourceMessageId ?? null,
        },
      });
      const optimized = await executeHpoRouteOptimizeCore({
        db: input.db,
        userId: input.userId,
        routeId: created.routeId,
        idempotencyKey: input.sourceMessageId
          ? `message:${input.sourceMessageId}:hpo.route.optimize`
          : `route:${created.routeId}:initial-optimize`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: created.routeId,
        executionRunId: created.executionRunId,
        reply: `Your ${selected.area} route is saved for ${routeDate} with ${created.stopCount} stops. I optimized it to about ${optimized.driveMinutes} minutes of driving across ${optimized.distanceMiles.toFixed(1)} miles.`,
      });
    }

    const route = await activeRoute(input.db, input.userId, input.timezone);
    if (!route) {
      return empty({
        needsClarification: true,
        question: "You don't have an active HPO route to change. Build or open a route first.",
        reply: "You don't have an active HPO route to change. Build or open a route first.",
      });
    }

    if (action === "hpo.route.optimize") {
      const result = await executeHpoRouteOptimizeCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        idempotencyKey: input.sourceMessageId
          ? `message:${input.sourceMessageId}:hpo.route.optimize`
          : `route:${route.id}:optimize:${Date.now()}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId,
        reply: `Route optimized. ${result.stopCount} stops · about ${result.driveMinutes} minutes of driving · ${result.distanceMiles.toFixed(1)} miles.`,
      });
    }

    if (action === "hpo.route.reoptimize") {
      const result = await executeHpoRouteReoptimizeCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        idempotencyKey: input.sourceMessageId
          ? `message:${input.sourceMessageId}:hpo.route.reoptimize`
          : `route:${route.id}:reoptimize:${Date.now()}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId,
        reply: `I reoptimized the remaining ${result.remaining} stop${result.remaining === 1 ? "" : "s"} without changing completed history. About ${result.driveMinutes} minutes of driving remain.`,
      });
    }

    const stops = await routeStops(input.db, input.userId, route.id);

    if (action === "hpo.route.remove_stop") {
      const text = normalize(input.message);
      let stop: any | null = null;
      if (/\b(last|last office|last stop)\b/.test(text)) {
        stop = [...stops].reverse().find((row: any) => !TERMINAL.has(String(row.status))) ?? null;
      } else {
        const ranked = stops
          .filter((row: any) => !TERMINAL.has(String(row.status)))
          .map((row: any) => ({ row, score: nameScore(input.message, row.office_name ?? "") }))
          .filter((item) => item.score >= 45)
          .sort((left, right) => right.score - left.score);
        if (ranked.length > 1 && ranked[0]!.score - ranked[1]!.score < 10) {
          return empty({
            needsClarification: true,
            question: "Which route stop should I remove?",
            reply: "Which route stop should I remove?",
          });
        }
        stop = ranked[0]?.row ?? null;
      }
      if (!stop) {
        return empty({
          needsClarification: true,
          question: "Which route stop should I remove?",
          reply: "Which route stop should I remove?",
        });
      }
      const result = await executeHpoRouteRemoveStopCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        stopId: stop.id,
        idempotencyKey: input.sourceMessageId
          ? `message:${input.sourceMessageId}:hpo.route.remove_stop:${stop.id}`
          : `route:${route.id}:remove:${stop.id}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId,
        reply: `Removed ${result.officeName || stop.office_name} from the open route. Completed route history was not touched.`,
      });
    }

    if (action === "hpo.route.add_stops") {
      const match = await findOffice(input.db, input.userId, input.message);
      if (match.ambiguous) {
        return empty({
          needsClarification: true,
          question: "I found more than one matching HPO office. Which one do you want to add?",
          reply: "I found more than one matching HPO office. Which one do you want to add?",
        });
      }
      if (!match.match) {
        return empty({
          needsClarification: true,
          question: "Which saved HPO office or prospect do you want to add?",
          reply: "Which saved HPO office or prospect do you want to add?",
        });
      }
      const result = await executeHpoRouteAddStopsCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        stops: [match.match],
        idempotencyKey: input.sourceMessageId
          ? `message:${input.sourceMessageId}:hpo.route.add_stops:${match.match.accountId ?? match.match.prospectId}`
          : `route:${route.id}:add:${match.match.accountId ?? match.match.prospectId}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId,
        reply: result.added?.length
          ? `Added ${match.match.officeName} to the route. Optimize or Fix Remaining when you want the driving order recalculated.`
          : `${match.match.officeName} is already on this route.`,
      });
    }

    return empty({ recognized: false });
  } catch (error) {
    return empty({
      error: error instanceof Error ? error.message : String(error),
      reply: null,
    });
  }
}
