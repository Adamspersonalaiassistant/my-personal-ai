/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  captureHpoRouteNoteCore,
  executeHpoRouteStopOutcomeCore,
} from "@/lib/hpo-route.functions";
import { executeHpoRouteStopArriveCore } from "@/lib/hpo-field.functions";

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

export type HpoRouteStopActionResult = {
  recognized: boolean;
  performed: boolean;
  needsClarification: boolean;
  question: string | null;
  action:
    | "none"
    | "hpo.route_stop.arrive"
    | "hpo.route_stop.set_outcome"
    | "hpo.route_stop.log_visit";
  routeId: string | null;
  stopId: string | null;
  officeName: string | null;
  status: string | null;
  executionRunId: string | null;
  nextStopId: string | null;
  nextStopName: string | null;
  followupTaskId?: string | null;
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

function resolveStopFromMessage(rows: any[], message: string, preferredStopId?: string | null) {
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
  if (preferredStopId) {
    const preferred = rows.find((row) => row.id === preferredStopId && !TERMINAL.has(String(row.status)));
    if (preferred) return preferred;
  }
  return rows.find((row) => !TERMINAL.has(String(row.status))) ?? null;
}

export async function processHpoRouteStopAction(input: {
  db: any;
  userId: string;
  message: string;
  timezone?: string;
  sourceMessageId?: string | null;
  requestId?: string | null;
  sourceChannel?: string;
  routeId?: string | null;
  stopId?: string | null;
}): Promise<HpoRouteStopActionResult> {
  const outcome = requestedOutcome(input.message);
  const arrivalSignal =
    !outcome &&
    /\b(i(?:'|’)??m here|im here|i am here|arrived|i arrived|at the office|i(?:'|’)??m at the office|im at the office)\b/i.test(
      input.message,
    );
  const visitSignal =
    !outcome &&
    !arrivalSignal &&
    /\b(just left|spoke with|talked to|met with|left (?:the )?(?:cards|materials|information|info)|dropped off|attorney (?:was|is)|front desk|receptionist|follow\s*up|will pass|took the (?:cards|materials|info|information))\b/i.test(
      input.message,
    );
  if (!outcome && !arrivalSignal && !visitSignal) {
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
  const requestPrefix = input.sourceMessageId
    ? `message:${input.sourceMessageId}`
    : input.requestId
      ? `request:${input.requestId}`
      : null;
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
  const hintedRoute = input.routeId
    ? routeRows.find((route: any) => route.id === input.routeId) ?? null
    : null;
  const todayRoutes = routeRows.filter((route: any) => route.route_date === today);
  const activeRoutes = routeRows.filter((route: any) =>
    ["active", "in_progress"].includes(String(route.status)),
  );
  const route =
    hintedRoute ??
    (todayRoutes.length === 1 ? todayRoutes[0] : null) ??
    (activeRoutes.length === 1 ? activeRoutes[0] : null) ??
    (routeRows.length === 1 ? routeRows[0] : null);

  if (!route) {
    return {
      recognized: true,
      performed: false,
      needsClarification: true,
      question: "Which HPO route are you updating? Open that route or tell me the route date.",
      action: outcome
        ? "hpo.route_stop.set_outcome"
        : arrivalSignal
          ? "hpo.route_stop.arrive"
          : "hpo.route_stop.log_visit",
      routeId: null,
      stopId: null,
      officeName: null,
      status: outcome?.status ?? null,
      executionRunId: null,
      nextStopId: null,
      nextStopName: null,
    };
  }

  if (arrivalSignal) {
    const { data: stops, error: stopError } = await db
      .from("hpo_route_stops")
      .select("*")
      .eq("user_id", input.userId)
      .eq("route_id", route.id)
      .order("stop_order", { ascending: true });
    if (stopError) throw stopError;
    const target = resolveStopFromMessage(stops ?? [], input.message, input.stopId);
    if (!target) {
      return {
        recognized: true,
        performed: false,
        needsClarification: true,
        question: "Which stop did you arrive at? Say the stop number or office name.",
        action: "hpo.route_stop.arrive",
        routeId: route.id,
        stopId: null,
        officeName: null,
        status: "arrived",
        executionRunId: null,
        nextStopId: null,
        nextStopName: null,
      };
    }

    try {
      const receipt = await executeHpoRouteStopArriveCore({
        db,
        userId: input.userId,
        stopId: target.id,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route_stop.arrive`
          : `${input.sourceChannel ?? "text"}:${route.id}:${target.id}:arrive:${Date.now()}`,
        sourceChannel: input.sourceChannel ?? "text",
        sourceMessageId: input.sourceMessageId ?? null,
      });
      return {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action: "hpo.route_stop.arrive",
        routeId: route.id,
        stopId: receipt.stop.id,
        officeName: receipt.stop.office_name ?? null,
        status: receipt.stop.status,
        executionRunId: receipt.executionRunId,
        nextStopId: null,
        nextStopName: null,
      };
    } catch (error) {
      return {
        recognized: true,
        performed: false,
        needsClarification: false,
        question: null,
        action: "hpo.route_stop.arrive",
        routeId: route.id,
        stopId: target.id,
        officeName: target.office_name ?? null,
        status: "arrived",
        executionRunId: null,
        nextStopId: null,
        nextStopName: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (visitSignal) {
    try {
      const visit = await captureHpoRouteNoteCore({
        db,
        userId: input.userId,
        routeId: route.id,
        message: input.message,
        idempotencyKey: requestPrefix
          ? `${requestPrefix}:hpo.route_stop.log_visit`
          : `${input.sourceChannel ?? "text"}:${route.id}:route-note:${Date.now()}`,
        sourceChannel: input.sourceChannel ?? "text",
        sourceMessageId: input.sourceMessageId ?? null,
        preferredStopId: input.stopId ?? null,
      });
      if (!visit.ok) {
        return {
          recognized: true,
          performed: false,
          needsClarification: true,
          question: visit.question,
          action: "hpo.route_stop.log_visit",
          routeId: route.id,
          stopId: null,
          officeName: null,
          status: null,
          executionRunId: null,
          nextStopId: null,
          nextStopName: null,
        };
      }
      const { data: refreshedStops } = await db
        .from("hpo_route_stops")
        .select("id,office_name,stop_order,status")
        .eq("user_id", input.userId)
        .eq("route_id", route.id)
        .order("stop_order", { ascending: true });
      const next =
        (refreshedStops ?? []).find((stop: any) => !TERMINAL.has(String(stop.status))) ?? null;
      return {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action: "hpo.route_stop.log_visit",
        routeId: route.id,
        stopId: visit.stopId,
        officeName: visit.officeName ?? null,
        status: visit.status,
        executionRunId: visit.executionRunId ?? null,
        nextStopId: next?.id ?? null,
        nextStopName: next?.office_name ?? null,
        followupTaskId: visit.followupTaskId ?? null,
      };
    } catch (error) {
      return {
        recognized: true,
        performed: false,
        needsClarification: false,
        question: null,
        action: "hpo.route_stop.log_visit",
        routeId: route.id,
        stopId: null,
        officeName: null,
        status: null,
        executionRunId: null,
        nextStopId: null,
        nextStopName: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!outcome) throw new Error("Route-stop outcome could not be resolved");

  const { data: stops, error: stopError } = await db
    .from("hpo_route_stops")
    .select("*")
    .eq("user_id", input.userId)
    .eq("route_id", route.id)
    .order("stop_order", { ascending: true });
  if (stopError) throw stopError;
  const rows = stops ?? [];
  const target = resolveStopFromMessage(rows, input.message, input.stopId);
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

  const idempotencyKey = requestPrefix
    ? `${requestPrefix}:hpo.route_stop.set_outcome`
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
