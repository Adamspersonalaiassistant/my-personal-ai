import assert from "node:assert/strict";
import fs from "node:fs";
import { routeEmeryCapabilities } from "../src/lib/emery/capability-router.ts";
import { CAPABILITY_REGISTRY } from "../src/lib/emery/capability-registry.ts";
import { createEmptyRequestContext } from "../src/lib/emery/orchestration.types.ts";
import { serializeError } from "../src/lib/emery/error-serializer.ts";
import { executeActionPlan } from "../src/lib/emery/executor.ts";

const hpoContext = createEmptyRequestContext({
  userId: "user-1",
  timezone: "America/New_York",
  surface: "hpo_planner",
  hpoTab: "planner",
  currentRouteId: "route-1",
  currentStopId: "stop-2",
  selectedAccountId: "account-2",
  capabilityHealth: {
    "hpo.route.read": "healthy",
    "hpo.route.write": "healthy",
    "hpo.crm.write": "healthy",
  },
});

const next = routeEmeryCapabilities({ message: "Who’s next?", context: hpoContext });
assert.equal(next.domain, "hpo");
assert.equal(next.needsHpoContext, true);
assert.equal(next.needsPersonalMemory, false);
assert.equal(next.needsCalendar, false);
assert.equal(next.needsLocation, false);
assert(next.candidateCapabilities.includes("hpo.route.get_next_stop"));
assert(next.candidateCapabilities.length <= 2, "next-stop routing must remain tightly scoped");

const arrived = routeEmeryCapabilities({ message: "I’m here.", context: hpoContext });
assert(arrived.candidateCapabilities.includes("hpo.route_stop.arrive"));
assert.equal(arrived.needsPersonalMemory, false);

const currentAccount = routeEmeryCapabilities({
  message: "What account am I at?",
  context: hpoContext,
});
assert(currentAccount.candidateCapabilities.includes("hpo.account.get_current"));

const lastTime = routeEmeryCapabilities({
  message: "What happened here last time?",
  context: hpoContext,
});
assert(lastTime.candidateCapabilities.includes("hpo.account.get_context"));
assert.equal(lastTime.needsPersonalMemory, false);

const calendar = routeEmeryCapabilities({
  message: "What meetings do I have today?",
  context: createEmptyRequestContext({ userId: "user-1", timezone: "America/New_York" }),
});
assert.equal(calendar.needsCalendar, true);
assert(calendar.candidateCapabilities.includes("calendar.read"));

const memory = routeEmeryCapabilities({
  message: "Do you remember what I told you about my preference?",
  context: createEmptyRequestContext({ userId: "user-1", timezone: "America/New_York" }),
});
assert.equal(memory.needsPersonalMemory, true);
assert(memory.candidateCapabilities.includes("memory.retrieve"));

const nearby = routeEmeryCapabilities({
  message: "Find the closest office near me",
  context: hpoContext,
});
assert.equal(nearby.needsLocation, true);
assert.equal(nearby.needsHpoContext, true);

for (const [action, capability] of Object.entries(CAPABILITY_REGISTRY)) {
  assert(Array.isArray(capability.requires), `${action} must declare requires`);
  assert(Array.isArray(capability.optional), `${action} must declare optional requirements`);
  assert(capability.fallback, `${action} must declare a fallback`);
  assert(Number(capability.timeoutMs) > 0, `${action} must declare a positive timeout`);
  assert(Number(capability.retryPolicy?.maxAttempts) >= 1, `${action} must declare retry policy`);
  assert(capability.degradedBehavior, `${action} must declare degraded behavior`);
}

const networkFailure = serializeError(new Error("fetch failed while loading route"), {
  capability: "hpo.route",
  operation: "hpo.route.read",
});
assert.equal(networkFailure.failureCode, "NETWORK_FAILURE");
assert.equal(networkFailure.retryable, true);
assert(networkFailure.userMessage?.includes("connection"));

const staleFailure = serializeError(new Error("offline_conflict: changed after snapshot"));
assert.equal(staleFailure.failureCode, "STALE_STATE");
assert.equal(staleFailure.retryable, false);

let unavailableHandlerRan = false;
const blocked = await executeActionPlan({
  plan: {
    version: 1,
    goal: "read route",
    intents: [
      {
        id: "hpo.route:hpo.route.read",
        capability: "hpo.route",
        action: "hpo.route.read",
        mode: "read",
        risk: "low",
        dependsOn: [],
        entities: [],
        reason: "fixture",
      },
    ],
    entities: [],
    reads: ["hpo.route.read"],
    writes: [],
    clarifications: [],
    expectedReceipts: [],
  },
  context: createEmptyRequestContext({
    userId: "user-1",
    timezone: "America/New_York",
    capabilityHealth: { "hpo.route.read": "unavailable" },
  }),
  handlers: {
    "hpo.route.read": async () => {
      unavailableHandlerRan = true;
      throw new Error("handler should not run when capability health is unavailable");
    },
  },
});
assert.equal(unavailableHandlerRan, false);
assert.equal(blocked.receipts[0]?.status, "safe_noop");
assert.equal(blocked.receipts[0]?.error?.failureCode, "CAPABILITY_UNAVAILABLE");

const chatSource = fs.readFileSync(new URL("../src/lib/emery.functions.ts", import.meta.url), "utf8");
const fieldReadSource = fs.readFileSync(
  new URL("../src/lib/hpo-field-read-controller.ts", import.meta.url),
  "utf8",
);
const routerCall = chatSource.indexOf("const capabilityRoute = routeEmeryCapabilities");
const plannerCall = chatSource.indexOf("const actionPlan = planEmeryRequest(data.message)");
assert(routerCall >= 0, "central Emery Chat must invoke the deterministic capability router");
assert(
  routerCall < plannerCall,
  "capability routing must happen before the existing planner",
);
assert(
  chatSource.includes("capabilityRoute.needsPersonalMemory") &&
    chatSource.includes("capabilityRoute.needsCalendar"),
  "central Emery Chat must use router needs to avoid unrelated personal-memory and Calendar loading",
);
assert(
  chatSource.includes("capabilityRoute.needsHpoContext"),
  "central Emery Chat must use the router to scope HPO context loading",
);
assert(
  fieldReadSource.includes("whos next") || fieldReadSource.includes("who(?: is|s) next"),
  "the deterministic HPO field reader must recognize natural ‘Who’s next?’ phrasing after normalization",
);

console.log(
  "Emery Phase 2 capability-router validation passed (minimal routing, dependency metadata, structured failures, unavailable-capability preflight, and central-chat integration).",
);
