export type HpoDelegate = "scout" | "route" | "relationship";

export type AgentContextBundle = {
  profile?: Record<string, unknown>;
  memories?: Array<Record<string, unknown>>;
  active_tasks?: Array<Record<string, unknown>>;
  active_projects?: Array<Record<string, unknown>>;
  upcoming_meetings?: Array<Record<string, unknown>>;
};

const HPO_TERMS =
  /\b(hpo|hudson pro|orthop|referr|attorney|law firm|doctor|physician|pcp|primary care|office|account|patient|pip|workers? comp|wc|marketing|route|visit|vein|hand|morris plains|hoboken|jersey|newark)\b/i;
const GENERAL_GOAL_TERMS =
  /\b(goal|priority|project|task|deadline|income|money|wealth|family|business|career|time|focus|plan|strategy|decision|next action)\b/i;

export function selectHpoDelegates(message: string): HpoDelegate[] {
  const text = message.toLowerCase();
  const delegates: HpoDelegate[] = [];

  const scout =
    /\b(find|research|verify|prospect|office|doctor|physician|attorney|law firm|closed|open|hours|current|latest|address|phone|provider|pcp|primary care|target|duplicate)\b/i.test(
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
  return /\b(latest|current|today|tonight|tomorrow|this week|news|price|cost|available|availability|hours|open now|closed|law|legal rule|regulation|policy|software version|release|update|company|ceo|president|election|weather|score|schedule|event|restaurant|hotel|flight|office|doctor|physician|attorney|address|phone|website|verify|research|find|search|look up|compare current)\b/i.test(
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
  return /^(?:(?:hey\s+)?emery[,:]?\s*)?(?:please\s+)?(?:(?:can|could|would)\s+you\s+|i\s+want\s+you\s+to\s+)?(?:create|make|build)\b[\s\S]*\bagent\b/i.test(
    text,
  );
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
  const haystack = textOf(row);
  if (extra?.test(haystack)) return true;
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .slice(0, 12);
  return words.some((word) => haystack.toLowerCase().includes(word));
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
      profile,
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
      profile,
      memories: memories
        .filter((row) => relevantToRequest(row, request, GENERAL_GOAL_TERMS))
        .slice(0, 8),
      active_tasks: tasks.filter((row) => relevantToRequest(row, request)).slice(0, 5),
      active_projects: projects
        .filter((row) => relevantToRequest(row, request, GENERAL_GOAL_TERMS))
        .slice(0, 5),
      upcoming_meetings: meetings.filter((row) => relevantToRequest(row, request)).slice(0, 3),
    };
  }

  if (scope === "strategy-agent") {
    return {
      profile,
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
    profile,
    memories: memories.filter((row) => relevantToRequest(row, customRequest)).slice(0, 8),
    active_tasks: tasks.filter((row) => relevantToRequest(row, customRequest)).slice(0, 5),
    active_projects: projects.filter((row) => relevantToRequest(row, customRequest)).slice(0, 5),
    upcoming_meetings: meetings.filter((row) => relevantToRequest(row, customRequest)).slice(0, 3),
  };
}
