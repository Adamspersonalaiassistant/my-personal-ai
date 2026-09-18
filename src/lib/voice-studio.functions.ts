/* eslint-disable @typescript-eslint/no-explicit-any */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  REALTIME_VOICE_IDS,
  isRealtimeVoiceId,
  isUsableVoiceId,
  type RealtimeVoiceId,
} from "@/lib/voice-profile";
import {
  EMERY_DOMINICAN_ENGLISH_REFERENCE,
  EMERY_FEMININE_AUDITION_VOICE_IDS,
} from "@/lib/dominican-voice-reference";

type VoiceStudioDb = any;

type VoiceStudioContext = {
  db: VoiceStudioDb;
  userId: string;
  apiKey: string;
  text: string;
  recent: Array<{ role: string; text: string; createdAt?: string }>;
};

type SynthesizedProfile = {
  stable_identity: Record<string, unknown>;
  delivery_preferences: Record<string, number>;
  contextual_preferences: Record<string, unknown>;
  pronunciation_preferences: Record<string, unknown>;
};

function realtimeSafetyIdentifier(userId: string) {
  return "emery_" + createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

const safeObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

function namedVoice(text: string): RealtimeVoiceId | null {
  const lower = text.toLowerCase();
  for (const voice of REALTIME_VOICE_IDS) {
    if (new RegExp("\\b" + voice + "\\b", "i").test(lower)) return voice;
  }
  return null;
}

function feminineAuditionCandidate(value: unknown): value is RealtimeVoiceId {
  return (
    typeof value === "string" &&
    (EMERY_FEMININE_AUDITION_VOICE_IDS as readonly string[]).includes(value)
  );
}

function auditionCandidates() {
  return [...EMERY_FEMININE_AUDITION_VOICE_IDS] as RealtimeVoiceId[];
}

function wantsPreview(text: string) {
  return /\b(preview|hear|listen|sample|try|play)\b/i.test(text);
}

function deliveryPatchFromText(text: string) {
  const request = text.toLowerCase();
  const patch: Record<string, number> = {};
  if (/slow down|slower|more measured/.test(request)) patch["pace"] = 0.85;
  if (/speed up|faster|quicker/.test(request)) patch["pace"] = 1.15;
  if (/warmer|more warm|friendlier/.test(request)) patch["warmth"] = 0.72;
  if (/less warm|more neutral/.test(request)) patch["warmth"] = 0.45;
  if (/calmer|more calm|more grounded/.test(request)) patch["energy"] = 0.35;
  if (/more energetic|higher energy|more upbeat/.test(request)) patch["energy"] = 0.72;
  if (/more expressive|more animated/.test(request)) patch["expressiveness"] = 0.72;
  if (/less expressive|more restrained/.test(request)) patch["expressiveness"] = 0.35;
  if (/briefer|shorter|more concise/.test(request)) patch["brevity"] = 0.75;
  if (/more detailed|go deeper|less brief/.test(request)) patch["brevity"] = 0.35;
  return patch;
}

function stableVoicePatchFromText(text: string) {
  const request = text.toLowerCase();
  const patch: Record<string, unknown> = {};

  if (/\b(dominican|dominicana|dominican latina)\b/.test(request)) {
    patch["accent"] = EMERY_DOMINICAN_ENGLISH_REFERENCE.target.identity;
    patch["accent_description"] = EMERY_DOMINICAN_ENGLISH_REFERENCE.ttsInstruction;
    patch["accent_reference"] = "Dominican Republic / Santo Domingo Spanish-first bilingual English";
    patch["gender_presentation"] = "feminine";
  } else if (/\b(latina|latin american|latin-american|latino)\b/.test(request)) {
    patch["accent"] =
      "Natural Latina / Latin-American vocal character in fluent, polished English; warm rhythmic color with clear diction.";
    patch["accent_description"] =
      "Fluent natural English with a subtle Latina / Latin-American vocal character. Keep the rhythm and color audible but controlled, warm, modern, and clear. Do not assume a nationality or caricature an accent; Adam should choose the regional flavor and intensity.";
  }
  if (/accent.*(lighter|less|subtler|more subtle)|less.*accent/.test(request)) {
    patch["accent_intensity"] = 0.18;
  }
  if (/accent.*(stronger|more|noticeable)|more.*accent/.test(request)) {
    patch["accent_intensity"] = 0.38;
  }
  if (/\b(early 30s|early thirties)\b/.test(request)) patch["age_impression"] = "early 30s";
  if (/\b(woman|female|feminine)\b/.test(request)) patch["gender_presentation"] = "feminine";
  if (/perfect english|fluent english|speaks? english perfectly/.test(request)) {
    patch["english_fluency"] = "fully fluent, precise, natural English";
  }

  return patch;
}

function startsStudio(text: string) {
  return (
    /\b(voice studio|design (your|emery'?s)? voice|create (your|emery'?s)? voice|set ?up (your|emery'?s)? voice|start (your|emery'?s)? voice)\b/i.test(
      text,
    ) ||
    /\bi'?m ready to (create|design|set ?up|start) (your|emery'?s)? voice\b/i.test(text)
  );
}

function explicitApproval(text: string) {
  return (
    /\bi (explicitly )?approve\b/i.test(text) ||
    /\bapprove (this|that|it|[a-z]+)( as)? (emery'?s )?(base )?voice\b/i.test(text) ||
    /\b(that'?s|this is) the one\b/i.test(text) ||
    /\bmake (this|that|it|[a-z]+) (official|emery'?s (base )?voice)\b/i.test(text) ||
    /\buse (this|that|it|[a-z]+) as (your|emery'?s) (base )?voice\b/i.test(text)
  );
}

function pendingVoice(profile: any): RealtimeVoiceId | null {
  const contextual = safeObject(profile?.contextual_preferences);
  const studio = safeObject(contextual["voice_studio"]);
  const candidate = studio["pending_voice_id"];
  return isRealtimeVoiceId(candidate) ? candidate : null;
}

async function ensureProfile(db: VoiceStudioDb, userId: string) {
  const { data: profile, error } = await db
    .from("voice_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (profile) return profile;

  const { data: created, error: createError } = await db
    .from("voice_profiles")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (createError || !created) throw createError ?? new Error("Could not create Voice Profile");
  return created;
}

async function markStudioState(
  db: VoiceStudioDb,
  userId: string,
  profile: any,
  patch: Record<string, unknown>,
) {
  const contextual = safeObject(profile.contextual_preferences);
  const currentStudio = safeObject(contextual["voice_studio"]);
  const nextStudio = { ...currentStudio, ...patch, updated_at: new Date().toISOString() };

  const { data: updated, error } = await db
    .from("voice_profiles")
    .update({
      contextual_preferences: { ...contextual, voice_studio: nextStudio },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !updated) throw error ?? new Error("Could not update Voice Studio state");
  return updated;