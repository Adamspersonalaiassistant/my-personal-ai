// Emery capability discovery + structured capability gaps.
//
// A capability missing from the router's first selection is not a dead end:
// Emery searches the full capability catalog before loading context. When a
// request genuinely needs something Emery cannot do, the model marks it with a
// one-line gap marker; the server strips it from the reply and records a
// structured capability_gap event in emery_runtime_events (the existing
// telemetry). Opportunity Radar reads those events and turns recurring gaps into
// JARVIS engineering tasks — the autonomy flywheel. Pure module, no I/O.

import { CAPABILITY_REGISTRY, type RegisteredCapabilityAction } from "./capability-registry.ts";
import type { CapabilityRoute } from "./capability-router.ts";

/** Words that point at each catalog capability beyond its description. */
const CAPABILITY_KEYWORDS: Partial<Record<RegisteredCapabilityAction, string[]>> = {
  "calendar.read": ["calendar", "schedule", "agenda", "appointments", "meetings", "busy", "free"],
  "memory.retrieve": ["remember", "preference", "preferences", "usually", "favorite", "told"],
  "hpo.route.read": ["route", "routes", "stops", "offices", "territory", "itinerary"],
  "hpo.account.get_context": ["account", "accounts", "history", "relationship", "contacts"],
  "hpo.route.set_stops": ["route", "stops", "optimize", "reorder"],
  "hpo.follow_up.create": ["follow", "followup", "callback"],
  "hpo.interaction.create": ["interaction", "visited", "touch"],
  "entity.resolve": ["office", "doctor", "attorney", "firm"],
};

const STOP = new Set(
  "the a an and or of to for in on at my me i you it is be with from this that what about can please".split(
    " ",
  ),
);

function tokens(text: string) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Search the full catalog (names, descriptions, keywords). Highest score first. */
export function searchEmeryCapabilities(message: string, limit = 5) {
  const words = new Set(tokens(message));
  const hits: Array<{ action: RegisteredCapabilityAction; score: number }> = [];
  for (const [action, def] of Object.entries(CAPABILITY_REGISTRY) as Array<
    [RegisteredCapabilityAction, (typeof CAPABILITY_REGISTRY)[RegisteredCapabilityAction]]
  >) {
    const keywords = CAPABILITY_KEYWORDS[action] ?? [];
    let score = 0;
    for (const k of keywords) if (words.has(k)) score += 2;
    for (const t of new Set(tokens(`${def.name} ${def.description}`)))
      if (t.length > 4 && words.has(t)) score += 1;
    if (score >= 2) hits.push({ action, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type DiscoveredCapabilityRoute = CapabilityRoute & {
  discovered?: RegisteredCapabilityAction[];
};

/**
 * Mid-turn discovery: when the deterministic router selected nothing (or is
 * unsure), widen the route from the full catalog instead of answering without
 * the right context. Confident routes are returned unchanged.
 */
export function widenCapabilityRoute(
  route: CapabilityRoute,
  message: string,
): DiscoveredCapabilityRoute {
  if (route.candidateCapabilities.length > 0 && route.confidence >= 0.8) return route;
  const found = searchEmeryCapabilities(message)
    .map((h) => h.action)
    .filter((a) => !route.candidateCapabilities.includes(a));
  if (!found.length) return route;
  const candidates = [...route.candidateCapabilities, ...found].slice(0, 8);
  const hpo = candidates.some((a) => a.startsWith("hpo."));
  return {
    ...route,
    domain: hpo && route.domain === "general" ? "hpo" : route.domain,
    candidateCapabilities: candidates,
    needsHpoContext: route.needsHpoContext || hpo,
    needsCalendar: route.needsCalendar || candidates.includes("calendar.read"),
    needsPersonalMemory: route.needsPersonalMemory || candidates.includes("memory.retrieve"),
    reason: `${route.reason} Capability discovery widened the selection: ${found.join(", ")}.`,
    discovered: found,
  };
}

/** Recovery ladder + gap marker protocol, appended to Emery's system prompt. */
export const EMERY_CAPABILITY_GAP_POLICY = `CAPABILITY RECOVERY LADDER: A missing tool is not an immediate dead end. Before saying you cannot do something, check the full execution registry above, the connected systems and saved context, the app records in this prompt, and live web search when information (not an action) is what Adam needs. Offer a safe alternative or break the goal into the parts you CAN do, and do those.
Only if a real capability is still missing: say plainly what is not connected (never imply you did it), and end your reply with ONE final line exactly like:
[[capability_gap: short_snake_case_capability | one short sentence describing what Adam needed, without personal, medical or account details]]
That line is removed before Adam sees your reply and becomes an engineering opportunity for JARVIS. Never add it for things you completed, for questions you answered, or for permission/approval limits.`;

const GAP_MARKER =
  /\n?\s*\[\[capability_gap:\s*([a-z][a-z0-9_.-]{1,47})\s*\|\s*([^\]\n]{3,200})\]\]\s*$/i;

export type CapabilityGap = { capability: string; need: string };

/** Strip a trailing gap marker from the reply. The visible reply never contains it. */
export function extractCapabilityGap(reply: string): { reply: string; gap: CapabilityGap | null } {
  const text = String(reply ?? "");
  const match = GAP_MARKER.exec(text);
  if (!match)
    return { reply: text.replace(/\[\[capability_gap:[^\]]*\]\]/gi, "").trim(), gap: null };
  return {
    reply: text.slice(0, match.index).trim(),
    gap: {
      capability: match[1]!.toLowerCase().replace(/[.-]/g, "_"),
      need: match[2]!.replace(/\s+/g, " ").trim(),
    },
  };
}

/**
 * The structured telemetry event Opportunity Radar consumes. The verbatim
 * message is never stored: only the model's sanitized one-line need.
 */
export function capabilityGapEvent(gap: CapabilityGap, domain: string | null) {
  return {
    eventType: "capability_gap",
    domain,
    action: "emery_turn",
    status: "skipped" as const,
    metadata: {
      signal: "capability_gap",
      capability: gap.capability,
      request: gap.need,
      observed: `Emery could not complete: ${gap.need}`,
      severity: 3,
      confidence: 0.8,
      source: "emery_recovery_ladder",
    },
  };
}
