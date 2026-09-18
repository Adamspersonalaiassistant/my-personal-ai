/* eslint-disable @typescript-eslint/no-explicit-any */
import { isRealtimeVoiceId, REALTIME_VOICE_IDS } from "@/lib/voice-profile";

export type VoiceStudioEvent =
  | {
      type: "preview";
      voiceId: string;
      label: string;
      styleInstructions: string;
      audioDataUrl: string;
    }
  | {
      type: "draft_saved";
      candidateVoiceId: string | null;
    }
  | {
      type: "approved";
      voiceId: string;
      approvedAt: string;
    };

type Delivery = {
  pace?: number;
  warmth?: number;
  expressiveness?: number;
  energy?: number;
  brevity?: number;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number01(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
}

function delivery(value: unknown): Delivery {
  const input = object(value);
  return Object.fromEntries(
    [
      ["pace", number01(input["pace"])],
      ["warmth", number01(input["warmth"])],
      ["expressiveness", number01(input["expressiveness"])],
      ["energy", number01(input["energy"])],
      ["brevity", number01(input["brevity"])],
    ].filter(([, v]) => v !== undefined),
  ) as Delivery;
}

async function getOrCreateProfile(db: any, userId: string) {
  const existing = await db.from("voice_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await db.from("voice_profiles").insert({ user_id: userId }).select("*").single();
  if (created.error || !created.data) throw created.error ?? new Error("Could not create voice profile");
  return created.data;
}

async function versionProfile(db: any, userId: string, profile: any, request: string) {
  const { error } = await db.from("voice_profile_versions").insert({
    user_id: userId,
    voice_profile_id: profile.id,
    version: profile.version,
    snapshot: profile,
    change_request: request.slice(0, 2000),
    change_source: "voice_studio",
  });
  if (error) throw error;
}

export const VOICE_STUDIO_TOOLS = [
  {
    type: "function",
    name: "save_voice_design",
    description:
      "Save Adam's evolving Voice Studio preferences without approving or activating a base voice. Use during the design conversation after Adam gives meaningful voice preferences.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidate_voice_id: {
          type: ["string", "null"],
          enum: [...REALTIME_VOICE_IDS, null],
          description: "Optional current Realtime candidate. This is not approval.",
        },
        stable_identity: {
          type: "object",
          additionalProperties: true,
          description:
            "Durable vocal identity description: feminine presentation, age impression, accent style, confidence, warmth, rhythm, polish/casual balance, and other requested traits.",
        },
        delivery_preferences: {
          type: "object",
          additionalProperties: false,
          properties: {
            pace: { type: "number", minimum: 0, maximum: 1 },
            warmth: { type: "number", minimum: 0, maximum: 1 },
            expressiveness: { type: "number", minimum: 0, maximum: 1 },
            energy: { type: "number", minimum: 0, maximum: 1 },
            brevity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        contextual_preferences: {
          type: "object",
          additionalProperties: true,
          description: "How delivery adapts for Personal, HPO/work, serious, playful, planning, or stressed contexts.",
        },
        pronunciation_preferences: {
          type: "object",
          additionalProperties: true,
          description: "Stable pronunciation guidance, including Emery pronounced Em-er-rie.",
        },
      },
      required: [
        "candidate_voice_id",
        "stable_identity",
        "delivery_preferences",
        "contextual_preferences",
        "pronunciation_preferences",
      ],
    },
    strict: false,
  },
  {
    type: "function",
    name: "preview_voice_candidate",
    description:
      "Generate a real short audio preview for one supported Realtime voice candidate using Adam's requested vocal style. Use this when Adam asks to hear/test/audition a candidate.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        voice_id: { type: "string", enum: [...REALTIME_VOICE_IDS] },
        style_instructions: {
          type: "string",
          description:
            "Concise TTS delivery instructions reflecting Adam's requested voice identity, including accent only if Adam requested it. Do not stereotype an ethnicity; describe audible traits precisely.",
        },
        sample_text: {
          type: "string",
          description:
            "A natural 1-3 sentence Emery sample under 450 characters. It should sound like Emery speaking to Adam.",
        },
      },
      required: ["voice_id", "style_instructions", "sample_text"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "approve_voice_profile",
    description:
      "Permanently approve and activate the selected Emery base voice. ONLY call when Adam explicitly approves a previewed/supported candidate in his current message. Never call from Emery's own recommendation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        voice_id: { type: "string", enum: [...REALTIME_VOICE_IDS] },
        stable_identity: { type: "object", additionalProperties: true },
        delivery_preferences: {
          type: "object",
          additionalProperties: false,
          properties: {
            pace: { type: "number", minimum: 0, maximum: 1 },
            warmth: { type: "number", minimum: 0, maximum: 1 },
            expressiveness: { type: "number", minimum: 0, maximum: 1 },
            energy: { type: "number", minimum: 0, maximum: 1 },
            brevity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        contextual_preferences: { type: "object", additionalProperties: true },
        pronunciation_preferences: { type: "object", additionalProperties: true },
        approval_summary: {
          type: "string",
          description: "Short record of what Adam explicitly approved in this turn.",
        },
      },
      required: [
        "voice_id",
        "stable_identity",
        "delivery_preferences",
        "contextual_preferences",
        "pronunciation_preferences",
        "approval_summary",
      ],
    },
    strict: false,
  },
] as const;

function explicitApproval(text: string) {
  const value = text.toLowerCase();
  return /\b(i approve|approve (it|this|that)|that's the one|that is the one|make (that|this) emery|use (that|this) voice|finalize (it|this|that)|activate (it|this|that|the voice)|lock (it|this|that) in|yes[, ]+that's the one|yes[, ]+that is the one)\b/i.test(
    value,
  );
}

export async function executeVoiceStudioTool(args: {
  name: string;
  rawArguments: string;
  db: any;
  userId: string;
  apiKey: string;
  currentUserText: string;
  events: VoiceStudioEvent[];
}) {
  const { name, db, userId, apiKey, currentUserText, events } = args;
  let input: any = {};
  try {
    input = JSON.parse(args.rawArguments || "{}");
  } catch {
    return { ok: false, error: "Voice Studio received invalid tool arguments." };
  }

  if (name === "save_voice_design") {
    const profile = await getOrCreateProfile(db, userId);
    await versionProfile(db, userId, profile, currentUserText || "Voice Studio design update");
    const candidate =
      input.candidate_voice_id && isRealtimeVoiceId(input.candidate_voice_id)
        ? input.candidate_voice_id
        : null;
    const capabilities = {
      ...object(profile.provider_capabilities),
      status: profile.approved_at ? "approved" : "designing",
      voice_studio_candidate: candidate,
      voice_studio_updated_at: new Date().toISOString(),
    };
    const { error } = await db
      .from("voice_profiles")
      .update({
        stable_identity: object(input.stable_identity),
        delivery_preferences: delivery(input.delivery_preferences),
        contextual_preferences: object(input.contextual_preferences),
        pronunciation_preferences: object(input.pronunciation_preferences),
        provider_capabilities: capabilities,
        version: Number(profile.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .eq("user_id", userId);
    if (error) throw error;
    events.push({ type: "draft_saved", candidateVoiceId: candidate });
    return {
      ok: true,
      saved: true,
      activated: false,
      candidate_voice_id: candidate,
      note: "Voice design saved. The live microphone remains locked until Adam explicitly approves a base voice.",
    };
  }

  if (name === "preview_voice_candidate") {
    if (!isRealtimeVoiceId(input.voice_id)) {
      return { ok: false, error: "That voice is not supported by the Realtime model." };
    }
    const sample = String(input.sample_text ?? "").trim().slice(0, 450);
    const style = String(input.style_instructions ?? "").trim().slice(0, 1200);
    if (!sample) return { ok: false, error: "Preview text is empty." };

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: input.voice_id,
        input: sample,
        instructions: style || "Speak naturally, warmly, and conversationally.",
        response_format: "mp3",
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Voice preview failed", response.status, detail);
      return { ok: false, error: "The provider could not generate that preview right now." };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const audioDataUrl = `data:audio/mpeg;base64,${bytes.toString("base64")}`;
    events.push({
      type: "preview",
      voiceId: input.voice_id,
      label: `${input.voice_id} preview`,
      styleInstructions: style,
      audioDataUrl,
    });
    return {
      ok: true,
      preview_generated: true,
      voice_id: input.voice_id,
      note: "A real audio preview was generated and attached in the app. This is not approval.",
    };
  }

  if (name === "approve_voice_profile") {
    if (!explicitApproval(currentUserText)) {
      return {
        ok: false,
        error:
          "Approval blocked: Adam did not explicitly approve the base voice in his current message. Ask for a clear approval first.",
      };
    }
    if (!isRealtimeVoiceId(input.voice_id)) {
      return { ok: false, error: "That base voice is not valid for Emery Realtime Voice." };
    }

    const profile = await getOrCreateProfile(db, userId);
    await versionProfile(db, userId, profile, currentUserText);
    const approvedAt = new Date().toISOString();
    const capabilities = {
      ...object(profile.provider_capabilities),
      status: "approved",
      realtime_model: "gpt-realtime-2.1",
      speech_to_speech: true,
      semantic_vad: true,
      interruptions: true,
      input_transcription: true,
      web_search_tool: true,
      context_refresh_tool: true,
      same_conversation_persistence: true,
      durable_memory_persistence: true,
      approved_voice_id: input.voice_id,
      approved_at: approvedAt,
    };
    const pronunciation = {
      Emery: "Em-er-rie",
      ...object(input.pronunciation_preferences),
    };
    const { error } = await db
      .from("voice_profiles")
      .update({
        base_voice_id: input.voice_id,
        stable_identity: object(input.stable_identity),
        delivery_preferences: delivery(input.delivery_preferences),
        contextual_preferences: object(input.contextual_preferences),
        pronunciation_preferences: pronunciation,
        provider_capabilities: capabilities,
        approved_at: approvedAt,
        version: Number(profile.version ?? 1) + 1,
        updated_at: approvedAt,
      })
      .eq("id", profile.id)
      .eq("user_id", userId);
    if (error) throw error;

    events.push({ type: "approved", voiceId: input.voice_id, approvedAt });
    return {
      ok: true,
      activated: true,
      voice_id: input.voice_id,
      approved_at: approvedAt,
      note:
        "The approved base voice and full Voice Profile were saved successfully. The live Emery microphone is now unlocked.",
    };
  }

  return { ok: false, error: `Unknown Voice Studio tool: ${name}` };
}
