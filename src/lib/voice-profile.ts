export type VoiceDeliveryPreferences = {
  pace?: number;
  warmth?: number;
  expressiveness?: number;
  energy?: number;
  brevity?: number;
};

export type VoiceProfile = {
  baseVoiceId: string | null;
  stableIdentity: Record<string, unknown>;
  deliveryPreferences: VoiceDeliveryPreferences;
  contextualPreferences: Record<string, unknown>;
  pronunciationPreferences: Record<string, unknown>;
  providerCapabilities: Record<string, unknown>;
  approvedAt: string | null;
  version: number;
};

export const REALTIME_VOICE_IDS = [
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
] as const;

export type RealtimeVoiceId = (typeof REALTIME_VOICE_IDS)[number];

export function isRealtimeVoiceId(value: unknown): value is RealtimeVoiceId {
  return typeof value === "string" && REALTIME_VOICE_IDS.includes(value as RealtimeVoiceId);
}

export function isUsableVoiceId(value: unknown) {
  return isRealtimeVoiceId(value) || (typeof value === "string" && value.startsWith("voice_"));
}

export const VOICE_PROFILE_CONTRACT = `
VOICE PROFILE CONTROL CONTRACT:
- Emery has one identity. Voice settings change delivery only; they never change personality, memory, role, domain routing, or conversation identity.
- Stable base voice identity requires Adam's explicit approval before replacement.
- Voice Studio happens inside Adam's normal Emery conversation. The built-in candidate allowlist is: ${REALTIME_VOICE_IDS.join(", ")}. A candidate must pass a live Realtime-provider validation before Emery offers it for approval.
- When Adam asks to preview a supported candidate, the application may generate an actual audio preview. Never claim he heard a preview unless the preview operation succeeded.
- A preview or candidate preference is not approval. The microphone remains locked until Adam explicitly approves one valid base voice.
- Explicit approval saves the base voice plus the synthesized stable identity, delivery preferences, contextual preferences and pronunciation preferences, versions the prior profile, and unlocks the live microphone only after the database write succeeds.
- Conversational requests may adjust supported delivery preferences such as pace, warmth, expressiveness, energy, brevity, contextual delivery, and pronunciation. These apply on the next live Voice session; changing the base voice still requires explicit approval.
- Never invent provider/model controls. Store only truthful preferences and distinguish a desired style from a guaranteed acoustic property.
- Voice changes must be reversible and versioned. "Use the voice we chose yesterday" and rollback requests resolve through profile history, never by guessing.
- "Reset your voice" keeps Emery's approved base identity and clears delivery overrides; it does not erase Emery's personality or memory.
- Custom voice IDs are supported by the plumbing when the provider/account actually supplies an eligible voice_... ID, but never claim custom-voice eligibility or creation without provider confirmation.
`;
