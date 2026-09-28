/* eslint-disable @typescript-eslint/no-explicit-any */
import { getHpoFieldTodayCore } from "@/lib/hpo-field.functions";

export type HpoFieldReadAction =
  | "none"
  | "hpo.route.get_next_stop"
  | "hpo.route.resume_context"
  | "hpo.account.get_context";

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
  accountContext: any | null;
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

function requestedReadAction(message: string): HpoFieldReadAction {
  const text = normalize(message);

  if (
    /\b(where was i|where did i leave off|resume (?:my )?route|resume (?:my )?day|what was i doing|pick up where i left off)\b/.test(
      text,
    )
  ) {
    return "hpo.route.resume_context";
  }

  if (
    /\b(whats next|what is next|next stop|next office|where am i going next|where should i go next|who is next)\b/.test(
      text,
    )
  ) {
    return "hpo.route.get_next_stop";
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
  const primary = contacts.find((contact: any) => contact.is_primary) ?? contacts[0] ?? null;
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

  if (action === "hpo.route.get_next_stop") {
    if (!next) return `All ${state.total} route stops already have an outcome.`;
    const driveMinutes = state.nextStop?.drive_seconds_from_previous
      ? Math.max(1, Math.round(Number(state.nextStop.drive_seconds_from_previous) / 60))
      : null;
    return `Next is ${next}${driveMinutes ? ` · about ${driveMinutes} min from the previous stop` : ""}.`;
  }

  if (action === "hpo.account.get_context") {
    if (!state.nextStop) return "There isn't an unfinished stop to brief you on.";
    if (!brief) return `${next ?? "The next stop"} is a prospect or doesn't have saved account history yet.`;

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

  return null;
}

export async function processHpoFieldReadCommand(input: {
  db: any;
  userId: string;
  message: string;
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
      accountContext: null,
      reply: null,
    };
  }

  const state = await getHpoFieldTodayCore({ db: input.db, userId: input.userId });
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
    accountContext: brief,
    reply: formatReply(action, state, brief),
  };
}
