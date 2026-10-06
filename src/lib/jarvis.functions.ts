/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ensureJarvisAgent,
  ensureJarvisThread,
  handleJarvisTurn,
  jarvisStatusPanel,
  loadJarvisMessages,
} from "@/lib/jarvis/room";
import { currentBearerToken } from "@/lib/jarvis/request-auth";
import {
  DEFAULT_JARVIS_VOICE,
  isJarvisVoiceId,
  JARVIS_TEST_PHRASES,
  JARVIS_VOICE_CANDIDATES,
  JARVIS_VOICE_VERSION,
  jarvisPreviewInstructions,
  jarvisRealtimeInstructions,
  jarvisVoiceProfile,
  JARVIS_VOICE_LAB,
  kokoroSampleUrl,
  voiceLabCandidate,
  type JarvisVoiceId,
} from "@/lib/jarvis/voice";
import * as jarvisState from "@/lib/jarvis/state";
import { MODEL_POLICY } from "@/lib/model-policy";

export const getJarvisRoom = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    const thread = await ensureJarvisThread(db, context.userId, agent.id);
    const messages = await loadJarvisMessages(db, context.userId, thread.id);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        mission: agent.mission,
      },
      threadId: thread.id,
      messages,
    };
  });

export const getJarvisStatusPanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    jarvisStatusPanel(context.supabase as any, context.userId, await currentBearerToken()),
  );

export const sendJarvisMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { message: string; channel?: "typed" | "voice" }) => {
    const message = String(input?.message ?? "").trim();
    if (!message) throw new Error("Message is required");
    if (message.length > 8000) throw new Error("Message is too long");
    return {
      message,
      channel: input?.channel === "voice" ? ("voice" as const) : ("typed" as const),
    };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    return handleJarvisTurn(
      db,
      context.userId,
      agent,
      data.message,
      await currentBearerToken(),
      data.channel,
    );
  });

/**
 * JARVIS Voice: a Realtime session with JARVIS's own persistent voice identity.
 * Every spoken engineering request is routed through the jarvis_turn tool, which
 * the client fulfils with sendJarvisMessage(channel: "voice") — the same thread,
 * knowledge, task state and self-awareness as typed JARVIS. Emery Voice is untouched.
 */
export const createJarvisRealtimeSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The voice service isn't configured." } as const;
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    const { data: emeryVoice } = await db
      .from("voice_profiles")
      .select("base_voice_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const profile = jarvisVoiceProfile(agent.metadata, emeryVoice?.base_voice_id ?? null);
    const [status, version] = await Promise.all([
      jarvisState.getJarvisStatus(db, context.userId).catch(() => null),
      jarvisState.systemVersion(db, context.userId).catch(() => null),
    ]);
    const liveState = JSON.stringify({
      production_release: version?.latest_release
        ? {
            name: version.latest_release.name,
            commit: String(version.latest_release.commit).slice(0, 7),
          }
        : null,
      accepted_today: status?.accepted_today ?? null,
      capacity: status?.capacity ?? null,
      status_counts: status?.status_counts ?? null,
      approvals_required: status?.approvals_required?.length ?? 0,
    });
    const { createHash } = await import("node:crypto");
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier":
          "jarvis_" + createHash("sha256").update(context.userId).digest("hex").slice(0, 32),
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 120 },
        session: {
          type: "realtime",
          model: MODEL_POLICY.realtime,
          instructions: jarvisRealtimeInstructions(profile, liveState),
          output_modalities: ["audio"],
          audio: {
            input: {
              transcription: { model: MODEL_POLICY.transcription, language: "en" },
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: profile.voice, speed: profile.speed },
          },
          tools: [
            {
              type: "function",
              name: "jarvis_turn",
              description:
                "Send Adam's request to JARVIS's canonical runtime (same thread, knowledge, tools, task state and release self-awareness as typed JARVIS). Returns JARVIS's full written answer; speak a concise version of it.",
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                  request: { type: "string", description: "Adam's request in his own words." },
                },
                required: ["request"],
              },
            },
          ],
          tool_choice: "auto",
          max_output_tokens: 900,
        },
      }),
    });
    if (!response.ok) {
      console.error("JARVIS realtime secret failed", response.status);
      return { error: "JARVIS couldn't start a secure voice session right now." } as const;
    }
    const payload = (await response.json()) as { value?: string; expires_at?: number };
    if (!payload.value)
      return { error: "The voice service returned an invalid session token." } as const;
    // Evidence of the configuration actually used. The delivery spec lives in
    // code; only Adam's explicit audition choice is stored as voice_profile.
    await db
      .from("agents")
      .update({
        metadata: {
          ...(agent.metadata ?? {}),
          voice_last_session: {
            at: new Date().toISOString(),
            voice: profile.voice,
            speed: profile.speed,
            version: profile.version,
            selected_by: profile.selected_by,
          },
        },
      })
      .eq("id", agent.id)
      .eq("user_id", context.userId);
    return {
      clientSecret: payload.value,
      model: MODEL_POLICY.realtime,
      voice: profile.voice,
    } as const;
  });

/** Current JARVIS voice and the audition candidates (no provider call). */
export const getJarvisVoiceSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    const { data: emeryVoice } = await db
      .from("voice_profiles")
      .select("base_voice_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const profile = jarvisVoiceProfile(agent.metadata, emeryVoice?.base_voice_id ?? null);
    return {
      voice: profile.voice,
      selectedBy: profile.selected_by,
      version: profile.version,
      candidates: JARVIS_VOICE_CANDIDATES.filter((c) => c.id !== emeryVoice?.base_voice_id).map(
        (c) => ({ ...c }),
      ),
      phrases: [...JARVIS_TEST_PHRASES],
      lab: JARVIS_VOICE_LAB.filter((c) => c.id !== emeryVoice?.base_voice_id),
      labPreference: (agent.metadata?.voice_lab_preference?.id as string | undefined) ?? null,
    };
  });

/** Text-to-speech preview of a built-in OpenAI voice with the live JARVIS delivery. */
async function openAiPreview(voice: JarvisVoiceId, phrase: number) {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_POLICY.tts,
      voice,
      input: JARVIS_TEST_PHRASES[phrase],
      instructions: jarvisPreviewInstructions(),
      response_format: "mp3",
      speed: DEFAULT_JARVIS_VOICE.speed,
    }),
  });
  if (!response.ok) {
    console.error("JARVIS voice preview failed", response.status);
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
}

/**
 * Audition one JARVIS candidate voice speaking one fixed test phrase, using the
 * same delivery instructions as the live session. Text-to-speech preview of the
 * same built-in voice — close to, but not identical with, Realtime output.
 */
export const previewJarvisVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { voice: string; phrase: number }) => {
    if (!isJarvisVoiceId(input?.voice)) throw new Error("Unknown JARVIS voice candidate.");
    const phrase = Number(input?.phrase);
    if (!Number.isInteger(phrase) || phrase < 0 || phrase >= JARVIS_TEST_PHRASES.length)
      throw new Error("Unknown test phrase.");
    return { voice: input.voice as JarvisVoiceId, phrase };
  })
  .handler(async ({ data }) => {
    const audio = await openAiPreview(data.voice, data.phrase);
    return audio
      ? ({ audio } as const)
      : ({ error: "That preview couldn't be generated. Try again." } as const);
  });

/**
 * JARVIS Voice Lab preview for any candidate, with the same fixed phrase.
 * OpenAI: live TTS of the built-in voice. Kokoro: pre-rendered static sample.
 * Microsoft: the owner-only jarvis-voice-lab Edge Function (Azure key lives in
 * Supabase secrets; reports needsSetup until Adam adds the free key).
 */
export const previewJarvisVoiceLab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; phrase: number }) => {
    const candidate = voiceLabCandidate(input?.id);
    if (!candidate) throw new Error("Unknown Voice Lab candidate.");
    const phrase = Number(input?.phrase);
    if (!Number.isInteger(phrase) || phrase < 0 || phrase >= JARVIS_TEST_PHRASES.length)
      throw new Error("Unknown test phrase.");
    return { id: candidate.id, engine: candidate.engine, phrase };
  })
  .handler(async ({ data }) => {
    const started = Date.now();
    if (data.engine === "kokoro")
      return { audio: kokoroSampleUrl(data.id, data.phrase), source: "pre-rendered" } as const;
    if (data.engine === "openai") {
      const audio = await openAiPreview(data.id as JarvisVoiceId, data.phrase);
      return audio
        ? ({ audio, source: "live", latencyMs: Date.now() - started } as const)
        : ({ error: "That preview couldn't be generated. Try again." } as const);
    }
    const supabaseUrl = process.env["SUPABASE_URL"];
    const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
    const token = await currentBearerToken();
    if (!supabaseUrl || !publishableKey || !token)
      return { error: "Voice Lab isn't configured on the server." } as const;
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/jarvis-voice-lab`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ voice: data.id, phrase: data.phrase }),
      },
    ).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as {
      audio?: string;
      configured?: boolean;
      error?: string;
      latency_ms?: number;
    } | null;
    if (payload?.audio)
      return {
        audio: payload.audio,
        source: "live",
        latencyMs: payload.latency_ms ?? null,
      } as const;
    if (payload?.configured === false)
      return {
        error: "Microsoft voices need a free Azure Speech key (Adam's approval).",
        needsSetup: true,
      } as const;
    return { error: payload?.error ?? "The Microsoft preview failed." } as const;
  });

/** Records Adam's Voice Lab preference. Does not change the live JARVIS voice. */
export const preferJarvisVoiceLab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const candidate = voiceLabCandidate(input?.id);
    if (!candidate) throw new Error("Unknown Voice Lab candidate.");
    return { id: candidate.id };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    const { error } = await db
      .from("agents")
      .update({
        metadata: {
          ...(agent.metadata ?? {}),
          voice_lab_preference: { id: data.id, at: new Date().toISOString() },
        },
      })
      .eq("id", agent.id)
      .eq("user_id", context.userId);
    if (error) return { error: "Couldn't save the preference." } as const;
    return { id: data.id } as const;
  });

/** Adam's explicit choice of JARVIS voice. Never touches Emery's voice profile. */
export const selectJarvisVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { voice: string }) => {
    if (!isJarvisVoiceId(input?.voice)) throw new Error("Unknown JARVIS voice candidate.");
    return { voice: input.voice as JarvisVoiceId };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const agent = await ensureJarvisAgent(db, context.userId);
    const { data: emeryVoice } = await db
      .from("voice_profiles")
      .select("base_voice_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (emeryVoice?.base_voice_id === data.voice)
      return { error: "That is Emery's voice. JARVIS keeps a separate identity." } as const;
    const voiceProfile = {
      voice: data.voice,
      speed: DEFAULT_JARVIS_VOICE.speed,
      version: JARVIS_VOICE_VERSION,
      selected_by: "adam",
      selected_at: new Date().toISOString(),
    };
    const { error } = await db
      .from("agents")
      .update({ metadata: { ...(agent.metadata ?? {}), voice_profile: voiceProfile } })
      .eq("id", agent.id)
      .eq("user_id", context.userId);
    if (error) return { error: "Couldn't save the JARVIS voice." } as const;
    return { voice: data.voice } as const;
  });
