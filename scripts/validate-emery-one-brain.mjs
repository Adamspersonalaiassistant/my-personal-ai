import assert from "node:assert/strict";
import fs from "node:fs";
import { routeEmeryCapabilities } from "../src/lib/emery/capability-router.ts";
import { createEmptyRequestContext } from "../src/lib/emery/orchestration.types.ts";
import { buildUnifiedVoiceContextPrompt } from "../src/lib/emery/voice-context-prompt.ts";

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

const prompt = buildUnifiedVoiceContextPrompt({
  currentContext: {
    observedAt: "2026-10-04T18:00:00.000Z",
    localDate: "2026-10-04",
    timezone: "America/New_York",
    mode: "hpo",
    domain: "hpo",
    authority: { route: "field_session", stop: "field_session" },
    request: hpoContext,
  },
  capabilityRoute: next,
  actionPlan: { goal: "read next stop", reads: ["hpo.route.read"], writes: [], intents: [] },
  loadPolicy: { loadHpoOperatingContext: false, loadPersonalMemory: false, loadCalendarContext: false },
});
assert(prompt.includes("AUTHORITATIVE CURRENT EMERY CONTEXT"));
assert(prompt.includes("route-1"));
assert(prompt.includes("hpo.route.get_next_stop"));
assert(prompt.includes("canonical controller results/receipts"));

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
const unifiedVoiceFunctionsSource = fs.readFileSync(
  new URL("../src/lib/emery/unified-voice.functions.ts", import.meta.url),
  "utf8",
);
const voiceRuntimeSource = fs.readFileSync(
  new URL("../src/lib/emery/voice-runtime.ts", import.meta.url),
  "utf8",
);
const voiceFunctionsSource = fs.readFileSync(
  new URL("../src/lib/voice.functions.ts", import.meta.url),
  "utf8",
);
const voiceControlSource = fs.readFileSync(
  new URL("../src/components/EmeryVoiceControl.tsx", import.meta.url),
  "utf8",
);

assert(voiceContextSource.includes("buildEmeryContext"));
assert(voiceContextSource.includes("prepareEmeryRequestRouting"));
assert(voiceBridgeSource.includes("processHpoFieldReadCommand"));
assert(voiceBridgeSource.includes("processHpoRouteStopAction"));
assert(voiceBridgeSource.includes("processHpoAction"));
assert(voiceBridgeSource.includes("processEmeryMultiIntentDayPlan"));
assert(voiceBridgeSource.includes("what did she say"));
assert(voiceBridgeSource.includes('return "What happened here last time?"'));
assert(unifiedVoiceSource.includes("loadPolicy.loadPersonalMemory"));
assert(unifiedVoiceSource.includes("loadPolicy.loadCalendarContext"));
assert(unifiedVoiceSource.includes("loadPolicy.loadHpoOperatingContext"));
assert(unifiedVoiceFunctionsSource.includes("readVoiceHpoFieldStateCore"));
assert(unifiedVoiceFunctionsSource.includes("executeVoiceHpoRouteStopCore"));
assert(unifiedVoiceFunctionsSource.includes("executeVoiceHpoRelationshipCore"));
assert(unifiedVoiceFunctionsSource.includes("executeVoiceHpoRouteCommandCore"));
assert(unifiedVoiceFunctionsSource.includes("executeVoiceCalendarCore"));
assert(voiceRuntimeSource.includes("executeUnifiedVoiceHpoFieldRead as executeVoiceHpoFieldRead"));
assert(voiceRuntimeSource.includes("refreshUnifiedVoiceContext as refreshVoiceContext"));

// Final Phase 3 integration requirements intentionally left as tiny edits:
// 1) Realtime session bootstrap loads the unified context and injects its compact authoritative block.
// 2) EmeryVoiceControl imports its operational tools from the one-brain runtime barrel.
assert(
  voiceFunctionsSource.includes("loadUnifiedVoiceContext"),
  "voice.functions.ts must use the unified Voice context loader for session bootstrap",
);
assert(
  voiceFunctionsSource.includes("buildUnifiedVoiceContextPrompt"),
  "voice.functions.ts must inject the compact authoritative one-brain context into Realtime instructions",
);
assert(
  voiceControlSource.includes('from "@/lib/emery/voice-runtime"'),
  "EmeryVoiceControl must use the one-brain runtime barrel for operational Voice tools",
);

console.log("Emery Phase 3 one-brain validation passed.");
