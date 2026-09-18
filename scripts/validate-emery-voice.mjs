import { readFileSync } from "node:fs";

const files = {
  profile: readFileSync("src/lib/voice-profile.ts", "utf8"),
  studio: readFileSync("src/lib/voice-studio.functions.ts", "utf8"),
  realtime: readFileSync("src/lib/voice.functions.ts", "utf8"),
  control: readFileSync("src/components/EmeryVoiceControl.tsx", "utf8"),
  chat: readFileSync("src/routes/_authenticated/chat.tsx", "utf8"),
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
    "Realtime Voice allowlist is centralized",
    expectedVoices.every((voice) => files.profile.includes(`"${voice}"`)) &&
      files.profile.includes("REALTIME_VOICE_IDS"),
  ],
  [
    "Voice Studio creates actual provider audio previews",
    files.studio.includes('https://api.openai.com/v1/audio/speech') &&
      files.studio.includes('"gpt-4o-mini-tts"'),
  ],
  [
    "Candidates are validated against Realtime before use",
    files.studio.includes('https://api.openai.com/v1/realtime/client_secrets') &&
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
    files.studio.includes("recordDesignNote") &&
      files.studio.includes('"design_notes"'),
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
