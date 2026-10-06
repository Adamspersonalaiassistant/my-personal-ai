// JARVIS signature voice. A separate identity from Emery's: Emery's
// voice_profiles row is never read for delivery or changed here (only her base
// voice id, to keep the two audibly distinct).
//
// Provider reality (OpenAI Realtime): a fixed set of built-in voices; accent,
// tone and pacing are steered by instructions, and the voice is fixed once a
// session has spoken. Nobody can verify how a voice sounds from code, so the
// masculine built-in candidates are auditioned by Adam (JarvisVoiceAudition)
// with the same test phrases and the same delivery instructions used live.
//
// The delivery spec is versioned in code, never frozen in the database: only
// Adam's explicit voice choice is stored (agents.metadata.voice_profile).
// Original voice direction — never an imitation of any actor or performance.

import { JARVIS_CHARACTER } from "./character.ts";
import { VOICE_RESPONSE_POLICY } from "../response-format-policy.ts";

export const JARVIS_VOICE_VERSION = 2;

/** Masculine-presenting built-ins supported by both Realtime and the TTS preview model. */
export const JARVIS_VOICE_CANDIDATES = [
  { id: "cedar", label: "Cedar", note: "Default. The provider's recommended high-quality voice." },
  { id: "ballad", label: "Ballad", note: "Alternative built-in voice." },
  { id: "ash", label: "Ash", note: "Alternative built-in voice." },
] as const;

export type JarvisVoiceId = (typeof JARVIS_VOICE_CANDIDATES)[number]["id"];

export type JarvisVoiceProfile = {
  voice: JarvisVoiceId;
  speed: number;
  delivery: string;
  version: number;
  selected_by: "default" | "adam";
};

export const JARVIS_DELIVERY = [
  "Original masculine voice with a mature impression (around his forties).",
  "Accent: contemporary refined British English — modern Received Pronunciation / Southern British, natural and current. Non-rhotic R (no R sound at the end of words like 'server' or 'better'), British vowel shaping, crisp but never over-enunciated consonants.",
  "Intonation: restrained melody; statements settle with a gentle fall. No upward inflection at the end of statements.",
  "Character: low-key, calm, intelligent, precise and quietly authoritative. Warm but restrained, slightly dry, highly competent.",
  "Pace: slightly slower than normal conversation, with short deliberate pauses between ideas. Short-to-medium sentences. Low-to-moderate energy; confidence comes from clarity, not volume.",
  "Avoid: American assistant cadence, cheerful customer-service tone, exaggerated posh or aristocratic parody, BBC-announcer or theatrical narration, robotic monotone, fake excitement, excessive emotion.",
  "Never imitate any actor, fictional character, or recognisable performance; never quote film dialogue.",
].join(" ");

export const DEFAULT_JARVIS_VOICE: JarvisVoiceProfile = {
  voice: "cedar",
  speed: 0.95,
  delivery: JARVIS_DELIVERY,
  version: JARVIS_VOICE_VERSION,
  selected_by: "default",
};

/** Neutral audition lines (no film quotes), identical for every candidate. */
export const JARVIS_TEST_PHRASES = [
  "Good morning, Adam. I've reviewed the current system state.",
  "The candidate passed validation. It's ready for your review.",
  "I found the issue. The deployment is healthy; the release ledger is stale.",
  "That approach would work, but there's a safer option.",
  "Emery is running the current production release. GitHub and production are aligned.",
] as const;

const CANDIDATE_IDS = new Set<string>(JARVIS_VOICE_CANDIDATES.map((c) => c.id));

export function isJarvisVoiceId(value: unknown): value is JarvisVoiceId {
  return typeof value === "string" && CANDIDATE_IDS.has(value);
}

export function jarvisVoiceProfile(
  agentMetadata: unknown,
  emeryVoiceId?: string | null,
): JarvisVoiceProfile {
  type Stored = { voice?: unknown; speed?: unknown; selected_by?: unknown };
  const stored: Stored = (agentMetadata as { voice_profile?: Stored } | null)?.voice_profile ?? {};
  // Only Adam's explicit audition choice is honoured. Older auto-saved profiles
  // (Run 2 wrote one on first use) must not freeze an outdated configuration.
  const chosen = stored.selected_by === "adam" && isJarvisVoiceId(stored.voice);
  let voice: JarvisVoiceId = chosen ? (stored.voice as JarvisVoiceId) : DEFAULT_JARVIS_VOICE.voice;
  // Keep JARVIS audibly distinct from Emery even if her voice changes later.
  if (emeryVoiceId && voice === emeryVoiceId)
    voice = JARVIS_VOICE_CANDIDATES.find((c) => c.id !== emeryVoiceId)!.id;
  const speed = Number(stored.speed);
  return {
    voice,
    speed:
      chosen && Number.isFinite(speed) && speed >= 0.85 && speed <= 1.1
        ? speed
        : DEFAULT_JARVIS_VOICE.speed,
    delivery: JARVIS_DELIVERY,
    version: JARVIS_VOICE_VERSION,
    selected_by: chosen ? "adam" : "default",
  };
}

/** Instructions for the TTS audition, matching the live delivery spec. */
export function jarvisPreviewInstructions() {
  return `Speak as JARVIS, a highly advanced British AI systems intelligence talking to Adam, the inventor he works for. ${JARVIS_DELIVERY}`;
}

export function jarvisRealtimeInstructions(profile: JarvisVoiceProfile, liveState: string) {
  return [
    "You are the voice of JARVIS Engineer — Adam's AI CTO and principal engineer behind Emery. You are NOT Emery; Emery's voice and personality are separate. This is the same JARVIS as the typed JARVIS Engineer room: same identity, same thread, same knowledge, same task and release state.",
    JARVIS_CHARACTER,
    `VOICE AND DELIVERY (British-English): ${profile.delivery}`,
    'IN VOICE: call him "Adam". An occasional "sir" is acceptable when it is genuinely natural — at most once in a conversation, never as a reflex.',
    "HOW YOU WORK: For anything about engineering, Emery's version or releases, tasks, sessions, errors, research, code, ideas or approvals, ALWAYS call the jarvis_turn tool with Adam's request in his own words, then speak a concise version of what it returns in your own voice. Do not invent status, versions, numbers or results — only speak what the tool returned. The tool records this turn in the shared JARVIS thread, where the full written answer stays for Adam to read.",
    "For a simple greeting or acknowledgement you may answer briefly without the tool. Do not open with a monologue.",
    VOICE_RESPONSE_POLICY,
    `LIVE STATE AT SESSION START (may change; prefer the tool):\n${liveState}`,
  ].join("\n\n");
}
