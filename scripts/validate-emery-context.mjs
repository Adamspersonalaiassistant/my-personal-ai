import assert from "node:assert/strict";
import fs from "node:fs";
import {
  deriveCapabilityHealth,
  normalizeEmerySurface,
  pickContextValue,
} from "../src/lib/emery/context-engine.ts";

assert.equal(normalizeEmerySurface("HPO Planner"), "hpo_planner");
assert.equal(normalizeEmerySurface("planner"), "hpo_planner");
assert.equal(normalizeEmerySurface("HPO Map"), "hpo_map");
assert.equal(normalizeEmerySurface("Accounts"), "hpo_accounts");
assert.equal(normalizeEmerySurface("Activity"), "hpo_activity");
assert.equal(normalizeEmerySurface("Calendar"), "calendar");

const prioritized = pickContextValue([
  { value: "explicit-stop", authority: "explicit_ui" },
  { value: "session-stop", authority: "field_session" },
  { value: "route-stop", authority: "active_route" },
  { value: "receipt-stop", authority: "recent_receipt" },
]);
assert.deepEqual(prioritized, { value: "explicit-stop", authority: "explicit_ui" });

const sessionFallback = pickContextValue([
  { value: null, authority: "explicit_ui" },
  { value: "session-stop", authority: "field_session" },
  { value: "route-stop", authority: "active_route" },
]);
assert.deepEqual(sessionFallback, { value: "session-stop", authority: "field_session" });

const health = deriveCapabilityHealth([
  {
    action: "hpo.route.set_stops",
    status: "completed",
    retryable: false,
  },
  {
    action: "hpo.interaction.create",
    status: "failed",
    retryable: true,
  },
]);
assert.equal(health["hpo.route.write"], "healthy");
assert.equal(health["hpo.crm.write"], "degraded");
assert.equal(health["voice.session"], "unknown");

const contextSource = fs.readFileSync(
  new URL("../src/lib/emery/context-engine.ts", import.meta.url),
  "utf8",
);
const typeSource = fs.readFileSync(
  new URL("../src/lib/emery/orchestration.types.ts", import.meta.url),
  "utf8",
);

for (const requiredTable of [
  "emery_field_sessions",
  "emery_execution_runs",
  "hpo_route_plans",
  "hpo_route_stops",
  "hpo_accounts",
  "hpo_prospects",
]) {
  assert(contextSource.includes(requiredTable), `context engine must read ${requiredTable}`);
}

assert(!contextSource.includes(".insert("), "Phase 1 context engine must remain read-only");
assert(!contextSource.includes(".update("), "Phase 1 context engine must remain read-only");
assert(!contextSource.includes(".upsert("), "Phase 1 context engine must remain read-only");
assert(typeSource.includes('"hpo_planner"'), "Planner must be a first-class Emery surface");
assert(typeSource.includes('"planner" | "today"'), "Planner must be a first-class HPO tab");

console.log(
  "Emery current-context validation passed (surface normalization, authority order, capability health, read-only context sources).",
);
