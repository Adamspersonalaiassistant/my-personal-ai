import { readFileSync } from "node:fs";

const files = {
  profile: readFileSync("src/lib/voice-profile.ts", "utf8"),
  studio: readFileSync("src/lib/voice-studio.functions.ts", "utf8"),
  realtime: readFileSync("src/lib/voice.functions.ts", "utf8"),
  control: readFileSync("src/components/EmeryVoiceControl.tsx", "utf8"),
  guard: readFileSync("src/lib/voice-session-guard.ts", "utf8"),
  chat: readFileSync("src/routes/_authenticated/conversation.tsx", "utf8"),
  britishReference: readFileSync("src/lib/british-voice-reference.ts", "utf8"),
};

const expectedVoices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];

const checks = [
  [
    "One Emery identity is preserved across chat and live Voice",
    files.profile.includes("Emery has one identity") &&
      files.realtime.includes("same Emery and the same lifelong conversation"),
  ],
  [
    "British Emery voice direction is explicit because Adam chose it",
    files.britishReference.includes("feminine British English voice") &&
      files.britishReference.includes("Southern British / modern RP") &&
      files.studio.includes("EMERY_BRITISH_ENGLISH_REFERENCE"),
  ],
  [
    "Emery auditions stay on the British user-selected allowlist",
    files.britishReference.includes("EMERY_BRITISH_AUDITION_VOICE_IDS") &&
      files.studio.includes("EMERY_BRITISH_AUDITION_VOICE_IDS") &&
      files.studio.includes("approvedAuditionCandidate") &&
      files.studio.includes("auditionCandidates"),
  ],
  [
    "Realtime Voice allowlist is centralized",
    expectedVoices.every((voice) => files.profile.includes(`"${voice}"`)) &&
      files.profile.includes("REALTIME_VOICE_IDS"),
  ],
  [
    "Voice Studio creates actual provider audio previews",
    files.studio.includes("https://api.openai.com/v1/audio/speech") &&
      files.studio.includes('"gpt-4o-mini-tts"'),
  ],
  [
    "Candidates are validated against Realtime before use",
    files.studio.includes("https://api.openai.com/v1/realtime/client_secrets") &&
      files.studio.includes("verifyRealtimeCandidate"),
  ],
  [
    "Approval requires the exact successful preview",
    files.studio.includes('currentStage === "previewed"') &&
      files.studio.includes('studioState["last_preview_succeeded"] === true') &&
      files.studio.includes("currentPending === chosen"),
  ],
  [
    "Approved profile is versioned and unlocks only after save",
    files.studio.includes("snapshotCurrentProfile") &&
      files.studio.includes("approved_at: approvedAt") &&
      files.studio.includes("micUnlocked: true"),
  ],
  [
    "Voice design feedback persists across turns",
    files.studio.includes("recordDesignNote") && files.studio.includes('"design_notes"'),
  ],
  [
    "Chat discloses AI-generated preview and requires explicit approval",
    files.chat.includes("AI-generated provider preview") &&
      files.chat.includes("I explicitly approve") &&
      files.chat.includes("Approve as Emery"),
  ],
  [
    "Live mic remains gated by a valid approved profile",
    files.realtime.includes("voiceProfile?.approved_at") &&
      files.realtime.includes("isUsableVoiceId(voiceProfile?.base_voice_id)"),
  ],
  [
    "Live Voice preserves web search and current context tools",
    files.realtime.includes('name: "search_web"') &&
      files.realtime.includes('name: "refresh_emery_context"'),
  ],
  [
    "Live Voice uses canonical Emery Calendar actions",
    files.realtime.includes('name: "execute_calendar_action"') &&
      files.realtime.includes("executeVoiceCalendarAction") &&
      files.control.includes('name === "execute_calendar_action"'),
  ],
  [
    "Live Voice uses canonical HPO relationship actions",
    files.realtime.includes('name: "execute_hpo_action"') &&
      files.realtime.includes("executeVoiceHpoAction") &&
      files.control.includes('name === "execute_hpo_action"'),
  ],
  [
    "Realtime tool calls handle completed function output items",
    files.control.includes('case "response.output_item.done"') &&
      files.control.includes('event.item?.type === "function_call"') &&
      files.control.includes("processedToolCallsRef"),
  ],
  [
    "Live Voice delivery updates remain versioned",
    files.realtime.includes("updateVoiceDeliveryFromLive") &&
      files.realtime.includes('change_source: "live_voice"'),
  ],
  [
    "Voice transcript persists into same main conversation",
    files.realtime.includes("persistVoiceTranscript") &&
      files.realtime.includes('entryPoint: "voice"') &&
      files.realtime.includes('channel", "main"'),
  ],
  [
    "Only one Emery Voice session can own audio at a time",
    files.control.includes("startingRef") &&
      files.control.includes("claimExclusiveEmeryVoice") &&
      files.control.includes("releaseExclusiveEmeryVoice") &&
      files.guard.includes("BroadcastChannel") &&
      files.guard.includes("localStorage"),
  ],
  [
    "Voice persistence has a defensive overlap de-dupe",
    files.realtime.includes("same_voice_transcript_within_2_seconds") &&
      files.realtime.includes("voice_session_id"),
  ],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} Emery Voice regression check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} Emery Voice regression checks passed.`);
