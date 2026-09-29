import type { ActionPlan, PlannedIntent } from "./orchestration.types.ts";
import { riskForAction } from "./risk-policy.ts";

function normalized(value: string): string {
  return value.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}

function extractNamedPeople(message: string): string[] {
  const results = new Set<string>();
  const patterns = [
    /\b(?:with|see|meeting|lunch with|visiting)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /\b(?:have|got)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:at|today|tomorrow|on)\b/g,
    /\bjust\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:[.!?]|$)/g,
    /\b([A-Z][a-z]+)(?:'s| is)\s+(?:the only|my only)/g,
  ];
  for (const pattern of patterns) {
    for (const match of message.matchAll(pattern)) if (match[1]) results.add(match[1]);
  }
  return [...results];
}

function intent(
  capability: string,
  action: string,
  mode: "read" | "write",
  reason: string,
  dependsOn: string[] = [],
  entities: string[] = [],
): PlannedIntent {
  return {
    id: `${capability}:${action}`,
    capability,
    action,
    mode,
    risk: riskForAction(action),
    dependsOn,
    entities,
    reason,
  };
}

export function planEmeryRequest(message: string): ActionPlan {
  const text = normalized(message);
  const people = extractNamedPeople(message);
  const intents: PlannedIntent[] = [];
  const reads: string[] = [];
  const writes: string[] = [];

  const requestsOnlyStop =
    /\b(only (?:stop|thing)|only remaining stop|forget the other stops|make that my route)\b/.test(
      text,
    );
  const hasScheduledCommitment = /\b(lunch|meeting|appointment|calendar|scheduled)\b/.test(text);
  const referencesToday = /\b(today|this afternoon|this morning|tonight|at noon)\b/.test(text);
  const requestsNoteReadiness =
    /\b(get ready to take (?:the |my )?note|take my notes?|note target|let you know how it went)\b/.test(
      text,
    );
  const routeLanguage = /\b(route|stop|visiting|visit)\b/.test(text) || requestsOnlyStop;
  const requestsUndo = /\b(undo that|undo the last|revert that|put (?:my|the) route back)\b/.test(
    text,
  );

  if (requestsUndo) {
    intents.push(
      intent(
        "execution",
        "execution.undo",
        "write",
        "Undo the latest eligible reversible receipt without reconstructing state from model memory",
      ),
    );
    writes.push("execution.undo");
    return {
      version: 1,
      goal: message.trim(),
      intents,
      entities: [],
      reads,
      writes,
      clarifications: [],
      expectedReceipts: ["execution.undo"],
    };
  }

  if (hasScheduledCommitment || referencesToday || requestsOnlyStop) {
    intents.push(
      intent(
        "calendar",
        "calendar.read",
        "read",
        "Resolve scheduled commitments for the requested day",
        [],
        people,
      ),
    );
    reads.push("calendar.read");
  }
  if (people.length) {
    intents.push(
      intent(
        "entities",
        "entity.resolve",
        "read",
        "Resolve the named person to current Calendar and HPO records",
        ["calendar:calendar.read"],
        people,
      ),
    );
    reads.push("entity.resolve");
  }
  if (routeLanguage) {
    intents.push(
      intent(
        "hpo.route",
        "hpo.route.read",
        "read",
        "Inspect today's route and protect completed stops",
        [],
        people,
      ),
    );
    reads.push("hpo.route.read");
  }
  if (requestsOnlyStop) {
    const dependencies = ["hpo.route:hpo.route.read"];
    if (people.length) dependencies.push("entities:entity.resolve");
    intents.push(
      intent(
        "hpo.route",
        "hpo.route.set_stops",
        "write",
        "Set the explicitly requested office as the only remaining stop",
        dependencies,
        people,
      ),
    );
    writes.push("hpo.route.set_stops");
  }
  if (requestsNoteReadiness) {
    const dependencies = requestsOnlyStop
      ? ["hpo.route:hpo.route.set_stops"]
      : people.length
        ? ["entities:entity.resolve"]
        : ["hpo.route:hpo.route.read"];
    intents.push(
      intent(
        "hpo.field_session",
        "hpo.field_session.arm_note_target",
        "write",
        "Remember the expected target for the next field report",
        dependencies,
        people,
      ),
    );
    writes.push("hpo.field_session.arm_note_target");
  }

  return {
    version: 1,
    goal: message.trim(),
    intents,
    entities: people.map((text) => ({ kind: "person" as const, text })),
    reads,
    writes,
    clarifications: [],
    expectedReceipts: intents.filter((item) => item.mode === "write").map((item) => item.action),
  };
}
