import assert from "node:assert/strict";
import { planEmeryRequest } from "../src/lib/emery/planner.ts";
import {
  aggregateReceipts,
  shouldSuppressCapability,
} from "../src/lib/emery/receipt-aggregator.ts";
import { resolveEntity } from "../src/lib/emery/entity-resolver.ts";
import { serializeError } from "../src/lib/emery/error-serializer.ts";

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

console.log(`Emery orchestration validation passed (${cases.length} multi-intent variants).`);
