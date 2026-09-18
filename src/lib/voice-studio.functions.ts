/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  REALTIME_VOICE_IDS,
  isRealtimeVoiceId,
  type RealtimeVoiceId,
} from "@/lib/voice-profile";

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

function wantsPreview(text: string) {
  return /\b(preview|hear|listen|sample|try|play)\b/i.test(text);
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
  let { data: profile, error } = await db
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

function previewInstructions(profile: any) {
  const delivery = safeObject(profile?.delivery_preferences);
  const stable = safeObject(profile?.stable_identity);
  const parts = [
    "Speak as Emery, a highly intelligent, emotionally aware female personal AI companion.",
    "Sound natural, warm, confident, relaxed, conversational, and polished without sounding corporate or theatrical.",
    "Use natural pauses and restrained expressiveness.",
    "Pronounce Emery as Em-er-rie.",
  ];

  if (typeof stable["description"] === "string") parts.push(String(stable["description"]));
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
      model: "gpt-4o-mini-tts-2025-12-15",
      voice: voiceId,
      input:
        "Hey Adam. It's Emery. I want this to feel natural — like you can think out loud, change direction, and just talk to me. We'll figure things out together.",
      instructions: previewInstructions(profile),
      response_format: "mp3",
      speed: 1,
    }),
  });

  if (!response.ok) {
    console.error("Voice preview failed", response.status, await response.text());
    return null;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return "data:audio/mpeg;base64," + bytes.toString("base64");
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
            '\n\nReturn exactly this JSON shape:\n{"stable_identity":{"description":"short durable vocal identity description","age_impression":"only if Adam expressed one","tone":"short phrase"},"delivery_preferences":{"pace":1.0,"warmth":0.6,"expressiveness":0.55,"energy":0.5,"brevity":0.65},"contextual_preferences":{"general":"delivery guidance","hpo":"delivery guidance","personal":"delivery guidance","serious":"delivery guidance"},"pronunciation_preferences":{"Emery":"Em-er-rie"}}',
        },
      ],
    }),
  });

  const fallback: SynthesizedProfile = {
    stable_identity: {
      description:
        "Highly intelligent, emotionally aware, warm, confident, natural female personal AI companion.",
      tone: "natural, conversational, grounded, polished",
    },
    delivery_preferences: {
      pace: 1,
      warmth: 0.65,
      expressiveness: 0.55,
      energy: 0.5,
      brevity: 0.65,
    },
    contextual_preferences: {
      general: "Natural and conversational.",
      hpo: "Confident, concise, strategic, and operational without becoming sterile.",
      personal: "Warm, relaxed, emotionally aware, and direct.",
      serious: "Calm, grounded, precise, and unhurried.",
    },
    pronunciation_preferences: { Emery: "Em-er-rie" },
  };

  if (!response.ok) return fallback;
  const parsed = parseJsonObject(responseText(await response.json()));
  if (!parsed) return fallback;

  const rawDelivery = safeObject(parsed["delivery_preferences"]);
  const currentDelivery = safeObject(currentProfile?.delivery_preferences);

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

async function saveApprovedProfile(
  db: VoiceStudioDb,
  userId: string,
  profile: any,
  voiceId: RealtimeVoiceId,
  synthesized: SynthesizedProfile,
  changeRequest: string,
) {
  const { error: versionError } = await db.from("voice_profile_versions").insert({
    user_id: userId,
    voice_profile_id: profile.id,
    version: profile.version,
    snapshot: profile,
    change_request: changeRequest,
    change_source: "voice_studio",
  });
  if (versionError) throw versionError;

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
        preview_tts_model: "gpt-4o-mini-tts-2025-12-15",
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
  const maybeStudioTurn =
    startsStudio(text) ||
    wantsPreview(text) ||
    Boolean(candidate) ||
    approvalPhrase ||
    /\b(voice|voice studio)\b/i.test(text);
  if (!maybeStudioTurn) return null;

  const profile = await ensureProfile(db, userId);
  const currentPending = pendingVoice(profile);
  const contextual = safeObject(profile.contextual_preferences);
  const studioState = safeObject(contextual["voice_studio"]);
  const currentStage = String(studioState["stage"] ?? "");
  const recentVoiceContext = recent
    .slice(-6)
    .some((turn) => /\b(voice|voice studio|marin|cedar|coral|alloy|ash|ballad|echo|sage|shimmer|verse)\b/i.test(turn.text));
  const approvalAllowed =
    Boolean(candidate) ||
    /\bvoice\b/i.test(text) ||
    (["designing", "previewed", "candidate_selected"].includes(currentStage) && recentVoiceContext);

  if (approvalPhrase && approvalAllowed) {
    const chosen = candidate ?? currentPending;
    if (!chosen) {
      return {
        stage: "approval_needs_candidate" as const,
        operationSucceeded: false,
        note: "No previewed or named Realtime voice is available to approve yet.",
        candidates: REALTIME_VOICE_IDS,
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

  if (candidate && wantsPreview(text)) {
    const updated = await markStudioState(db, userId, profile, {
      stage: "previewed",
      pending_voice_id: candidate,
    });
    const audioDataUri = await makePreview(apiKey, candidate, updated);
    return {
      stage: "previewed" as const,
      operationSucceeded: Boolean(audioDataUri),
      voiceId: candidate,
      previewAudioDataUri: audioDataUri,
      note: audioDataUri
        ? "Actual provider audio preview generated. This is not approval."
        : "The preview request was recorded, but audio generation failed.",
      candidates: REALTIME_VOICE_IDS,
    };
  }

  if (startsStudio(text)) {
    await markStudioState(db, userId, profile, {
      stage: "designing",
      pending_voice_id: currentPending,
    });
    return {
      stage: "designing" as const,
      operationSucceeded: true,
      approvedVoiceId: profile.base_voice_id ?? null,
      candidates: REALTIME_VOICE_IDS,
      note:
        "Voice Studio is active in the normal Emery conversation. Candidate previews require a supported Realtime voice name.",
    };
  }

  if (candidate && /\b(select|choose|shortlist|candidate|like|prefer)\b/i.test(text)) {
    await markStudioState(db, userId, profile, {
      stage: "candidate_selected",
      pending_voice_id: candidate,
    });
    return {
      stage: "candidate_selected" as const,
      operationSucceeded: true,
      voiceId: candidate,
      candidates: REALTIME_VOICE_IDS,
      note: "Candidate stored for Voice Studio, but not approved.",
    };
  }

  return null;
}
