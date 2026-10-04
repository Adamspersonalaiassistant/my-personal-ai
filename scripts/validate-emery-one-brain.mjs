import assert from "node:assert/strict";
import fs from "node:fs";
import { routeEmeryCapabilities } from "../src/lib/emery/capability-router.ts";
import { createEmptyRequestContext } from "../src/lib/emery/orchestration.types.ts";

const hpoContext = createEmptyRequestContext({
  userId: "user-1",
  timezone: "America/New_York",
  entryPoint: "voice",
  inputMode: "voice",
  surface: "hpo_planner",
  hpoTab: "planner",
  currentRouteId: "route-1",
  currentStopId: "stop-2",
  selectedAccountId: "account-2",
});

const next = routeEmeryCapabilities({ message: "Who’s next?", context: hpoContext, domainHint: "hpo" });
assert(next.candidateCapabilities.includes("hpo.route.get_next_stop"));
assert.equal(next.needsPersonalMemory, false);
assert.equal(next.needsCalendar, false);

const arrived = routeEmeryCapabilities({ message: "I’m here", context: hpoContext, domainHint: "hpo" });
assert(arrived.candidateCapabilities.includes("hpo.route_stop.arrive"));

const lastTime = routeEmeryCapabilities({
  message: "What happened here last time?",
  context: hpoContext,
  domainHint: "hpo",
});
assert(lastTime.candidateCapabilities.includes("hpo.account.get_context"));

const current = routeEmeryCapabilities({
  message: "What account am I at?",
  context: hpoContext,
  domainHint: "hpo",
});
assert(current.candidateCapabilities.includes("hpo.account.get_current"));

const pronoun = routeEmeryCapabilities({
  message: "What did she say?",
  context: hpoContext,
  domainHint: "hpo",
});
assert(pronoun.candidateCapabilities.includes("hpo.account.get_context"));

const personalWhileRouting = routeEmeryCapabilities({
  message: "Remind me what I told you about my family",
  context: hpoContext,
  domainHint: "hpo",
});
assert.notEqual(personalWhileRouting.domain, "hpo", "an active HPO route must not hijack a personal turn");
assert.equal(personalWhileRouting.needsPersonalMemory, true);

const voiceContextSource = fs.readFileSync(
  new URL("../src/lib/emery/voice-request-context.ts", import.meta.url),
  "utf8",
);
const voiceBridgeSource = fs.readFileSync(
  new URL("../src/lib/emery/voice-action-bridge.ts", import.meta.url),
  "utf8",
);
const unifiedVoiceSource = fs.readFileSync(
  new URL("../src/lib/emery/unified-voice-context.ts", import.meta.url),
  "utf8",
);
const voiceFunctionsSource = fs.readFileSync(
  new URL("../src/lib/voice.functions.ts", import.meta.url),
  "utf8",
);

assert(voiceContextSource.includes("buildEmeryContext"));
assert(voiceContextSource.includes("prepareEmeryRequestRouting"));
assert(voiceBridgeSource.includes("processHpoFieldReadCommand"));
assert(voiceBridgeSource.includes("processHpoRouteStopAction"));
assert(voiceBridgeSource.includes("processHpoAction"));
assert(voiceBridgeSource.includes("processEmeryMultiIntentDayPlan"));
assert(unifiedVoiceSource.includes("loadPolicy.loadPersonalMemory"));
assert(unifiedVoiceSource.includes("loadPolicy.loadCalendarContext"));
assert(unifiedVoiceSource.includes("loadPolicy.loadHpoOperatingContext"));

// Final Phase 3 integration requirement: live Voice must consume the shared bridge/context.
assert(
  voiceFunctionsSource.includes("loadUnifiedVoiceContext"),
  "voice.functions.ts must use the unified Voice context loader",
);
assert(
  voiceFunctionsSource.includes("readVoiceHpoFieldStateCore") &&
    voiceFunctionsSource.includes("executeVoiceHpoRouteStopCore") &&
    voiceFunctionsSource.includes("executeVoiceHpoRelationshipCore") &&
    voiceFunctionsSource.includes("executeVoiceHpoRouteCommandCore"),
  "Voice HPO tools must delegate to the shared one-brain action bridge",
);

console.log("Emery Phase 3 one-brain validation passed.");
