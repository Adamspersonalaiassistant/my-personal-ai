import assert from "node:assert/strict";
import fs from "node:fs";
import {
  NATURAL_VOICE_CONTRACT,
  VOICE_FOLLOW_UP_WINDOW_MS,
  classifyVoiceTurn,
  contextualizeVoiceCorrection,
  isLikelyAssistantVoiceEcho,
  isShortContextualVoiceFollowUp,
  isVoiceCorrectionTurn,
  isVoiceEndSessionCommand,
  isVoiceStopSpeakingCommand,
} from "../src/lib/emery/voice-conversation-policy.ts";

assert(isVoiceStopSpeakingCommand("Stop."));
assert(isVoiceStopSpeakingCommand("hold on"));
assert(!isVoiceStopSpeakingCommand("stop 3"));
assert(isVoiceEndSessionCommand("End voice"));
assert(isVoiceEndSessionCommand("stop listening"));

assert(isVoiceCorrectionTurn("Actually Thursday"));
assert(isVoiceCorrectionTurn("Sorry, Friday"));
assert(isVoiceCorrectionTurn("Make that 2 PM"));
assert(!isVoiceCorrectionTurn("Follow up Thursday"));

assert(isShortContextualVoiceFollowUp("Take me there"));
assert(isShortContextualVoiceFollowUp("What did she say?"));
assert(isShortContextualVoiceFollowUp("Actually Friday"));

assert(
  isLikelyAssistantVoiceEcho({
    userTranscript: "Macri Law is next. About twelve minutes away.",
    assistantTranscript: "Macri Law is next, about twelve minutes away.",
    assistantTranscriptAgeMs: 1200,
  }),
);
assert(
  !isLikelyAssistantVoiceEcho({
    userTranscript: "Take me there",
    assistantTranscript: "Macri Law is next, about twelve minutes away.",
    assistantTranscriptAgeMs: 1200,
  }),
);

assert.equal(
  classifyVoiceTurn({ transcript: "Stop", now: 10_000 }),
  "stop_speaking",
);
assert.equal(
  classifyVoiceTurn({ transcript: "End voice", now: 10_000 }),
  "end_session",
);
assert.equal(
  classifyVoiceTurn({
    transcript: "Take me there",
    now: 10_000,
    followUpUntil: 10_000 + VOICE_FOLLOW_UP_WINDOW_MS,
  }),
  "short_follow_up",
);
assert.equal(
  classifyVoiceTurn({ transcript: "Actually Thursday", now: 10_000 }),
  "correction",
);

const corrected = contextualizeVoiceCorrection("Actually Thursday", [
  { role: "user", text: "Follow up Tuesday" },
  { role: "assistant", text: "Got it. I set the follow-up for Tuesday." },
]);
assert(corrected.includes("Follow up Tuesday"));
assert(corrected.includes("Replace/supersede"));
assert.equal(
  contextualizeVoiceCorrection("Follow up Thursday", [
    { role: "user", text: "Follow up Tuesday" },
  ]),
  "Follow up Thursday",
);

assert(NATURAL_VOICE_CONTRACT.includes("Corrections supersede"));
assert(NATURAL_VOICE_CONTRACT.includes("stop the current spoken output"));
assert(NATURAL_VOICE_CONTRACT.includes("likely speaker echo"));

const contextPromptSource = fs.readFileSync(
  new URL("../src/lib/emery/voice-context-prompt.ts", import.meta.url),
  "utf8",
);
const bridgeSource = fs.readFileSync(
  new URL("../src/lib/emery/voice-action-bridge.ts", import.meta.url),
  "utf8",
);
const clientSafetySource = fs.readFileSync(
  new URL("../src/lib/emery/voice-client-safety.ts", import.meta.url),
  "utf8",
);
const voiceControlSource = fs.readFileSync(
  new URL("../src/components/EmeryVoiceControl.tsx", import.meta.url),
  "utf8",
);

assert(contextPromptSource.includes("NATURAL_VOICE_CONTRACT"));
assert(bridgeSource.includes("contextualizeVoiceCorrection"));
assert(clientSafetySource.includes('type: "response.cancel"'));
assert(clientSafetySource.includes('type: "output_audio_buffer.clear"'));

// Final Phase 4 client integration. These assertions intentionally make the
// remaining Work task tiny and explicit.
assert(
  voiceControlSource.includes("classifyVoiceTurn"),
  "EmeryVoiceControl must classify completed user transcripts for stop/end/echo/correction/follow-up behavior",
);
assert(
  voiceControlSource.includes("stopCurrentRealtimeSpeech"),
  "EmeryVoiceControl must explicitly stop current Realtime output for spoken stop/echo fallback",
);
assert(
  voiceControlSource.includes("voiceEventBelongsToAttempt"),
  "EmeryVoiceControl must ignore late events from cancelled/superseded Voice attempts",
);
assert(
  voiceControlSource.includes("lastAssistantTranscriptRef") &&
    voiceControlSource.includes("followUpUntilRef"),
  "EmeryVoiceControl must track recent assistant speech and a short follow-up window",
);

console.log("Emery Phase 4 natural Voice validation passed.");
