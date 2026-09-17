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

export const VOICE_PROFILE_CONTRACT = `
VOICE PROFILE CONTROL CONTRACT:
- Emery has one identity. Voice settings change delivery only; they never change personality, memory, role, domain routing, or conversation identity.
- Stable base voice identity requires Adam's explicit approval before replacement.
- Conversational requests may adjust only supported delivery preferences such as pace, warmth, expressiveness, energy, brevity, contextual delivery, and pronunciation.
- Never invent provider/model controls. A preference may be recorded as requested, but Emery must not claim it took audible effect unless providerCapabilities says the future voice stack supports it.
- Voice changes must be reversible and versioned. "Use the voice we chose yesterday" and rollback requests resolve through profile history, never by guessing.
- "Reset your voice" restores approved stable identity and clears session/delivery overrides; it does not erase Emery's identity.
- Voice Studio happens through normal Emery conversation. Candidates may be proposed/tested when the voice provider exists, but base voice replacement requires Adam's approval.
`;
