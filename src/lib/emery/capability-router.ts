import { inferEmeryDomain, type EmeryDomain } from "../emery-domain.ts";
import {
  CAPABILITY_REGISTRY,
  type RegisteredCapabilityAction,
} from "./capability-registry.ts";
import type { RequestContext } from "./orchestration.types.ts";

export type CapabilityRoute = {
  version: 1;
  domain: EmeryDomain;
  candidateCapabilities: RegisteredCapabilityAction[];
  needsCurrentContext: boolean;
  needsHpoContext: boolean;
  needsPersonalMemory: boolean;
  needsCalendar: boolean;
  needsLocation: boolean;
  confidence: number;
  reason: string;
};

export type CapabilityRouterInput = {
  message: string;
  context?: RequestContext | null;
  domainHint?: EmeryDomain | null;
};

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function add(
  set: Set<RegisteredCapabilityAction>,
  ...actions: RegisteredCapabilityAction[]
) {
  for (const action of actions) {
    if (CAPABILITY_REGISTRY[action]) set.add(action);
  }
}

function hasHpoCurrentContext(context?: RequestContext | null) {
  if (!context) return false;
  return (
    context.surface.startsWith("hpo_") ||
    Boolean(
      context.currentRouteId ||
        context.currentStopId ||
        context.selectedAccountId ||
        context.selectedProspectId ||
        context.fieldSessionId,
    )
  );
}

function operationalHpoSignal(text: string) {
  return /\b(route|stop|office|account|prospect|hpo|hudson pro|attorney|law firm|doctor|provider|referral|visit|lunch|field|planner)\b/.test(
    text,
  );
}

export function routeEmeryCapabilities(input: CapabilityRouterInput): CapabilityRoute {
  const text = normalized(input.message);
  const inferred = inferEmeryDomain(input.message);
  const currentHpo = hasHpoCurrentContext(input.context);
  const candidates = new Set<RegisteredCapabilityAction>();
  const reasons: string[] = [];

  const undoSignal = /\b(undo that|undo the last|revert that|put it back|change it back)\b/.test(
    text,
  );
  if (undoSignal) {
    add(candidates, "execution.undo");
    return {
      version: 1,
      domain: input.domainHint ?? (currentHpo ? "hpo" : inferred.domain),
      candidateCapabilities: [...candidates],
      needsCurrentContext: true,
      needsHpoContext: currentHpo,
      needsPersonalMemory: false,
      needsCalendar: false,
      needsLocation: false,
      confidence: 0.99,
      reason: "Explicit undo request; only the verified execution ledger is relevant.",
    };
  }

  const nextStopSignal =
    /\b(whats next|what is next|whos next|who is next|next stop|next office|where am i going next|where should i go next)\b/.test(
      text,
    );
  const arrivalSignal =
    /\b(im here|i am here|arrived|i arrived|at the office|im at the office)\b/.test(text);
  const currentAccountSignal =
    /\b(what account am i at|which account am i at|what office am i at|which office am i at)\b/.test(
      text,
    );
  const accountContextSignal =
    /\b(what happened here last time|what happened last time|last visit|who did i talk to|who did i speak to|brief me|account brief|what do i need to know here|what do i need to know about this office)\b/.test(
      text,
    );
  const visitSignal =
    /\b(just left|spoke with|talked to|met with|dropped off|left cards|left materials|great visit|good visit|front desk|receptionist)\b/.test(
      text,
    );
  const noteSignal =
    /\b(add|save|log|record|leave)\s+(?:a\s+)?note\b|\bnote\s+(?:for|on|to)\b/.test(text);
  const followupSignal = /\b(follow up|followup|follow-up|call back|check back|reach back out)\b/.test(
    text,
  );
  const routeWriteSignal =
    /\b(only remaining stop|only stop|forget the other stops|make that my route|add .* stop|remove .* stop|optimize|reoptimize|reorder)\b/.test(
      text,
    );
  const noteReadinessSignal =
    /\b(get ready to take (?:the |my )?note|take my notes|note target|let you know how it went)\b/.test(
      text,
    );
  const calendarSignal =
    /\b(calendar|appointment|meeting|scheduled|schedule|today at|tomorrow at|at noon|this afternoon|this morning)\b/.test(
      text,
    );
  const memorySignal =
    /\b(remember|do you remember|what did i say|what did i tell you|last time we talked|my preference|my preferences|about me)\b/.test(
      text,
    );
  const locationSignal =
    /\b(near me|nearby|closest|around me|my location|where i am|take me there|navigate there|navigate to)\b/.test(
      text,
    );
  const deicticHpoSignal =
    currentHpo && /\b(here|there|this office|this account|she|he|they|them|that office)\b/.test(text);

  if (arrivalSignal) {
    add(candidates, "hpo.route_stop.arrive");
    reasons.push("arrival command");
  }
  if (nextStopSignal) {
    add(candidates, "hpo.route.get_next_stop");
    reasons.push("next-stop read");
  }
  if (currentAccountSignal) {
    add(candidates, "hpo.account.get_current");
    reasons.push("current-account read");
  }
  if (accountContextSignal || deicticHpoSignal) {
    add(candidates, "hpo.account.get_context");
    reasons.push("relationship/account context");
  }
  if (visitSignal) {
    add(candidates, "hpo.route_stop.log_visit");
    reasons.push("field visit capture");
  }
  if (noteSignal) {
    add(candidates, "hpo.route_stop.add_note");
    reasons.push("field note capture");
  }
  if (followupSignal) {
    add(candidates, "hpo.follow_up.create");
    reasons.push("relationship follow-up");
  }
  if (routeWriteSignal) {
    add(candidates, "hpo.route.read", "hpo.route.set_stops");
    reasons.push("route mutation");
  } else if (operationalHpoSignal(text) && !nextStopSignal && !arrivalSignal) {
    add(candidates, "hpo.route.read");
    reasons.push("HPO route context");
  }
  if (noteReadinessSignal) {
    add(candidates, "hpo.field_session.arm_note_target");
    reasons.push("field-session note target");
  }
  if (calendarSignal) {
    add(candidates, "calendar.read");
    reasons.push("calendar context");
  }
  if (memorySignal) {
    add(candidates, "memory.retrieve");
    reasons.push("explicit durable-memory request");
  }

  const hpoSignal =
    currentHpo ||
    operationalHpoSignal(text) ||
    [...candidates].some((action) => action.startsWith("hpo."));
  let domain: EmeryDomain = input.domainHint ?? inferred.domain;
  if (hpoSignal && domain === "general") domain = "hpo";
  if (hpoSignal && domain === "personal") domain = "mixed";

  if (hpoSignal && candidates.size === 0) {
    if (input.context?.selectedAccountId || input.context?.currentStopId) {
      add(candidates, "hpo.account.get_context");
      reasons.push("current HPO account context");
    } else {
      add(candidates, "hpo.route.read");
      reasons.push("current HPO route context");
    }
  }

  const pureOperationalHpo =
    hpoSignal &&
    !memorySignal &&
    domain !== "mixed" &&
    !/\b(personal|family|home|money|finance|health|music|dj)\b/.test(text);
  const needsPersonalMemory = memorySignal || (!pureOperationalHpo && domain !== "hpo" && !calendarSignal);
  if (needsPersonalMemory) add(candidates, "memory.retrieve");

  const needsCalendar = calendarSignal || candidates.has("calendar.read");
  const needsHpoContext = hpoSignal;
  const needsCurrentContext =
    needsHpoContext ||
    locationSignal ||
    /\b(here|there|this|that|she|he|they|them|next|current)\b/.test(text);

  const confidence =
    arrivalSignal || nextStopSignal || currentAccountSignal || accountContextSignal
      ? 0.98
      : routeWriteSignal || visitSignal || noteSignal || followupSignal
        ? 0.94
        : hpoSignal || calendarSignal || memorySignal
          ? 0.88
          : 0.72;

  return {
    version: 1,
    domain,
    candidateCapabilities: [...candidates].slice(0, 8),
    needsCurrentContext,
    needsHpoContext,
    needsPersonalMemory,
    needsCalendar,
    needsLocation: locationSignal,
    confidence,
    reason: reasons.length
      ? `Deterministic routing: ${reasons.join(", ")}.`
      : "No specialized operational signal; keep the capability set minimal.",
  };
}
