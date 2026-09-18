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
    patch["accent"] =
      "Subtle Dominican Latina accent in otherwise fluent, polished English; native character is audible but light.";
    patch["accent_description"] =
      "Fluent natural English with a subtle Dominican Latina accent. Keep the Dominican character lightly audible in rhythm and color without reducing clarity. Never caricature or overperform the accent.";
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
}

async function recordDesignNote(
  db: VoiceStudioDb,
  userId: string,
  profile: any,
  text: string,
  patch: Record<string, unknown> = {},
) {
  const contextual = safeObject(profile.contextual_preferences);
  const studio = safeObject(contextual["voice_studio"]);
  const existingNotes = Array.isArray(studio["design_notes"])
    ? (studio["design_notes"] as unknown[])
        .filter((value): value is string => typeof value === "string")
        .slice(-19)
    : [];
  const note = text.trim().slice(0, 2400);
  const designNotes =
    note && existingNotes[existingNotes.length - 1] !== note
      ? [...existingNotes, note].slice(-20)
      : existingNotes;

  return markStudioState(db, userId, profile, {
    ...patch,
    design_notes: designNotes,
  });
}

function previewInstructions(profile: any) {
  const delivery = safeObject(profile?.delivery_preferences);
  const stable = safeObject(profile?.stable_identity);
  const parts = [
    "Speak as Emery, a highly intelligent, emotionally aware female personal AI companion.",
    EMERY_DOMINICAN_ENGLISH_REFERENCE.ttsInstruction,
    "The requested presentation is feminine. Do not masculinize the voice.",
    "Sound natural, warm, confident, relaxed, conversational, and polished without sounding corporate or theatrical.",
    "Pronounce Emery as Em-er-rie.",
  ];

  if (typeof stable["description"] === "string") parts.push(String(stable["description"]));
  if (typeof stable["age_impression"] === "string" && stable["age_impression"]) {
    parts.push(`Target the requested age impression naturally: ${String(stable["age_impression"])}.`);
  }
  if (typeof stable["accent"] === "string" && stable["accent"]) {
    parts.push(`Use the requested accent or regional character naturally: ${String(stable["accent"])}.`);
  }
  if (typeof stable["accent_description"] === "string" && stable["accent_description"]) {
    parts.push(`Accent detail: ${String(stable["accent_description"])}`);
  }
  if (typeof stable["tone"] === "string" && stable["tone"]) {
    parts.push(`Overall vocal tone: ${String(stable["tone"])}.`);
  }
  if (typeof stable["character"] === "string" && stable["character"]) {
    parts.push(`Vocal character: ${String(stable["character"])}.`);
  }
  const contextual = safeObject(profile?.contextual_preferences);
  if (typeof contextual["general"] === "string") {
    parts.push(`General delivery guidance: ${String(contextual["general"])}`);
  }
  if (Number(delivery["warmth"]) >= 0.65) parts.push("Lean warmer and more personable.");
  if (Number(delivery["energy"]) <= 0.4) parts.push("Keep the energy calm and grounded.");
  if (Number(delivery["energy"]) >= 0.65) parts.push("Use slightly more energetic delivery.");
  if (Number(delivery["expressiveness"]) >= 0.65) parts.push("Use more natural emotional variation.");
  return parts.join(" ");
}

async function makePreview(apiKey: string, voiceId: RealtimeVoiceId, profile: any) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: voiceId,
      input: EMERY_DOMINICAN_ENGLISH_REFERENCE.previewScript,
      instructions: previewInstructions(profile),
      response_format: "mp3",
      speed: clamp(safeObject(profile?.delivery_preferences)["pace"], 0.75, 1.25, 1),
    }),
  });

  if (!response.ok) {
    console.error("Voice preview failed", response.status, await response.text());
    return null;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return "data:audio/mpeg;base64," + bytes.toString("base64");
}

async function verifyRealtimeCandidate(apiKey: string, userId: string, voiceId: RealtimeVoiceId) {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": realtimeSafetyIdentifier(userId),
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 60 },
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1",
        output_modalities: ["audio"],
        audio: {
          output: {
            voice: voiceId,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    console.error("Realtime voice candidate validation failed", response.status, await response.text());
    return false;
  }
  const payload = (await response.json()) as { value?: string };
  return Boolean(payload.value);
}


function parseJsonObject(text: string) {
  const trimmed = text.trim().replace(/^~~~json\s*/i, "").replace(/~~~$/i, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function responseText(payload: any) {
  return typeof payload.output_text === "string"
    ? payload.output_text.trim()
    : (payload.output ?? [])
        .flatMap((item: any) => item.content ?? [])
        .filter((item: any) => item.type === "output_text")
        .map((item: any) => item.text ?? "")
        .join("")
        .trim();
}

async function synthesizeProfile(
  apiKey: string,
  recent: VoiceStudioContext["recent"],
  selectedVoice: RealtimeVoiceId,
  currentProfile: any,
): Promise<SynthesizedProfile> {
  const transcript = recent
    .slice(-24)
    .map((turn) => (turn.role === "assistant" ? "EMERY: " : "ADAM: ") + turn.text)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content:
            "Extract Adam's explicitly stated or clearly confirmed Emery Voice preferences from the conversation. Return JSON only. Do not invent preferences he did not express. Numbers are 0 to 1 except pace, which is 0.75 to 1.25. Preserve one stable Emery identity across contexts.",
        },
        {
          role: "user",
          content:
            "Selected Realtime base voice: " +
            selectedVoice +
            "\n\nCurrent stored Voice Profile:\n" +
            JSON.stringify(currentProfile ?? {}) +
            "\n\nRecent Voice Studio conversation:\n" +
            transcript +
            '\n\nReturn exactly this JSON shape:\n{"stable_identity":{"description":"short durable vocal identity description","age_impression":"only if Adam expressed one","accent":"only if Adam expressed one","tone":"short phrase","character":"confidence, authority, humor/playfulness, polish/casual balance only when expressed"},"delivery_preferences":{"pace":1.0,"warmth":0.6,"expressiveness":0.55,"energy":0.5,"brevity":0.65},"contextual_preferences":{"general":"delivery guidance","hpo":"delivery guidance","personal":"delivery guidance","serious":"delivery guidance"},"pronunciation_preferences":{"Emery":"Em-er-rie","OTHER_TERM":"include additional names/terms only when Adam explicitly specified a pronunciation"}}',
        },
      ],
    }),
  });

  const currentDelivery = safeObject(currentProfile?.delivery_preferences);
  const fallback: SynthesizedProfile = {
    stable_identity: {
      description:
        "Highly intelligent, emotionally aware, warm, confident, natural female personal AI companion.",
      tone: "natural, conversational, grounded, polished",
      ...safeObject(currentProfile?.stable_identity),
    },
    delivery_preferences: {
      pace: clamp(currentDelivery["pace"], 0.75, 1.25, 1),
      warmth: clamp(currentDelivery["warmth"], 0, 1, 0.65),
      expressiveness: clamp(currentDelivery["expressiveness"], 0, 1, 0.55),
      energy: clamp(currentDelivery["energy"], 0, 1, 0.5),
      brevity: clamp(currentDelivery["brevity"], 0, 1, 0.65),
    },
    contextual_preferences: {
      general: "Natural and conversational.",
      hpo: "Confident, concise, strategic, and operational without becoming sterile.",
      personal: "Warm, relaxed, emotionally aware, and direct.",
      serious: "Calm, grounded, precise, and unhurried.",
      ...safeObject(currentProfile?.contextual_preferences),
    },
    pronunciation_preferences: {
      Emery: "Em-er-rie",
      ...safeObject(currentProfile?.pronunciation_preferences),
    },
  };

  if (!response.ok) return fallback;
  const parsed = parseJsonObject(responseText(await response.json()));
  if (!parsed) return fallback;

  const rawDelivery = safeObject(parsed["delivery_preferences"]);

  return {
    stable_identity: {
      ...safeObject(currentProfile?.stable_identity),
      ...safeObject(parsed["stable_identity"]),
    },
    delivery_preferences: {
      pace: clamp(rawDelivery["pace"] ?? currentDelivery["pace"], 0.75, 1.25, 1),
      warmth: clamp(rawDelivery["warmth"] ?? currentDelivery["warmth"], 0, 1, 0.65),
      expressiveness: clamp(
        rawDelivery["expressiveness"] ?? currentDelivery["expressiveness"],
        0,
        1,
        0.55,
      ),
      energy: clamp(rawDelivery["energy"] ?? currentDelivery["energy"], 0, 1, 0.5),
      brevity: clamp(rawDelivery["brevity"] ?? currentDelivery["brevity"], 0, 1, 0.65),
    },
    contextual_preferences: {
      ...safeObject(currentProfile?.contextual_preferences),
      ...safeObject(parsed["contextual_preferences"]),
    },
    pronunciation_preferences: {
      ...safeObject(currentProfile?.pronunciation_preferences),
      Emery: "Em-er-rie",
      ...safeObject(parsed["pronunciation_preferences"]),
    },
  };
}

async function saveDraftProfile(
  db: VoiceStudioDb,
  userId: string,
  profile: any,
  voiceId: RealtimeVoiceId,
  synthesized: SynthesizedProfile,
) {
  const contextual = {
    ...synthesized.contextual_preferences,
    voice_studio: {
      ...safeObject(safeObject(synthesized.contextual_preferences)["voice_studio"]),
      stage: "previewed",
      pending_voice_id: voiceId,
      last_preview_succeeded: true,
      last_previewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  const { data: updated, error } = await db
    .from("voice_profiles")
    .update({
      stable_identity: synthesized.stable_identity,
      delivery_preferences: synthesized.delivery_preferences,
      contextual_preferences: contextual,
      pronunciation_preferences: synthesized.pronunciation_preferences,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error || !updated) throw error ?? new Error("Could not save Voice Studio draft");
  return updated;
}

async function snapshotCurrentProfile(
  db: VoiceStudioDb,
  userId: string,
  profile: any,
  changeRequest: string,
  changeSource: string,
) {
  const { error } = await db.from("voice_profile_versions").insert({
    user_id: userId,
    voice_profile_id: profile.id,
    version: profile.version,
    snapshot: profile,
    change_request: changeRequest.slice(0, 4000),
    change_source: changeSource,
  });
  if (error) throw error;
}

async function saveApprovedProfile(
  db: VoiceStudioDb,
  userId: string,
  profile: any,
  voiceId: RealtimeVoiceId,
  synthesized: SynthesizedProfile,
  changeRequest: string,
) {
  await snapshotCurrentProfile(
    db,
    userId,
    profile,
    changeRequest,
    "voice_studio",
  );

  const currentCapabilities = safeObject(profile.provider_capabilities);
  const contextual = safeObject(synthesized.contextual_preferences);
  const studio = safeObject(contextual["voice_studio"]);
  const approvedAt = new Date().toISOString();

  const { data: updated, error } = await db
    .from("voice_profiles")
    .update({
      base_voice_id: voiceId,
      stable_identity: synthesized.stable_identity,
      delivery_preferences: synthesized.delivery_preferences,
      contextual_preferences: {
        ...contextual,
        voice_studio: {
          ...studio,
          stage: "approved",
          pending_voice_id: voiceId,
          approved_voice_id: voiceId,
          approved_at: approvedAt,
        },
      },
      pronunciation_preferences: synthesized.pronunciation_preferences,
      provider_capabilities: {
        ...currentCapabilities,
        status: "live_voice_approved",
        realtime_model: "gpt-realtime-2.1",
        realtime_builtin_voice: true,
        preview_tts_model: "gpt-4o-mini-tts",
        speech_to_speech: true,
        semantic_vad: true,
        interruptions: true,
        input_transcription: true,
        web_search_tool: true,
        context_refresh_tool: true,
        same_conversation_persistence: true,
        durable_memory_persistence: true,
      },
      approved_at: approvedAt,
      version: Number(profile.version ?? 1) + 1,
      updated_at: approvedAt,
    })
    .eq("id", profile.id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error || !updated) throw error ?? new Error("Could not approve Emery Voice");
  return updated;
}

export async function processVoiceStudioTurn({
  db,
  userId,
  apiKey,
  text,
  recent,
}: VoiceStudioContext) {
  const candidate = namedVoice(text);
  const approvalPhrase = explicitApproval(text);
  const recentVoiceContextHint = recent
    .slice(0, -1)
    .slice(-8)
    .some((turn) =>
      /\b(voice|voice studio|marin|cedar|coral|alloy|ash|ballad|echo|sage|shimmer|verse|preview)\b/i.test(
        turn.text,
      ),
    );
  const designFeedback =
    /\b(warm|warmer|friendly|friendlier|slow|slower|fast|faster|measured|calm|calmer|grounded|energetic|energy|expressive|restrained|brief|concise|detailed|natural|robotic|corporate|casual|formal|professional|confident|authoritative|playful|serious|accent|latina|latino|latin american|latin-american|bilingual|spanish|dominican|dominicana|american|british|new york|new jersey|southern|female|feminine|mentor|friend|age|young|younger|mature|20s|30s|40s|50s|pitch|deeper|higher|lower)\b/i.test(
      text,
    ) || /\b(?:2[0-9]|3[0-9]|4[0-9]|5[0-9])\b/.test(text);
  const maybeStudioTurn =
    startsStudio(text) ||
    wantsPreview(text) ||
    Boolean(candidate) ||
    approvalPhrase ||
    /\b(voice|voice studio)\b/i.test(text) ||
    (recentVoiceContextHint && designFeedback);
  if (!maybeStudioTurn) return null;

  const profile = await ensureProfile(db, userId);

  if (candidate && !feminineAuditionCandidate(candidate)) {
    return {
      stage: "candidate_blocked" as const,
      operationSucceeded: false,
      voiceId: candidate,
      note:
        candidate === "marin"
          ? "Marin was already rejected by Adam as too generic/American for Emery."
          : candidate === "cedar"
            ? "Cedar was rejected by Adam as masculine/off-target. Emery is now locked to the feminine audition path."
            : "That provider voice is outside Emery's female-only audition allowlist.",
      candidates: auditionCandidates(),
    };
  }

  const currentPending = pendingVoice(profile);
  const contextual = safeObject(profile.contextual_preferences);
  const studioState = safeObject(contextual["voice_studio"]);
  const currentStage = String(studioState["stage"] ?? "");
  const refinement = deliveryPatchFromText(text);
  const stableRefinement = stableVoicePatchFromText(text);
  const resetDelivery = /\breset (?:your |emery'?s )?voice(?: delivery| settings)?\b/i.test(text);
  const rollbackVoice = /\b(previous voice|voice we chose yesterday|roll back .*voice|rollback .*voice)\b/i.test(text);

  if (rollbackVoice) {
    const { data: prior, error: priorError } = await db
      .from("voice_profile_versions")
      .select("snapshot")
      .eq("user_id", userId)
      .eq("voice_profile_id", profile.id)
      .lt("version", profile.version)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorError) throw priorError;
    if (!prior?.snapshot) {
      return {
        stage: "rollback_unavailable" as const,
        operationSucceeded: false,
        note: "There is no earlier Voice Profile version available to restore.",
      };
    }

    const previous = prior.snapshot;
    await snapshotCurrentProfile(db, userId, profile, text, "chat_voice_rollback");
    const restoredAt = new Date().toISOString();
    const { data: restored, error: restoreError } = await db
      .from("voice_profiles")
      .update({
        base_voice_id: previous.base_voice_id ?? profile.base_voice_id ?? null,
        stable_identity: previous.stable_identity ?? {},
        delivery_preferences: previous.delivery_preferences ?? {},
        contextual_preferences: previous.contextual_preferences ?? {},
        pronunciation_preferences: previous.pronunciation_preferences ?? {},
        provider_capabilities: previous.provider_capabilities ?? profile.provider_capabilities ?? {},
        approved_at: previous.approved_at ?? profile.approved_at ?? null,
        version: Number(profile.version ?? 1) + 1,
        updated_at: restoredAt,
      })
      .eq("id", profile.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (restoreError || !restored) throw restoreError ?? new Error("Could not restore Voice Profile");

    return {
      stage: "rolled_back" as const,
      operationSucceeded: true,
      voiceId: restored.base_voice_id ?? null,
      micUnlocked: Boolean(restored.approved_at && isUsableVoiceId(restored.base_voice_id)),
      note: "The previous versioned Voice Profile was restored.",
    };
  }

  if (
    (resetDelivery || Object.keys(refinement).length > 0 || Object.keys(stableRefinement).length > 0) &&
    profile.approved_at &&
    isUsableVoiceId(profile.base_voice_id)
  ) {
    await snapshotCurrentProfile(db, userId, profile, text, "chat_voice_refinement");
    const nextDelivery = resetDelivery
      ? {}
      : { ...safeObject(profile.delivery_preferences), ...refinement };
    const nextStable = { ...safeObject(profile.stable_identity), ...stableRefinement };
    const { data: updated, error: updateError } = await db
      .from("voice_profiles")
      .update({
        delivery_preferences: nextDelivery,
        stable_identity: nextStable,
        version: Number(profile.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .eq("user_id", userId)
      .select("base_voice_id,delivery_preferences,stable_identity,version,approved_at")
      .single();
    if (updateError || !updated) throw updateError ?? new Error("Could not refine Voice Profile");

    return {
      stage: resetDelivery ? ("delivery_reset" as const) : ("delivery_refined" as const),
      operationSucceeded: true,
      voiceId: updated.base_voice_id,
      micUnlocked: true,
      deliveryPreferences: updated.delivery_preferences,
      stableIdentity: updated.stable_identity,
      version: updated.version,
      note: resetDelivery
        ? "Voice delivery overrides were reset without changing Emery's approved base identity."
        : Object.keys(stableRefinement).length
          ? "Voice Profile refinement saved for Emery's approved voice. Accent/style changes are guaranteed on the next Voice session."
          : "Voice delivery preference saved for the approved Emery voice.",
    };
  }

  if (
    profile.approved_at &&
    isUsableVoiceId(profile.base_voice_id) &&
    designFeedback &&
    !approvalPhrase &&
    !wantsPreview(text) &&
    Object.keys(refinement).length === 0 &&
    Object.keys(stableRefinement).length === 0
  ) {
    const synthesized = await synthesizeProfile(
      apiKey,
      recent,
      profile.base_voice_id as RealtimeVoiceId,
      profile,
    );
    await snapshotCurrentProfile(db, userId, profile, text, "chat_voice_natural_refinement");
    const { data: updated, error: updateError } = await db
      .from("voice_profiles")
      .update({
        stable_identity: synthesized.stable_identity,
        delivery_preferences: synthesized.delivery_preferences,
        contextual_preferences: synthesized.contextual_preferences,
        pronunciation_preferences: synthesized.pronunciation_preferences,
        version: Number(profile.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .eq("user_id", userId)
      .select("base_voice_id,stable_identity,delivery_preferences,contextual_preferences,pronunciation_preferences,version,approved_at")
      .single();
    if (updateError || !updated) throw updateError ?? new Error("Could not refine approved Voice Profile");

    return {
      stage: "profile_refined" as const,
      operationSucceeded: true,
      voiceId: updated.base_voice_id,
      micUnlocked: true,
      profile: {
        stableIdentity: updated.stable_identity,
        deliveryPreferences: updated.delivery_preferences,
        contextualPreferences: updated.contextual_preferences,
        pronunciationPreferences: updated.pronunciation_preferences,
      },
      version: updated.version,
      note:
        "Emery updated the approved Voice Profile from Adam's natural-language refinement without restarting Voice Studio. The change is guaranteed on the next Voice session.",
    };
  }

  const recentVoiceContext = recentVoiceContextHint;
  const approvalAllowed =
    Boolean(candidate) ||
    /\bvoice\b/i.test(text) ||
    (["designing", "previewed", "candidate_selected"].includes(currentStage) && recentVoiceContext);

  if (
    currentStage === "previewed" &&
    designFeedback &&
    !approvalPhrase &&
    !wantsPreview(text)
  ) {
    await recordDesignNote(db, userId, profile, text, {
      stage: "designing",
      pending_voice_id: currentPending,
      last_preview_succeeded: false,
    });
    return {
      stage: "design_refined_needs_preview" as const,
      operationSucceeded: true,
      voiceId: currentPending,
      note:
        "Adam changed the Voice design after the last preview. The candidate must be previewed again before approval so he approves what he actually heard.",
      candidates: auditionCandidates(),
    };
  }

  if (approvalPhrase && approvalAllowed) {
    const chosen = candidate ?? currentPending;
    if (!chosen) {
      return {
        stage: "approval_needs_candidate" as const,
        operationSucceeded: false,
        note: "No previewed or named Realtime voice is available to approve yet.",
        candidates: auditionCandidates(),
      };
    }

    const previewConfirmed =
      currentStage === "previewed" &&
      currentPending === chosen &&
      studioState["last_preview_succeeded"] === true;
    if (!previewConfirmed) {
      return {
        stage: "approval_needs_preview" as const,
        operationSucceeded: false,
        voiceId: chosen,
        note:
          "Adam must hear an actual in-app provider preview of this candidate before it can become Emery's approved base voice.",
        candidates: auditionCandidates(),
      };
    }

    const realtimeSupported = await verifyRealtimeCandidate(apiKey, userId, chosen);
    if (!realtimeSupported) {
      return {
        stage: "approval_realtime_unsupported" as const,
        operationSucceeded: false,
        voiceId: chosen,
        note:
          "The candidate previewed successfully, but the Realtime provider did not accept it for a live Emery session, so it was not approved.",
        candidates: auditionCandidates(),
      };
    }

    const synthesized = await synthesizeProfile(apiKey, recent, chosen, profile);
    const updated = await saveApprovedProfile(
      db,
      userId,
      profile,
      chosen,
      synthesized,
      text,
    );
    return {
      stage: "approved" as const,
      operationSucceeded: true,
      voiceId: chosen,
      approvedAt: updated.approved_at,
      version: updated.version,
      profile: {
        stableIdentity: updated.stable_identity,
        deliveryPreferences: updated.delivery_preferences,
        contextualPreferences: updated.contextual_preferences,
        pronunciationPreferences: updated.pronunciation_preferences,
      },
      micUnlocked: true,
    };
  }

  if (
    candidate &&
    wantsPreview(text) &&
    (recentVoiceContext ||
      /\bvoice(?: studio)?\b/i.test(text) ||
      ["designing", "previewed", "candidate_selected"].includes(currentStage))
  ) {
    const realtimeSupported = await verifyRealtimeCandidate(apiKey, userId, candidate);
    if (!realtimeSupported) {
      await markStudioState(db, userId, profile, {
        stage: "candidate_selected",
        pending_voice_id: candidate,
        last_preview_succeeded: false,
      });
      return {
        stage: "preview_failed" as const,
        operationSucceeded: false,
        voiceId: candidate,
        previewAudioDataUri: null,
        draftProfileSaved: false,
        note:
          "The Realtime provider did not accept this candidate for a live Emery session, so no preview was offered for approval.",
        candidates: auditionCandidates(),
      };
    }

    const synthesized = await synthesizeProfile(apiKey, recent, candidate, profile);
    const previewProfile = {
      ...profile,
      stable_identity: synthesized.stable_identity,
      delivery_preferences: synthesized.delivery_preferences,
      contextual_preferences: synthesized.contextual_preferences,
      pronunciation_preferences: synthesized.pronunciation_preferences,
    };
    const audioDataUri = await makePreview(apiKey, candidate, previewProfile);

    if (!audioDataUri) {
      await markStudioState(db, userId, profile, {
        stage: "candidate_selected",
        pending_voice_id: candidate,
        last_preview_succeeded: false,
      });
      return {
        stage: "preview_failed" as const,
        operationSucceeded: false,
        voiceId: candidate,
        previewAudioDataUri: null,
        draftProfileSaved: false,
        note:
          "The provider did not return a playable preview, so this candidate cannot be approved yet.",
        candidates: auditionCandidates(),
      };
    }

    await saveDraftProfile(db, userId, profile, candidate, synthesized);
    return {
      stage: "previewed" as const,
      operationSucceeded: true,
      voiceId: candidate,
      previewAudioDataUri: audioDataUri,
      draftProfileSaved: true,
      note:
        "Actual provider audio preview generated using the current Voice Studio draft. This is not approval.",
      candidates: auditionCandidates(),
    };
  }

  if (startsStudio(text)) {
    await recordDesignNote(db, userId, profile, text, {
      stage: "designing",
      pending_voice_id: currentPending,
    });
    return {
      stage: "designing" as const,
      operationSucceeded: true,
      approvedVoiceId: profile.base_voice_id ?? null,
      candidates: auditionCandidates(),
      note:
        "Voice Studio is active in the normal Emery conversation. Adam's Dominican female-English design brief is saved. Only the feminine audition candidates returned here should be suggested or previewed.",
    };
  }

  if (
    candidate &&
    /\b(select|choose|shortlist|candidate|like|prefer)\b/i.test(text) &&
    (recentVoiceContext ||
      /\bvoice(?: studio)?\b/i.test(text) ||
      ["designing", "previewed", "candidate_selected"].includes(currentStage))
  ) {
    await markStudioState(db, userId, profile, {
      stage: "candidate_selected",
      pending_voice_id: candidate,
    });
    return {
      stage: "candidate_selected" as const,
      operationSucceeded: true,
      voiceId: candidate,
      candidates: auditionCandidates(),
      note: "Candidate stored for Voice Studio, but not approved.",
    };
  }

  if (recentVoiceContext && designFeedback && !approvalPhrase && !wantsPreview(text)) {
    await recordDesignNote(db, userId, profile, text, {
      stage: "designing",
      pending_voice_id: currentPending,
      last_preview_succeeded: false,
    });
    return {
      stage: "designing" as const,
      operationSucceeded: true,
      voiceId: currentPending,
      candidates: auditionCandidates(),
      note:
        "Voice design feedback was saved to the current Voice Studio draft. A fresh provider preview is required before approval.",
    };
  }

  return null;
}
