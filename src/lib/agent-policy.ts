export type HpoDelegate = "scout" | "route" | "relationship";
export type MainSpecialist = "hpo-agent" | "research-agent" | "strategy-agent";

export type AgentContextBundle = {
  profile?: Record<string, unknown>;
  memories?: Array<Record<string, unknown>>;
  active_tasks?: Array<Record<string, unknown>>;
  active_projects?: Array<Record<string, unknown>>;
  upcoming_meetings?: Array<Record<string, unknown>>;
};

const HPO_TERMS =
  /\b(hpo|hudson pro|orthop|referr|attorney|law firm|doctor|physician|pcp|primary care|office|account|patient|pip|workers? comp|wc|marketing|route|visit|vein|hand|morris plains|hoboken|jersey|newark)\b/i;
const HPO_EXPLICIT =
  /\b(hpo|hudson pro|hudson pro orthop|hudson pro orthopaedics|hudson pro orthopedics)\b/i;
const HPO_WORKFLOW =
  /\b(referral source|referral relationship|marketing route|pcp outreach|attorney outreach|patient management|pip|workers? comp|workers? compensation|office visit|marketing visit|prospect office|account follow[- ]?up)\b/i;
const HPO_GEOGRAPHY = /\b(hoboken|morris plains|newark|north bergen|fort lee|edgewater|jersey city)\b/i;
const GENERAL_GOAL_TERMS =
  /\b(goal|priority|project|task|deadline|income|money|wealth|family|business|career|time|focus|plan|strategy|decision|next action)\b/i;

export function selectHpoDelegates(message: string): HpoDelegate[] {
  const text = message.toLowerCase();
  const delegates: HpoDelegate[] = [];

  const scout =
    /\b(find|research|verify|look up|search|discover|prospect|new target|new targets|closed|open now|hours|current|latest|address|phone|website|duplicate|confirm|fact[- ]?check)\b/i.test(
      text,
    );
  const route =
    /\b(route|stops?|drive|driving|order|sequence|optimi[sz]e|geograph|miles?|minutes?|start|finish|cluster|parking|backup|visit\s+\d+|offices?\s+(?:today|tomorrow))\b/i.test(
      text,
    );
  const relationship =
    /\b(relationship|referral|refer|follow[- ]?up|account|patient|case|pcc|attorney|case manager|lunch|contact|history|visited|visit note|reactivat|grow|partner)\b/i.test(
      text,
    );

  if (scout) delegates.push("scout");
  if (route) delegates.push("route");
  if (relationship) delegates.push("relationship");

  return delegates.slice(0, 3);
}

export function shouldResearchWithWeb(message: string) {
  return /\b(latest|current|today|tonight|tomorrow|this week|news|price|cost|available|availability|hours|open now|closed|law|legal rule|regulation|policy|software version|release|update|company|ceo|president|election|weather|score|schedule|event|restaurant|hotel|flight|address|phone|website|verify|research|find|search|look up|compare current)\b/i.test(
    message,
  );
}

export function isExplicitAgentCreationCommand(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (
    /\b(should i|could i|would i|what if|maybe|thinking about|idea of|do you think i should)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ");
  const directVerb =
    /^(?:(?:hey\s+)?emery[,:]?\s*)?(?:please\s+)?(?:(?:can|could|would)\s+you\s+|i\s+want\s+you\s+to\s+)?(?:create|make|build|add|set up|spin up)\b[\s\S]*\bagent\b/i;
  const needAgent =
    /^(?:(?:hey\s+)?emery[,:]?\s*)?(?:please\s+)?i\s+(?:need|want)\s+(?:an?\s+)?[a-z0-9 '&/-]{1,60}\s+agent\b/i;
  return directVerb.test(normalized) || needAgent.test(normalized);
}

function clearlyHpoWork(text: string) {
  if (HPO_EXPLICIT.test(text)) return true;
  if (HPO_WORKFLOW.test(text)) return true;
  return HPO_GEOGRAPHY.test(text) && /\b(marketing|route|referral|prospect|office visit|outreach)\b/i.test(text);
}

export function routeMainSpecialist(message: string): MainSpecialist | null {
  const text = message.trim();
  if (!text) return null;

  if (
    /\b(second opinion|second set of eyes|stress[- ]?test|challenge (?:this|my|the) plan|critique (?:this|my|the) plan|is this (?:really )?the best strategy|better strategy|trade[- ]?off|what am i missing|poke holes)\b/i.test(
      text,
    )
  ) {
    return "strategy-agent";
  }

  if (
    clearlyHpoWork(text) &&
    /\b(route|office|doctor|physician|pcp|attorney|referral|relationship|patient|marketing|prospect|visit|account|lunch|follow[- ]?up|case|pcc|outreach)\b/i.test(
      text,
    )
  ) {
    return "hpo-agent";
  }

  if (
    /\b(research|look up|verify|fact[- ]?check|find current|compare current|latest|current data|current information|what does the research say|search the web|check online|source this)\b/i.test(
      text,
    )
  ) {
    return "research-agent";
  }

  return null;
}

function textOf(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object")
    return Object.values(value as Record<string, unknown>)
      .map(textOf)
      .join(" ");
  return "";
}

function relevantToRequest(row: Record<string, unknown>, request: string, extra?: RegExp) {
  const haystack = textOf(row).toLowerCase();
  const normalizedRequest = request.toLowerCase();
  if (extra?.test(normalizedRequest) && extra.test(haystack)) return true;
  const words = normalizedRequest
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .slice(0, 12);
  return words.some((word) => haystack.includes(word));
}

function scopedProfile(
  profile: Record<string, unknown>,
  scope: string,
  request: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (profile["display_name"]) result["display_name"] = profile["display_name"];
  const schedulingRelevant =
    /\b(today|tomorrow|date|time|schedule|meeting|route|morning|afternoon|evening)\b/i.test(
      request,
    );
  if (schedulingRelevant && profile["timezone"]) result["timezone"] = profile["timezone"];
  if (scope === "strategy-agent" && profile["profile_summary"]) {
    result["profile_summary"] = profile["profile_summary"];
  }
  return result;
}

export function scopeAgentContext(
  context: AgentContextBundle,
  scope: string,
  request: string,
  agent?: { mission?: string; description?: string },
): AgentContextBundle {
  const profile = context.profile ?? {};
  const memories = context.memories ?? [];
  const tasks = context.active_tasks ?? [];
  const projects = context.active_projects ?? [];
  const meetings = context.upcoming_meetings ?? [];

  if (scope === "hpo-agent") {
    return {
      profile: scopedProfile(profile, scope, request),
      memories: memories.filter((row) => relevantToRequest(row, request, HPO_TERMS)).slice(0, 12),
      active_tasks: tasks.filter((row) => relevantToRequest(row, request, HPO_TERMS)).slice(0, 8),
      active_projects: projects
        .filter((row) => relevantToRequest(row, request, HPO_TERMS))
        .slice(0, 6),
      upcoming_meetings: meetings
        .filter((row) => relevantToRequest(row, request, HPO_TERMS))
        .slice(0, 6),
    };
  }

  if (scope === "research-agent") {
    return {
      profile: scopedProfile(profile, scope, request),
      memories: memories.filter((row) => relevantToRequest(row, request)).slice(0, 8),
      active_tasks: tasks.filter((row) => relevantToRequest(row, request)).slice(0, 5),
      active_projects: projects
        .filter((row) => relevantToRequest(row, request, GENERAL_GOAL_TERMS))
        .slice(0, 5),
      upcoming_meetings: meetings.filter((row) => relevantToRequest(row, request)).slice(0, 3),
    };
  }

  if (scope === "strategy-agent") {
    return {
      profile: scopedProfile(profile, scope, request),
      memories: memories
        .filter((row) => relevantToRequest(row, request, GENERAL_GOAL_TERMS))
        .slice(0, 12),
      active_tasks: tasks.slice(0, 8),
      active_projects: projects.slice(0, 8),
      upcoming_meetings: meetings.slice(0, 5),
    };
  }

  const customTerms = `${agent?.mission ?? ""} ${agent?.description ?? ""}`.trim();
  const customRequest = `${request} ${customTerms}`.trim();
  return {
    profile: scopedProfile(profile, scope, request),
    memories: memories.filter((row) => relevantToRequest(row, customRequest)).slice(0, 8),
    active_tasks: tasks.filter((row) => relevantToRequest(row, customRequest)).slice(0, 5),
    active_projects: projects.filter((row) => relevantToRequest(row, customRequest)).slice(0, 5),
    upcoming_meetings: meetings.filter((row) => relevantToRequest(row, customRequest)).slice(0, 3),
  };
}
