import assert from "node:assert/strict";
import fs from "node:fs";
import { routeEmeryCapabilities } from "../src/lib/emery/capability-router.ts";
import { CAPABILITY_REGISTRY } from "../src/lib/emery/capability-registry.ts";
import {
  contextLoadPolicy,
  emptyActionContext,
} from "../src/lib/emery/context-load-policy.ts";
import { prepareEmeryRequestRouting } from "../src/lib/emery/request-routing.ts";
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

const nextPolicy = contextLoadPolicy(next);
assert.equal(nextPolicy.isFocusedOperationalHpo, true);
assert.equal(nextPolicy.loadPersonalMemory, false);
assert.equal(nextPolicy.loadCalendarContext, false);
assert.equal(nextPolicy.loadHpoOperatingContext, true);

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

const taskOnHpoSurface = routeEmeryCapabilities({
  message: "Remind me to call this office tomorrow",
  context: hpoContext,
});
assert.equal(taskOnHpoSurface.needsCalendar, true, "task/reminder requests must keep Calendar context");
assert.equal(contextLoadPolicy(taskOnHpoSurface).loadCalendarContext, true);

const memory = routeEmeryCapabilities({
  message: "Do you remember what I told you about my preference?",
  context: createEmptyRequestContext({ userId: "user-1", timezone: "America/New_York" }),
});
assert.equal(memory.needsPersonalMemory, true);
assert(memory.candidateCapabilities.includes("memory.retrieve"));

const general = routeEmeryCapabilities({
  message: "Help me plan my afternoon",
  context: createEmptyRequestContext({ userId: "user-1", timezone: "America/New_York" }),
});
const generalPolicy = contextLoadPolicy(general);
assert.equal(generalPolicy.loadPersonalMemory, true);
assert.equal(
  generalPolicy.loadCalendarContext,
  true,
  "general/personal Emery must preserve the existing broad Calendar/task context",
);
assert.deepEqual(emptyActionContext().tasks, []);

const nearby = routeEmeryCapabilities({
  message: "Find the closest office near me",
  context: hpoContext,
});
assert.equal(nearby.needsLocation, true);
assert.equal(nearby.needsHpoContext, true);

const prepared = prepareEmeryRequestRouting({
  message: "Who’s next?",
  context: hpoContext,
  domainHint: "hpo",
});
assert.equal(prepared.capabilityRoute.needsPersonalMemory, false);
assert.equal(prepared.loadPolicy.isFocusedOperationalHpo, true);
assert.equal(prepared.actionPlan.version, 1, "the existing planner must remain the ActionPlan source");

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
const routingCall = chatSource.indexOf("prepareEmeryRequestRouting");
const legacyPlannerCall = chatSource.indexOf("const actionPlan = planEmeryRequest(data.message)");
assert(routingCall >= 0, "central Emery Chat must use the Phase 2 request-routing adapter");
assert(
  legacyPlannerCall < 0 || routingCall < legacyPlannerCall,
  "capability routing must happen before any direct legacy planner call",
);
assert(
  chatSource.includes("loadPolicy.loadPersonalMemory") &&
    chatSource.includes("loadPolicy.loadCalendarContext"),
  "central Emery Chat must use the load policy to avoid unrelated memory/Calendar loading",
);
assert(
  chatSource.includes("loadPolicy.loadHpoOperatingContext"),
  "central Emery Chat must use the load policy to scope HPO operating context",
);
assert(
  fieldReadSource.includes("whos next"),
  "the deterministic HPO field reader must recognize natural ‘Who’s next?’ phrasing after normalization",
);

console.log(
  "Emery Phase 2 capability-router validation passed (minimal routing, shared load policy, existing planner preservation, dependency metadata, structured failures, unavailable-capability preflight, and central-chat integration).",
);
