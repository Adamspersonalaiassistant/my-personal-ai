/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  executeHpoRouteCreateCore,
  executeHpoRouteOptimizeCore,
  executeHpoRouteSyncCalendarCore,
} from "@/lib/hpo-route.functions";
import { beginExecution, completeExecution, failExecution } from "@/lib/execution-ledger";
import {
  executeHpoRouteAddStopsCore,
  executeHpoRouteCompleteCore,
  executeHpoRouteRemoveStopCore,
  executeHpoRouteReorderCore,
  executeHpoRouteReoptimizeCore,
  getHpoNearbyBackupsCore,
  getHpoRouteTrackerExportCore,
} from "@/lib/hpo-field.functions";

export type HpoRouteCommandAction =
  | "none"
  | "hpo.route.create"
  | "hpo.route.set_stops"
  | "hpo.route.add_stops"
  | "hpo.route.remove_stop"
  | "hpo.route.reorder"
  | "hpo.route.optimize"
  | "hpo.route.reoptimize"
  | "hpo.nearby.find"
  | "hpo.route.export"
  | "hpo.route.sync_calendar"
  | "hpo.route.complete";

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

function locationAwareOfficeScore(phrase: string, row: any) {
  const target = normalize(phrase);
  let score = nameScore(officeTargetPhrase(phrase) || phrase, clean(row.name));
  const address = normalize(clean(row.address));
  const city = normalize(clean(row.city));
  if (address && target.includes(address)) score += 60;
  else if (address) {
    const parts = address.split(" ").filter(Boolean);
    const house = parts.find((part) => /^\d+[a-z-]*$/.test(part));
    if (house && target.includes(house)) score += 24;
    const streetHits = parts
      .filter((part) => part.length >= 4 && !/^\d/.test(part))
      .filter((part) => target.includes(part)).length;
    score += Math.min(24, streetHits * 6);
  }
  if (city && target.includes(city)) score += 16;
  return score;
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
    const current =
      weekdayIndex[String(currentParts["weekday"] ?? "").toLowerCase()] ?? new Date().getDay();
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
  const start = clockValue(match[1]!, match[2], match[3]);
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
    rows.find((route: any) => route.route_date === today) ??
    rows.find((route: any) => ["active", "in_progress"].includes(String(route.status))) ??
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

function personTargetPhrase(message: string) {
  const match =
    message.match(/\b(?:lunch|meeting|appointment)?\s*(?:today\s+)?with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ??
    message.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:'s| is)\s+(?:the only|my only)/);
  return clean(match?.[1] ?? "");
}

function officeTargetPhrase(message: string) {
  return normalize(message)
    .replace(/\b(add|put|remove|take|route|stop|office|out|off|from|to|the|my|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function findOffice(db: any, userId: string, phrase: string) {
  const [accounts, prospects, contacts] = await Promise.all([
    db
      .from("hpo_accounts")
      .select("id,name,address,city,latitude,longitude,priority,status,tags,owner_name")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("address", "is", null)
      .limit(1000),
    db
      .from("hpo_prospects")
      .select("id,name,address,city,latitude,longitude,fit_status,verification_status,promoted_account_id,metadata")
      .eq("user_id", userId)
      .not("fit_status", "in", "(not_fit,closed,duplicate)")
      .not("address", "is", null)
      .limit(1000),
    db
      .from("hpo_contacts")
      .select("id,account_id,name,role_title")
      .eq("user_id", userId)
      .limit(1000),
  ]);
  if (accounts.error) throw accounts.error;
  if (prospects.error) throw prospects.error;
  if (contacts.error) throw contacts.error;

  const personPhrase = personTargetPhrase(phrase);
  const contactScoreByAccount = new Map<string, number>();
  for (const contact of contacts.data ?? []) {
    const score = nameScore(personPhrase || phrase, clean(contact.name));
    if (score < 45) continue;
    contactScoreByAccount.set(
      contact.account_id,
      Math.max(contactScoreByAccount.get(contact.account_id) ?? 0, score + 20),
    );
  }

  const candidates = [
    ...(accounts.data ?? [])
      .filter(
        (row: any) => !(Array.isArray(row.tags) && row.tags.includes("exclude_from_adam_route")),
      )
      .filter((row: any) => !clean(row.owner_name) || normalize(row.owner_name) === "adam")
      .map((row: any) => ({
        score: Math.max(
          locationAwareOfficeScore(phrase, row),
          contactScoreByAccount.get(row.id) ?? 0,
        ),
        accountId: row.id,
        prospectId: null,
        officeName: row.name,
        address: row.address,
        city: row.city,
        latitude: row.latitude,
        longitude: row.longitude,
        visitPriority: Number(row.priority ?? 0) >= 4 ? "high" : null,
      })),
    ...(prospects.data ?? [])
      .filter((row: any) => {
        const metadata =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? row.metadata
            : {};
        if (metadata.exclude_from_adam_route === true) return false;
        if (!row.promoted_account_id) return true;
        return metadata.map_as_location === true;
      })
      .map((row: any) => ({
        score: locationAwareOfficeScore(phrase, row),
        accountId: row.promoted_account_id ?? null,
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
    .sort(
      (left: { row: any; score: number }, right: { row: any; score: number }) =>
        right.score - left.score,
    );

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
      .select(
        "id,name,address,city,latitude,longitude,priority,last_touch_at,next_action,next_action_due_at,tags,status,owner_name",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .not("address", "is", null)
      .limit(1000),
    db
      .from("hpo_prospects")
      .select("id,name,address,city,latitude,longitude,fit_status,verification_status,promoted_account_id,metadata")
      .eq("user_id", userId)
      .not("fit_status", "in", "(not_fit,closed,duplicate)")
      .not("address", "is", null)
      .limit(1000),
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
      .filter(
        (row: any) => !(Array.isArray(row.tags) && row.tags.includes("exclude_from_adam_route")),
      )
      .filter((row: any) => !clean(row.owner_name) || normalize(row.owner_name) === "adam")
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
      .filter((row: any) => {
        const metadata =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? row.metadata
            : {};
        if (metadata.exclude_from_adam_route === true) return false;
        if (!row.promoted_account_id) return true;
        return metadata.map_as_location === true;
      })
      .map((row: any) => {
        const priority = Number(row.metadata?.internal_priority ?? 2);
        const score =
          priority * 10 +
          (row.verification_status === "verified" ? 10 : 0) +
          (row.fit_status === "accepted" ? 14 : 0);
        return {
          score,
          accountId: row.promoted_account_id ?? null,
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

function bestOpenStop(stops: any[], phrase: string) {
  const ranked = stops
    .filter((row: any) => !TERMINAL.has(String(row.status)))
    .map((row: any) => ({ row, score: nameScore(phrase, row.office_name ?? "") }))
    .filter((item: { row: any; score: number }) => item.score >= 45)
    .sort(
      (left: { row: any; score: number }, right: { row: any; score: number }) =>
        right.score - left.score,
    );
  if (!ranked.length) return { row: null, ambiguous: false };
  if (ranked.length > 1 && ranked[0]!.score - ranked[1]!.score < 10) {
    return { row: null, ambiguous: true };
  }
  return { row: ranked[0]!.row, ambiguous: false };
}

function reorderPreservingTerminalSlots(stops: any[], openIds: string[]) {
  let openIndex = 0;
  return [...stops]
    .sort((left: any, right: any) => left.stop_order - right.stop_order)
    .map((stop: any) => {
      if (TERMINAL.has(String(stop.status))) return stop.id as string;
      const id = openIds[openIndex];
      openIndex += 1;
      return id;
    })
    .filter(Boolean) as string[];
}

function requestedAction(message: string): HpoRouteCommandAction {
  const text = normalize(message);
  if (
    /\b(copy|export)\b.*\b(today|todays|route|visits?|tracker|rows?)\b/.test(text) ||
    /\b(copy todays visits|copy today s visits|tracker rows)\b/.test(text)
  )
    return "hpo.route.export";
  if (
    /\b(sync|put|add)\b.*\b(route|field route|marketing route)\b.*\bcalendar\b/.test(text) ||
    /\b(sync route to calendar|put route on calendar)\b/.test(text)
  )
    return "hpo.route.sync_calendar";
  if (/\b(build|create|make)\b.*\broute\b/.test(text)) return "hpo.route.create";
  if (
    /\b(wrap up|wrap today|finish (?:the )?(?:route|day)|complete (?:the )?route|end (?:the )?route)\b/.test(
      text,
    )
  )
    return "hpo.route.complete";
  if (
    /\b(another|backup|nearby|within \d{1,2} minutes?|where should i go|where can i go|i have \d{1,3} minutes? left)\b/.test(
      text,
    )
  )
    return "hpo.nearby.find";
  if (
    /\b(reoptimize|re optimize|fix (?:the )?(?:rest|remaining)|optimize (?:the )?(?:rest|remaining))\b/.test(
      text,
    )
  )
    return "hpo.route.reoptimize";
  if (/\boptimize\b/.test(text)) return "hpo.route.optimize";
  if (
    /\b(?:put|move)\b.+\b(?:first|last|before|after)\b/.test(text) ||
    /\b(?:first|last)\s+(?:stop|office)\b/.test(text)
  )
    return "hpo.route.reorder";
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
  requestId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sourceChannel: string;
}): Promise<HpoRouteCommandResult> {
  const action = requestedAction(input.message);
  const requestPrefix = input.sourceMessageId
    ? `message:${input.sourceMessageId}`
    : input.requestId
      ? `request:${input.requestId}`
      : null;
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
    if (action === "hpo.route.set_stops") {
      const target = await findOffice(input.db, input.userId, input.message);
      if (target.ambiguous) {
        const who = personTargetPhrase(input.message);
        return empty({
          needsClarification: true,
          question: who
            ? `I found more than one office connected to ${who}. Which firm or office should I use?`
            : "I found more than one matching HPO office. Which one should be your only remaining stop?",
          reply: who
            ? `I found more than one office connected to ${who}. Which firm or office should I use?`
            : "I found more than one matching HPO office. Which one should be your only remaining stop?",
        });
      }
      if (!target.match) {
        const who = personTargetPhrase(input.message);
        return empty({
          needsClarification: true,
          question: who
            ? `I found your plan for ${who}, but I don't have ${who} linked to an HPO office yet. Which firm or office should I use?`
            : "Which saved HPO office or prospect should be your only remaining stop today?",
          reply: who
            ? `I found your plan for ${who}, but I don't have ${who} linked to an HPO office yet. Which firm or office should I use?`
            : "Which saved HPO office or prospect should be your only remaining stop today?",
        });
      }

      let route = await activeRoute(input.db, input.userId, input.timezone);
      if (!route) {
        const routeDate = dateKey(input.timezone);
        const created = await executeHpoRouteCreateCore({
          db: input.db,
          userId: input.userId,
          payload: {
            routeDate,
            area: target.match.city ?? null,
            syncToCalendar: false,
            stops: [target.match],
            idempotencyKey: requestPrefix
              ? `${requestPrefix}:hpo.route.set_stops:create`
              : `hpo-route:${routeDate}:set-stops:${Date.now()}`,
            sourceChannel: input.sourceChannel,
            sourceMessageId: input.sourceMessageId ?? null,
          },
        });
        route = { id: created.routeId };
      }

      const run = await beginExecution({
        db: input.db,
        userId: input.userId,
        domain: "hpo_route",
        action: "hpo.route.set_stops",
        sourceMessageId: input.sourceMessageId ?? null,
        idempotencyKey: requestPrefix ? `${requestPrefix}:hpo.route.set_stops` : null,
        targetType: "hpo_route",
        targetId: route.id,
        requestPayload: {
          routeId: route.id,
          accountId: target.match.accountId,
          prospectId: target.match.prospectId,
          officeName: target.match.officeName,
          armNoteTarget: true,
        },
      });

      if (
        run.reused &&
        run.status === "completed" &&
        run.resultPayload["setStops"]
      ) {
        const reused = run.resultPayload["setStops"] as any;
        return empty({
          performed: true,
          routeId: route.id,
          executionRunId: run.id,
          reply: `${target.match.officeName} is already your only remaining stop today. I'm ready for your notes afterward.`,
        });
      }

      try {
        const { data: rpcData, error: rpcError } = await input.db.rpc(
          "emery_hpo_set_remaining_route_stops",
          {
            p_route_id: route.id,
            p_target_account_id: target.match.accountId,
            p_target_prospect_id: target.match.prospectId,
            p_office_name: target.match.officeName,
            p_address: target.match.address,
            p_city: target.match.city,
            p_latitude: target.match.latitude,
            p_longitude: target.match.longitude,
            p_visit_priority: target.match.visitPriority,
            p_arm_note_target: true,
          },
        );
        if (rpcError) throw rpcError;
        const result =
          rpcData && typeof rpcData === "object" && !Array.isArray(rpcData) ? rpcData : {};
        await completeExecution({
          db: input.db,
          userId: input.userId,
          runId: run.id,
          resultPayload: { setStops: result },
          targetType: "hpo_route",
          targetId: route.id,
        });
        return empty({
          performed: true,
          routeId: route.id,
          executionRunId: run.id,
          reply: `Got it. ${target.match.officeName} is your only remaining stop today. I preserved completed visits, and I'm ready for your notes afterward.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        await failExecution({
          db: input.db,
          userId: input.userId,
          runId: run.id,
          errorCode: "hpo_route_set_stops_failed",
          errorMessage: message,
          retryable: true,
          resultPayload: { routeId: route.id, officeName: target.match.officeName },
        }).catch(() => undefined);
        return empty({
          routeId: route.id,
          executionRunId: run.id,
          error: "hpo_route_set_stops_failed",
          reply: `I kept your existing route unchanged because I couldn't safely make ${target.match.officeName} the only remaining stop. You can retry without losing completed visits.`,
        });
      }
    }

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
          idempotencyKey: requestPrefix
            ? `${requestPrefix}:hpo.route.create`
            : `hpo-route:${routeDate}:${normalize(selected.area)}:create:${Date.now()}`,
          sourceChannel: input.sourceChannel,
          sourceMessageId: input.sourceMessageId ?? null,
        },
      });
      const optimized: any = await executeHpoRouteOptimizeCore({
        db: input.db,
        userId: input.userId,
        routeId: created.routeId,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.optimize`
          : `route:${created.routeId}:initial-optimize`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: created.routeId,
        executionRunId: created.executionRunId,
        reply: `Your ${selected.area} route is saved for ${routeDate} with ${created.stopCount} stops. I optimized it to about ${optimized.driveMinutes} minutes of driving across ${Number(optimized.distanceMiles ?? 0).toFixed(1)} miles.`,
      });
    }

    const route = await activeRoute(input.db, input.userId, input.timezone);
    if (!route) {
      if (action === "hpo.route.add_stops") {
        const match = await findOffice(input.db, input.userId, input.message);
        if (match.ambiguous) {
          return empty({
            needsClarification: true,
            question:
              "I found more than one matching HPO office. Which one do you want to start today's route with?",
            reply:
              "I found more than one matching HPO office. Which one do you want to start today's route with?",
          });
        }
        if (!match.match) {
          return empty({
            needsClarification: true,
            question: "Which saved HPO office or prospect should start today's route?",
            reply: "Which saved HPO office or prospect should start today's route?",
          });
        }
        const routeDate = dateKey(input.timezone);
        const created = await executeHpoRouteCreateCore({
          db: input.db,
          userId: input.userId,
          payload: {
            routeDate,
            area: match.match.city ?? null,
            syncToCalendar: false,
            stops: [match.match],
            idempotencyKey: requestPrefix
              ? `${requestPrefix}:hpo.route.create_from_office`
              : `hpo-route:${routeDate}:${match.match.accountId ?? match.match.prospectId}:create:${Date.now()}`,
            sourceChannel: input.sourceChannel,
            sourceMessageId: input.sourceMessageId ?? null,
          },
        });
        return empty({
          performed: true,
          routeId: created.routeId,
          executionRunId: created.executionRunId,
          reply: `I started today's route with ${match.match.officeName}. Add the other offices you want, then tell me to optimize the route.`,
        });
      }
      return empty({
        needsClarification: true,
        question: "You don't have an active HPO route to change. Build or open a route first.",
        reply: "You don't have an active HPO route to change. Build or open a route first.",
      });
    }

    if (action === "hpo.route.export") {
      const exported = await getHpoRouteTrackerExportCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
      });
      const reply =
        input.sourceChannel === "voice"
          ? `I prepared ${exported.completedCount} completed visit row${exported.completedCount === 1 ? "" : "s"} for today's HPO tracker. Open the route in HPO to copy them.`
          : exported.completedCount
            ? `Here are the completed route visits in tracker-ready tab-separated format:\n\n${exported.tsv}`
            : "There are no completed route visits to export yet.";
      return empty({
        performed: true,
        routeId: route.id,
        reply,
      });
    }

    if (action === "hpo.route.sync_calendar") {
      const result = await executeHpoRouteSyncCalendarCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.sync_calendar`
          : `route:${route.id}:sync-calendar:${Date.now()}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId,
        reply:
          result.calendarAction === "created"
            ? "The HPO field-route block is saved on Emery Calendar."
            : "The HPO field-route block is updated on Emery Calendar.",
      });
    }

    if (action === "hpo.nearby.find") {
      const withinMatch = input.message.match(/\bwithin\s+(\d{1,2})\s+minutes?\b/i);
      const availableMatch = input.message.match(
        /\b(?:i have|got)\s+(\d{1,3})\s+minutes?(?:\s+left)?\b/i,
      );
      const availableMinutes = availableMatch ? Number(availableMatch[1]) : null;
      const maxMinutes = withinMatch
        ? Number(withinMatch[1])
        : availableMinutes != null
          ? Math.max(5, Math.min(30, availableMinutes - 15))
          : 10;
      const nearby = await getHpoNearbyBackupsCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        latitude: Number.isFinite(input.latitude) ? Number(input.latitude) : null,
        longitude: Number.isFinite(input.longitude) ? Number(input.longitude) : null,
        maxMinutes,
      });
      const recommendation = nearby.recommended;
      if (!recommendation) {
        return empty({
          performed: false,
          routeId: route.id,
          reply: `I don't have an eligible backup office within ${maxMinutes} minutes right now.`,
        });
      }
      const why =
        Array.isArray(recommendation.reasons) && recommendation.reasons.length
          ? ` ${recommendation.reasons.join(" · ")}.`
          : "";
      return empty({
        performed: false,
        routeId: route.id,
        reply: `Best nearby option: ${recommendation.officeName} · ${recommendation.driveMinutes} min · ${recommendation.distanceMiles} mi.${why} Say “Add ${recommendation.officeName}” if you want it on the route.`,
      });
    }

    if (action === "hpo.route.complete") {
      const result = await executeHpoRouteCompleteCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.complete`
          : `route:${route.id}:complete:${Date.now()}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      if (!result.ok && result.blocked) {
        const open = result.openStops ?? [];
        const preview = open
          .slice(0, 3)
          .map((stop: any) => `Stop ${stop.stopOrder} · ${stop.officeName ?? "route stop"}`)
          .join(", ");
        return empty({
          performed: false,
          routeId: route.id,
          reply: `I didn't close the route because ${open.length} stop${open.length === 1 ? " is" : "s are"} still unfinished${preview ? `: ${preview}` : ""}. Give those stops an outcome first.`,
        });
      }
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId ?? null,
        reply:
          "Today's HPO route is wrapped up. Every stop has a final outcome and the route is marked completed.",
      });
    }

    if (action === "hpo.route.optimize") {
      const result: any = await executeHpoRouteOptimizeCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.optimize`
          : `route:${route.id}:optimize:${Date.now()}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId,
        reply: `Route optimized. ${result.stopCount} stops · about ${result.driveMinutes} minutes of driving · ${Number(result.distanceMiles ?? 0).toFixed(1)} miles.`,
      });
    }

    if (action === "hpo.route.reoptimize") {
      const result: any = await executeHpoRouteReoptimizeCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        latitude: Number.isFinite(input.latitude) ? Number(input.latitude) : null,
        longitude: Number.isFinite(input.longitude) ? Number(input.longitude) : null,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.reoptimize`
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

    if (action === "hpo.route.reorder") {
      const open = stops.filter((row: any) => !TERMINAL.has(String(row.status)));
      if (open.length < 2) {
        return empty({
          routeId: route.id,
          reply: "There aren't enough unfinished stops to reorder.",
        });
      }

      const normalized = normalize(input.message);
      const relation = normalized.match(/\b(first|last|before|after)\b/)?.[1] ?? null;
      const rawTarget =
        relation && relation !== "before" && relation !== "after"
          ? normalized
              .replace(/\b(put|move|make|the|stop|office|route|please|first|last)\b/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          : relation
            ? normalize(input.message.split(new RegExp(`\\b${relation}\\b`, "i"))[0] ?? "")
                .replace(/\b(put|move|make|the|stop|office|route|please)\b/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : "";
      const targetMatch = bestOpenStop(open, rawTarget);
      if (targetMatch.ambiguous || !targetMatch.row) {
        return empty({
          needsClarification: true,
          routeId: route.id,
          question: "Which route office do you want me to move?",
          reply: "Which route office do you want me to move?",
        });
      }

      const openIds = open
        .map((row: any) => row.id)
        .filter((id: unknown): id is string => Boolean(id));
      const targetId = targetMatch.row.id as string;
      const withoutTarget = openIds.filter((id: string) => id !== targetId);

      let orderedOpen: string[] = [];
      if (relation === "first") {
        orderedOpen = [targetId, ...withoutTarget];
      } else if (relation === "last") {
        orderedOpen = [...withoutTarget, targetId];
      } else if (relation === "before" || relation === "after") {
        const pieces = input.message.split(new RegExp(`\\b${relation}\\b`, "i"));
        const referencePhrase = normalize(pieces[1] ?? "")
          .replace(/\b(the|stop|office|route|please)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const referenceMatch = bestOpenStop(
          open.filter((row: any) => row.id !== targetId),
          referencePhrase,
        );
        if (referenceMatch.ambiguous || !referenceMatch.row) {
          return empty({
            needsClarification: true,
            routeId: route.id,
            question: `Which office should ${targetMatch.row.office_name} go ${relation}?`,
            reply: `Which office should ${targetMatch.row.office_name} go ${relation}?`,
          });
        }
        const referenceId = referenceMatch.row.id as string;
        const refIndex = withoutTarget.indexOf(referenceId);
        const insertAt = relation === "after" ? refIndex + 1 : refIndex;
        orderedOpen = [...withoutTarget];
        orderedOpen.splice(Math.max(0, insertAt), 0, targetId);
      } else {
        return empty({
          needsClarification: true,
          routeId: route.id,
          question:
            "Should I put that office first, last, before another office, or after another office?",
          reply:
            "Should I put that office first, last, before another office, or after another office?",
        });
      }

      const stopIds = reorderPreservingTerminalSlots(stops, orderedOpen);
      const result: any = await executeHpoRouteReorderCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        stopIds,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.reorder`
          : `route:${route.id}:reorder:${Date.now()}`,
        sourceChannel: input.sourceChannel,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return empty({
        performed: true,
        routeId: route.id,
        executionRunId: result.executionRunId ?? null,
        reply:
          relation === "first"
            ? `Moved ${targetMatch.row.office_name} to the first unfinished route position.`
            : relation === "last"
              ? `Moved ${targetMatch.row.office_name} to the last unfinished route position.`
              : `Moved ${targetMatch.row.office_name} ${relation} the requested office. Completed route history was not moved.`,
      });
    }

    if (action === "hpo.route.remove_stop") {
      const text = normalize(input.message);
      let stop: any | null = null;
      if (/\b(last|last office|last stop)\b/.test(text)) {
        stop = [...stops].reverse().find((row: any) => !TERMINAL.has(String(row.status))) ?? null;
      } else {
        const ranked = stops
          .filter((row: any) => !TERMINAL.has(String(row.status)))
          .map((row: any) => ({
            row,
            score: nameScore(
              officeTargetPhrase(input.message) || input.message,
              row.office_name ?? "",
            ),
          }))
          .filter((item: { row: any; score: number }) => item.score >= 45)
          .sort(
            (left: { row: any; score: number }, right: { row: any; score: number }) =>
              right.score - left.score,
          );
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
      const result: any = await executeHpoRouteRemoveStopCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        stopId: stop.id,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.remove_stop:${stop.id}`
          : `route:${route.id}:remove:${stop.id}:${Date.now()}`,
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
      const result: any = await executeHpoRouteAddStopsCore({
        db: input.db,
        userId: input.userId,
        routeId: route.id,
        stops: [match.match],
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route.add_stops:${match.match.accountId ?? match.match.prospectId}`
          : `route:${route.id}:add:${match.match.accountId ?? match.match.prospectId}:${Date.now()}`,
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
