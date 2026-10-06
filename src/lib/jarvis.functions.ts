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
import { jarvisRealtimeInstructions, jarvisVoiceProfile } from "@/lib/jarvis/voice";
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
                "Send Adam's engineering request to JARVIS's canonical runtime (same thread, knowledge, tools, task state and release self-awareness as typed JARVIS). Returns JARVIS's evidence-based answer to speak.",
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
    // Persist the voice identity on the JARVIS agent the first time (idempotent).
    if (!agent.metadata?.voice_profile) {
      await db
        .from("agents")
        .update({ metadata: { ...(agent.metadata ?? {}), voice_profile: profile } })
        .eq("id", agent.id)
        .eq("user_id", context.userId);
    }
    return {
      clientSecret: payload.value,
      model: MODEL_POLICY.realtime,
      voice: profile.voice,
    } as const;
  });
