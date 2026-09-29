import assert from "node:assert/strict";
import { planEmeryRequest } from "../src/lib/emery/planner.ts";
import {
  aggregateReceipts,
  shouldSuppressCapability,
} from "../src/lib/emery/receipt-aggregator.ts";
import { resolveEntity } from "../src/lib/emery/entity-resolver.ts";
import { serializeError } from "../src/lib/emery/error-serializer.ts";
import { executeActionPlan } from "../src/lib/emery/executor.ts";
import { chooseAuthoritativeValue } from "../src/lib/emery/source-hierarchy.ts";
import { requiresConfirmation } from "../src/lib/emery/risk-policy.ts";
import fs from "node:fs";

const cases = [
  "I have my lunch today with Jason so can you put that as the only stop for today and get ready to take the note because I will let you know how it went afterwards.",
  "Jason's the only thing I'm doing today.",
  "I have Jason at noon. Just make that my route.",
  "Actually forget the other stops — just Jason. Get ready to take my notes.",
];

for (const phrase of cases) {
  const plan = planEmeryRequest(phrase);
  const actions = new Set(plan.intents.map((item) => item.action));
  assert(actions.has("calendar.read"), `calendar context missing: ${phrase}`);
  assert(actions.has("entity.resolve"), `entity resolution missing: ${phrase}`);
  assert(actions.has("hpo.route.read"), `route read missing: ${phrase}`);
  assert(actions.has("hpo.route.set_stops"), `route set-stops missing: ${phrase}`);
}

const exact = planEmeryRequest(cases[0]);
assert(exact.writes.includes("hpo.field_session.arm_note_target"));
assert.equal(exact.entities[0]?.text, "Jason");

const calendarRecognizedOnly = {
  id: "calendar-1",
  capability: "calendar",
  action: "calendar.read",
  target: null,
  status: "safe_noop",
  performed: false,
  before: null,
  after: null,
  reason: "recognized but no write performed",
  error: null,
  idempotencyKey: null,
  timestamp: new Date(0).toISOString(),
  reversible: false,
  undoData: null,
  sourceMessageId: "message-1",
};
assert.equal(
  shouldSuppressCapability(calendarRecognizedOnly),
  false,
  "recognition must not suppress another capability",
);

const combined = aggregateReceipts([
  { ...calendarRecognizedOnly, status: "success", performed: true },
  {
    ...calendarRecognizedOnly,
    id: "route-1",
    capability: "hpo.route",
    action: "hpo.route.set_stops",
    status: "hard_failure",
  },
]);
assert.equal(combined.status, "partial_success");
assert.equal(combined.performed, 1);
assert.equal(combined.failed, 1);

const resolution = resolveEntity("Jason", [
  { id: "1", name: "Jason" },
  { id: "2", name: "Amanda" },
]);
assert.equal(resolution.status, "resolved");
if (resolution.status === "resolved") assert.equal(resolution.value.id, "1");

const serialized = serializeError(
  { message: "ordering failed", code: "23505", details: { constraint: "route_order" } },
  { capability: "hpo.route", operation: "reorder" },
);
assert.equal(serialized.message, "ordering failed");
assert.equal(serialized.code, "23505");
assert.notEqual(serialized.message, "[object Object]");

const executed = [];
const executorResult = await executeActionPlan({
  plan: exact,
  context: {
    userId: "user-1",
    conversationId: "conversation-1",
    sourceMessageId: "message-1",
    entryPoint: "chat",
    inputMode: "typed",
    timezone: "America/New_York",
    surface: "hpo_today",
    hpoTab: "today",
    currentRouteId: null,
    currentStopId: null,
    selectedAccountId: null,
    selectedProspectId: null,
    expectedNoteTargetId: null,
    fieldSessionId: null,
    location: null,
    recentReceiptIds: [],
    capabilityHealth: {},
  },
  handlers: Object.fromEntries(
    exact.intents.map((intent) => [
      intent.action,
      async () => {
        executed.push(intent.id);
        return {
          id: `test:${intent.id}`,
          capability: intent.capability,
          action: intent.action,
          target: null,
          status: "success",
          performed: intent.mode === "write",
          before: null,
          after: {},
          reason: "fixture",
          error: null,
          idempotencyKey: intent.mode === "write" ? `test:${intent.id}` : null,
          timestamp: new Date(0).toISOString(),
          reversible: intent.action === "hpo.route.set_stops",
          undoData: intent.action === "hpo.route.set_stops" ? { previous: [] } : null,
          sourceMessageId: "message-1",
        };
      },
    ]),
  ),
});
assert.equal(executorResult.status, "success");
assert.equal(executorResult.performed, 2);
assert(
  executed.indexOf("hpo.route:hpo.route.set_stops") > executed.indexOf("entities:entity.resolve"),
  "dependent route write must execute after entity resolution",
);
assert(
  executed.indexOf("hpo.field_session:hpo.field_session.arm_note_target") >
    executed.indexOf("hpo.route:hpo.route.set_stops"),
  "note target must be armed after set-stops",
);

const undoPlan = planEmeryRequest("Undo that");
assert.deepEqual(undoPlan.writes, ["execution.undo"]);
assert.equal(undoPlan.intents[0]?.action, "execution.undo");
assert.equal(
  requiresConfirmation({
    action: "hpo.route.set_stops",
    ambiguous: false,
    hasReliableUndo: true,
    explicitlyRequested: true,
  }),
  false,
);
assert.equal(
  requiresConfirmation({
    action: "hpo.route.set_stops",
    ambiguous: true,
    hasReliableUndo: true,
    explicitlyRequested: true,
  }),
  true,
);

const protectedLiveValue = chooseAuthoritativeValue(
  { value: "Adam correction", source: "explicit_correction", observedAt: "2026-09-29" },
  { value: "Old research", source: "verified_research", observedAt: "2026-09-28" },
);
assert.equal(protectedLiveValue.status, "requires_review");

const chatSource = fs.readFileSync(
  new URL("../src/lib/emery.functions.ts", import.meta.url),
  "utf8",
);
const voiceSource = fs.readFileSync(
  new URL("../src/lib/voice.functions.ts", import.meta.url),
  "utf8",
);
const migrationSource = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929152000_emery_field_sessions_and_route_undo.sql",
    import.meta.url,
  ),
  "utf8",
);
assert(chatSource.includes("processEmeryMultiIntentDayPlan"));
assert(voiceSource.includes("processEmeryMultiIntentDayPlan"));
assert(migrationSource.includes("create table if not exists public.emery_field_sessions"));
assert(migrationSource.includes("emery_hpo_restore_remaining_route_stops"));
assert(migrationSource.includes("auth.uid()"));

console.log(
  `Emery orchestration validation passed (${cases.length} multi-intent variants, shared Chat/Voice execution, Field Session, source hierarchy, undo).`,
);
