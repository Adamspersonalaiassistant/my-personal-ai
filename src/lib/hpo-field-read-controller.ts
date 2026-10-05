/* eslint-disable @typescript-eslint/no-explicit-any */
import { getHpoFieldTodayCore } from "@/lib/hpo-field.functions";
import { formatHpoFollowupReply, listHpoFollowupsCore } from "@/lib/hpo-followups.functions";
import type { EmeryContextSnapshot } from "@/lib/emery/context-engine";

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

export type HpoFieldReadAction =
  | "none"
  | "hpo.route.get_next_stop"
  | "hpo.route.resume_context"
  | "hpo.route.day_summary"
  | "hpo.account.get_context"
  | "hpo.account.get_current"
  | "hpo.followups.list";

export type HpoFieldReadResult = {
  recognized: boolean;
  action: HpoFieldReadAction;
  routeId: string | null;
  routeDate: string | null;
  routeArea: string | null;
  completed: number;
  total: number;
  remaining: number;
  nextStop: any | null;
  lastCompletedStop: any | null;
  currentStop: any | null;
  accountContext: any | null;
  followups?: any | null;
  reply: string | null;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hpoFollowupScope(message: string): "all" | "week" | "overdue" | null {
  const text = normalize(message);
  if (/\b(whats overdue|what is overdue|anything overdue|overdue follow ?ups?|which follow ?ups? are overdue|what follow ?ups? are overdue)\b/.test(text))
    return "overdue";
  if (/\bfollow ?ups?\b[\s\S]{0,40}\b(this week|week)\b|\b(this week)\b[\s\S]{0,40}\bfollow ?ups?\b/.test(text))
    return "week";
  if (/\b(who should i follow up with|who do i need to follow up with|who do i follow up with|what follow ?ups? do i have|my follow ?ups?|open follow ?ups?|list (?:my )?follow ?ups?)\b/.test(text))
    return "all";
  return null;
}

function requestedReadAction(message: string): HpoFieldReadAction {
  const text = normalize(message);
  if (hpoFollowupScope(message)) return "hpo.followups.list";

  if (
    /\b(what account am i at|which account am i at|what office am i at|which office am i at)\b/.test(
      text,
    )
  ) {
    return "hpo.account.get_current";
  }

  if (
    /\b(where was i|where did i leave off|resume (?:my )?route|resume (?:my )?day|what was i doing|pick up where i left off)\b/.test(
      text,
    )
  ) {
    return "hpo.route.resume_context";
  }

  if (
    /\b(whats next|what is next|next stop|next office|where am i going next|where should i go next|whos next|who is next)\b/.test(
      text,
    )
  ) {
    return "hpo.route.get_next_stop";
  }

  if (
    /\b(how did today go|how did my day go|how did the route go|today summary|day summary|summarize (?:today|the route)|route summary)\b/.test(
      text,
    )
  ) {
    return "hpo.route.day_summary";
  }

  if (
    /\b(brief me|account brief|what happened (?:here )?last time|what happened last time i visited|last visit|who did i talk to|who did i speak to|what do i need to know (?:here|about this office))\b/.test(
      text,
    )
  ) {
    return "hpo.account.get_context";
  }

  return "none";
}

function stopLabel(stop: any | null) {
  if (!stop) return null;
  const office = String(stop.office_name ?? "route stop").trim();
  const order = Number(stop.stop_order);
  return Number.isFinite(order) ? `Stop ${order} · ${office}` : office;
}

function accountBrief(context: any | null) {
  if (!context?.account) return null;
  const account = context.account;
  const contacts = Array.isArray(context.contacts) ? context.contacts : [];
  const interactions = Array.isArray(context.interactions) ? context.interactions : [];
  const primary = contacts[0] ?? null;
  const latest = interactions[0] ?? null;

  return {
    id: account.id,
    name: account.name,
    address: account.address ?? null,
    city: account.city ?? null,
    accountType: account.account_type ?? null,
    specialty: account.specialty ?? null,
    priority: account.priority ?? null,
    ownerName: account.owner_name ?? null,
    relationshipStage: account.relationship_stage ?? account.status ?? null,
    relationshipHealth: account.relationship_health ?? null,
    lastTouchAt: account.last_touch_at ?? null,
    nextAction: account.next_action ?? null,
    nextActionDueAt: account.next_action_due_at ?? null,
    primaryContact: primary
      ? {
          name: primary.name,
          roleTitle: primary.role_title ?? null,
          phone: primary.phone ?? null,
          relationshipNotes: primary.relationship_notes ?? null,
        }
      : null,
    latestInteraction: latest
      ? {
          occurredAt: latest.occurred_at ?? null,
          summary: latest.summary ?? null,
          outcome: latest.outcome ?? null,
          nextAction: latest.next_action ?? null,
          nextActionDueAt: latest.next_action_due_at ?? null,
        }
      : null,
  };
}

async function loadAccountContext(db: any, userId: string, accountId: string | null) {
  if (!accountId) return null;
  const [accountResult, contactsResult, interactionsResult] = await Promise.all([
    db.from("hpo_accounts").select("*").eq("id", accountId).eq("user_id", userId).maybeSingle(),
    db
      .from("hpo_contacts")
      .select("id,name,role_title,email,phone,relationship_notes,created_at")
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(8),
    db
      .from("hpo_interactions")
      .select("id,occurred_at,interaction_type,summary,outcome,next_action,next_action_due_at")
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);
  if (accountResult.error) throw accountResult.error;
  if (contactsResult.error) throw contactsResult.error;
  if (interactionsResult.error) throw interactionsResult.error;
  return accountResult.data
    ? {
        account: accountResult.data,
        contacts: contactsResult.data ?? [],
        interactions: interactionsResult.data ?? [],
      }
    : null;
}

async function loadAuthoritativeFieldState(input: {
  db: any;
  userId: string;
  context?: EmeryContextSnapshot | null;
}) {
  const routeId = input.context?.request.currentRouteId ?? null;
  if (!routeId) {
    const fallback = await getHpoFieldTodayCore({ db: input.db, userId: input.userId });
    return { ...fallback, currentStop: fallback.nextStop ?? null };
  }

  const [routeResult, stopsResult] = await Promise.all([
    input.db
      .from("hpo_route_plans")
      .select("*")
      .eq("id", routeId)
      .eq("user_id", input.userId)
      .maybeSingle(),
    input.db
      .from("hpo_route_stops")
      .select("*")
      .eq("route_id", routeId)
      .eq("user_id", input.userId)
      .order("stop_order", { ascending: true }),
  ]);
  if (routeResult.error) throw routeResult.error;
  if (stopsResult.error) throw stopsResult.error;
  if (!routeResult.data) {
    const fallback = await getHpoFieldTodayCore({ db: input.db, userId: input.userId });
    return { ...fallback, currentStop: fallback.nextStop ?? null };
  }

  const stops = stopsResult.data ?? [];
  const completedStops = stops.filter((stop: any) => TERMINAL.has(String(stop.status)));
  const currentStopId = input.context?.request.currentStopId ?? null;
  const currentStop = currentStopId
    ? (stops.find((stop: any) => stop.id === currentStopId) ?? null)
    : null;
  const nextStop = stops.find((stop: any) => !TERMINAL.has(String(stop.status))) ?? null;
  const lastCompletedStop =
    [...completedStops].sort(
      (a: any, b: any) =>
        Date.parse(b.visited_at ?? b.updated_at) - Date.parse(a.visited_at ?? a.updated_at),
    )[0] ?? null;
  const accountId =
    input.context?.request.selectedAccountId ??
    currentStop?.account_id ??
    nextStop?.account_id ??
    null;
  const accountContext = await loadAccountContext(input.db, input.userId, accountId);

  return {
    timezone: input.context?.timezone ?? "America/New_York",
    today: input.context?.localDate ?? null,
    route: routeResult.data,
    stops,
    currentStop,
    nextStop,
    lastCompletedStop,
    completed: completedStops.length,
    total: stops.length,
    remaining: Math.max(0, stops.length - completedStops.length),
    progress: stops.length ? completedStops.length / stops.length : 0,
    accountContext,
  };
}

function formatReply(
  action: HpoFieldReadAction,
  state: any,
  brief: ReturnType<typeof accountBrief>,
) {
  if (!state.route) {
    return "You don't have an active HPO field route right now. Open Map to build one.";
  }

  const next = stopLabel(state.nextStop);
  const last = stopLabel(state.lastCompletedStop);

  if (action === "hpo.route.resume_context") {
    if (!next) {
      return `You finished all ${state.total} stops on this route. Nothing is left open.`;
    }
    return `${last ? `You last finished ${last}. ` : ""}You're at ${state.completed}/${state.total}. Next is ${next}.`;
  }

  if (action === "hpo.route.day_summary") {
    const counts = (state.stops ?? []).reduce((acc: Record<string, number>, stop: any) => {
      const key = String(stop.status ?? "planned");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const outcomes = [
      counts["completed"] || counts["visited"]
        ? `${(counts["completed"] ?? 0) + (counts["visited"] ?? 0)} completed`
        : null,
      counts["closed"] ? `${counts["closed"]} closed` : null,
      counts["bad_address"] ? `${counts["bad_address"]} bad address` : null,
      counts["skipped"] ? `${counts["skipped"]} skipped` : null,
    ].filter(Boolean);
    const unfinished = Number(state.remaining ?? 0);
    return `Today: ${state.completed}/${state.total} stops have outcomes${outcomes.length ? ` · ${outcomes.join(" · ")}` : ""}.${unfinished ? ` ${unfinished} stop${unfinished === 1 ? " is" : "s are"} still unfinished.` : " The route has no unfinished stops."}`;
  }

  if (action === "hpo.route.get_next_stop") {
    if (!next) return `All ${state.total} route stops already have an outcome.`;
    const driveMinutes = state.nextStop?.drive_seconds_from_previous
      ? Math.max(1, Math.round(Number(state.nextStop.drive_seconds_from_previous) / 60))
      : null;
    return `Next is ${next}${driveMinutes ? ` · about ${driveMinutes} min from the previous stop` : ""}.`;
  }

  if (action === "hpo.account.get_context") {
    const targetStop = state.currentStop ?? state.nextStop;
    if (!targetStop) return "Which account should I check?";
    if (!brief)
      return `${stopLabel(targetStop) ?? "That stop"} is a prospect or doesn't have saved account history yet.`;

    const pieces = [brief.name];
    if (brief.primaryContact?.name) {
      pieces.push(
        `Primary contact: ${brief.primaryContact.name}${brief.primaryContact.roleTitle ? ` (${brief.primaryContact.roleTitle})` : ""}`,
      );
    }
    if (brief.latestInteraction?.summary) {
      pieces.push(`Last interaction: ${brief.latestInteraction.summary}`);
    } else if (brief.lastTouchAt) {
      pieces.push("A prior touch is recorded, but there isn't a saved interaction summary.");
    } else {
      pieces.push("No prior interaction is recorded.");
    }
    if (brief.nextAction) pieces.push(`Follow-up: ${brief.nextAction}`);
    return pieces.join(" · ");
  }

  if (action === "hpo.account.get_current") {
    const targetStop = state.currentStop ?? null;
    if (brief?.name) return `You're at ${brief.name}.`;
    if (targetStop?.office_name) {
      return targetStop.prospect_id
        ? `You're at ${targetStop.office_name}, which is currently saved as a prospect.`
        : `You're at ${targetStop.office_name}.`;
    }
    return "Which account are you at? Open the route stop or tell me the office name.";
  }

  return null;
}

export async function processHpoFieldReadCommand(input: {
  db: any;
  userId: string;
  message: string;
  context?: EmeryContextSnapshot | null;
}): Promise<HpoFieldReadResult> {
  const action = requestedReadAction(input.message);
  if (action === "none") {
    return {
      recognized: false,
      action,
      routeId: null,
      routeDate: null,
      routeArea: null,
      completed: 0,
      total: 0,
      remaining: 0,
      nextStop: null,
      lastCompletedStop: null,
      currentStop: null,
      accountContext: null,
      reply: null,
    };
  }

  if (action === "hpo.followups.list") {
    const list = await listHpoFollowupsCore({ db: input.db, userId: input.userId });
    return {
      recognized: true,
      action,
      routeId: null,
      routeDate: null,
      routeArea: null,
      completed: 0,
      total: 0,
      remaining: 0,
      nextStop: null,
      lastCompletedStop: null,
      currentStop: null,
      accountContext: null,
      followups: list,
      reply: formatHpoFollowupReply(list, hpoFollowupScope(input.message) ?? "all"),
    };
  }

  const state = await loadAuthoritativeFieldState(input);
  const brief = accountBrief(state.accountContext);

  return {
    recognized: true,
    action,
    routeId: state.route?.id ?? null,
    routeDate: state.route?.route_date ?? null,
    routeArea: state.route?.area ?? null,
    completed: Number(state.completed ?? 0),
    total: Number(state.total ?? 0),
    remaining: Number(state.remaining ?? 0),
    nextStop: state.nextStop
      ? {
          id: state.nextStop.id,
          stopOrder: state.nextStop.stop_order,
          officeName: state.nextStop.office_name ?? null,
          address: state.nextStop.address ?? null,
          city: state.nextStop.city ?? null,
          status: state.nextStop.status ?? null,
          driveSecondsFromPrevious: state.nextStop.drive_seconds_from_previous ?? null,
          distanceMetersFromPrevious: state.nextStop.distance_meters_from_previous ?? null,
          accountId: state.nextStop.account_id ?? null,
          prospectId: state.nextStop.prospect_id ?? null,
        }
      : null,
    lastCompletedStop: state.lastCompletedStop
      ? {
          id: state.lastCompletedStop.id,
          stopOrder: state.lastCompletedStop.stop_order,
          officeName: state.lastCompletedStop.office_name ?? null,
          status: state.lastCompletedStop.status ?? null,
          visitedAt: state.lastCompletedStop.visited_at ?? null,
        }
      : null,
    currentStop: state.currentStop
      ? {
          id: state.currentStop.id,
          stopOrder: state.currentStop.stop_order,
          officeName: state.currentStop.office_name ?? null,
          address: state.currentStop.address ?? null,
          city: state.currentStop.city ?? null,
          status: state.currentStop.status ?? null,
          accountId: state.currentStop.account_id ?? null,
          prospectId: state.currentStop.prospect_id ?? null,
        }
      : null,
    accountContext: brief,
    reply: formatReply(action, state, brief),
  };
}
