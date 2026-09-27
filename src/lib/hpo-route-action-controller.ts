/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeHpoRouteStopOutcomeCore } from "@/lib/hpo-route.functions";

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

export type HpoRouteStopActionResult = {
  recognized: boolean;
  performed: boolean;
  needsClarification: boolean;
  question: string | null;
  action: "none" | "hpo.route_stop.set_outcome";
  routeId: string | null;
  stopId: string | null;
  officeName: string | null;
  status: string | null;
  executionRunId: string | null;
  nextStopId: string | null;
  nextStopName: string | null;
  error?: string | null;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map["year"]}-${map["month"]}-${map["day"]}`;
}

function requestedOutcome(message: string) {
  const text = normalize(message);
  if (
    /\b(bad address|wrong address|not an office|isn t an office|is not an office|it s a house|its a house|side of (a )?house|residential house)\b/.test(
      text,
    )
  ) {
    return { status: "bad_address" as const, outcome: "Bad / unusable address" };
  }
  if (/\b(closed|office is closed|they re closed|they are closed)\b/.test(text)) {
    return { status: "closed" as const, outcome: "Office closed" };
  }
  if (/\b(skip it|skip this|skip the stop|mark (?:this )?stop skipped|can t go|cannot go)\b/.test(text)) {
    return { status: "skipped" as const, outcome: "Skipped" };
  }
  if (
    /\b(mark (?:this )?stop (?:complete|completed)|visit (?:is )?complete|finished (?:this|here)|stop (?:is )?done)\b/.test(
      text,
    ) ||
    ["done", "completed", "complete"].includes(text)
  ) {
    return { status: "completed" as const, outcome: "Visit completed" };
  }
  return null;
}

function resolveStopFromMessage(rows: any[], message: string) {
  const numberMatch = message.match(/\bstop\s*#?\s*(\d{1,2})\b/i);
  if (numberMatch) {
    const order = Number(numberMatch[1]);
    return rows.find((row) => Number(row.stop_order) === order) ?? null;
  }

  const messageNorm = normalize(message);
  let best: { row: any; score: number } | null = null;
  for (const row of rows) {
    const office = normalize(String(row.office_name ?? ""));
    if (!office) continue;
    if (messageNorm.includes(office)) return row;
    const tokens = office.split(" ").filter((token) => token.length >= 4);
    if (!tokens.length) continue;
    const matched = tokens.filter((token) => messageNorm.includes(token)).length;
    const score = matched / tokens.length;
    if (!best || score > best.score) best = { row, score };
  }
  if (best && best.score >= 0.5) return best.row;
  return rows.find((row) => !TERMINAL.has(String(row.status))) ?? null;
}

export async function processHpoRouteStopAction(input: {
  db: any;
  userId: string;
  message: string;
  timezone?: string;
  sourceMessageId?: string | null;
  sourceChannel?: string;
}): Promise<HpoRouteStopActionResult> {
  const outcome = requestedOutcome(input.message);
  if (!outcome) {
    return {
      recognized: false,
      performed: false,
      needsClarification: false,
      question: null,
      action: "none",
      routeId: null,
      stopId: null,
      officeName: null,
      status: null,
      executionRunId: null,
      nextStopId: null,
      nextStopName: null,
    };
  }

  const db = input.db;
  const timezone = input.timezone ?? "America/New_York";
  const today = localDate(timezone);
  const { data: routes, error: routeError } = await db
    .from("hpo_route_plans")
    .select("id,route_date,status,updated_at")
    .eq("user_id", input.userId)
    .in("status", ["draft", "planned", "active", "in_progress"])
    .order("route_date", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(8);
  if (routeError) throw routeError;

  const routeRows = routes ?? [];
  const todayRoutes = routeRows.filter((route: any) => route.route_date === today);
  const activeRoutes = routeRows.filter((route: any) =>
    ["active", "in_progress"].includes(String(route.status)),
  );
  const route =
    (todayRoutes.length === 1 ? todayRoutes[0] : null) ??
    (activeRoutes.length === 1 ? activeRoutes[0] : null) ??
    (routeRows.length === 1 ? routeRows[0] : null);

  if (!route) {
    return {
      recognized: true,
      performed: false,
      needsClarification: true,
      question: "Which HPO route are you updating? Open that route or tell me the route date.",
      action: "hpo.route_stop.set_outcome",
      routeId: null,
      stopId: null,
      officeName: null,
      status: outcome.status,
      executionRunId: null,
      nextStopId: null,
      nextStopName: null,
    };
  }

  const { data: stops, error: stopError } = await db
    .from("hpo_route_stops")
    .select("*")
    .eq("user_id", input.userId)
    .eq("route_id", route.id)
    .order("stop_order", { ascending: true });
  if (stopError) throw stopError;
  const rows = stops ?? [];
  const target = resolveStopFromMessage(rows, input.message);
  if (!target) {
    return {
      recognized: true,
      performed: false,
      needsClarification: true,
      question: "Which stop should I update? Say the stop number or office name.",
      action: "hpo.route_stop.set_outcome",
      routeId: route.id,
      stopId: null,
      officeName: null,
      status: outcome.status,
      executionRunId: null,
      nextStopId: null,
      nextStopName: null,
    };
  }

  const idempotencyKey = input.sourceMessageId
    ? `message:${input.sourceMessageId}:hpo.route_stop.set_outcome`
    : `${input.sourceChannel ?? "text"}:${route.id}:${target.id}:${outcome.status}:${Date.now()}`;

  try {
    const receipt = await executeHpoRouteStopOutcomeCore({
      db,
      userId: input.userId,
      stopId: target.id,
      status: outcome.status,
      notes: input.message,
      visitOutcome: outcome.outcome,
      idempotencyKey,
      sourceChannel: input.sourceChannel ?? "text",
      sourceMessageId: input.sourceMessageId ?? null,
      traceId: input.sourceMessageId ?? null,
    });

    const { data: refreshedStops } = await db
      .from("hpo_route_stops")
      .select("id,office_name,stop_order,status")
      .eq("user_id", input.userId)
      .eq("route_id", route.id)
      .order("stop_order", { ascending: true });
    const next = (refreshedStops ?? []).find((stop: any) => !TERMINAL.has(String(stop.status))) ?? null;

    return {
      recognized: true,
      performed: true,
      needsClarification: false,
      question: null,
      action: "hpo.route_stop.set_outcome",
      routeId: route.id,
      stopId: receipt.stop.id,
      officeName: receipt.stop.office_name ?? null,
      status: receipt.stop.status,
      executionRunId: receipt.executionRunId,
      nextStopId: next?.id ?? null,
      nextStopName: next?.office_name ?? null,
    };
  } catch (error) {
    return {
      recognized: true,
      performed: false,
      needsClarification: false,
      question: null,
      action: "hpo.route_stop.set_outcome",
      routeId: route.id,
      stopId: target.id,
      officeName: target.office_name ?? null,
      status: outcome.status,
      executionRunId: null,
      nextStopId: null,
      nextStopName: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
