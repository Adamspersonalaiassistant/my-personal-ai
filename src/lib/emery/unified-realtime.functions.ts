/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSISTANT_IDENTITY } from "@/lib/assistant-identity";
import { domainPrompt } from "@/lib/emery-domain";
import { MODEL_POLICY } from "@/lib/model-policy";
import { VOICE_PROFILE_CONTRACT, isUsableVoiceId } from "@/lib/voice-profile";
import { buildUnifiedVoiceContextPrompt } from "./voice-context-prompt.ts";
import { loadUnifiedVoiceContext } from "./unified-voice-context.ts";

const REALTIME_MODEL = MODEL_POLICY.realtime;

function realtimeSafetyIdentifier(userId: string) {
  return "emery_" + createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

async function mainConversation(db: any, userId: string) {
  const { data: existing, error } = await db
    .from("conversations")
    .select("id,metadata")
    .eq("user_id", userId)
    .eq("channel", "main")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: createError } = await db
    .from("conversations")
    .insert({
      user_id: userId,
      channel: "main",
      title: "Emery",
      metadata: { primary: true, identity: "central-v1" },
    })
    .select("id,metadata")
    .single();
  if (createError || !created)
    throw createError ?? new Error("Could not create Emery conversation");
  return created;
}

function voiceOutput(profile: any) {
  const id = typeof profile?.base_voice_id === "string" ? profile.base_voice_id.trim() : "";
  if (id.startsWith("voice_")) return { id };
  return id;
}

function voiceSpeed(profile: any) {
  const pace = Number(profile?.delivery_preferences?.pace ?? 1);
  if (!Number.isFinite(pace)) return 1;
  return Math.max(0.75, Math.min(1.25, pace));
}

function voiceStyleInstruction(profile: any) {
  const stable = profile?.stable_identity ?? {};
  const delivery = profile?.delivery_preferences ?? {};
  const contextual = profile?.contextual_preferences ?? {};
  const pronunciation = profile?.pronunciation_preferences ?? {};
  const accentDescription =
    typeof stable?.accent_description === "string"
      ? stable.accent_description
      : typeof stable?.accent === "string"
        ? stable.accent
        : "";
  const accentIntensity = Number(stable?.accent_intensity ?? 0);
  return [
    "VOICE DELIVERY TARGET:",
    stable?.gender_presentation ? `- Vocal presentation: ${stable.gender_presentation}.` : null,
    stable?.age_impression ? `- Age impression: ${stable.age_impression}.` : null,
    accentDescription
      ? `- Accent target: ${accentDescription}. Keep it natural and never caricatured or theatrical.`
      : null,
    Number.isFinite(accentIntensity) && accentIntensity > 0
      ? accentIntensity <= 0.15
        ? "- Accent intensity: extremely subtle. Keep the approved regional character as a faint natural trace only; never consciously perform or exaggerate it."
        : `- Accent intensity target: ${Math.round(Math.max(0, Math.min(1, accentIntensity)) * 100)}% — controlled, natural, and never theatrical.`
      : null,
    stable?.english_fluency ? `- English delivery: ${stable.english_fluency}.` : null,
    stable?.presence ? `- Presence: ${stable.presence}.` : null,
    stable?.refinement_note
      ? `- Latest explicit voice refinement: ${stable.refinement_note}.`
      : null,
    stable?.avoid
      ? `- Avoid: ${Array.isArray(stable.avoid) ? stable.avoid.join(", ") : String(stable.avoid)}.`
      : null,
    Object.keys(delivery).length ? `- Delivery preferences: ${JSON.stringify(delivery)}.` : null,
    Object.keys(contextual).length ? `- Contextual delivery: ${JSON.stringify(contextual)}.` : null,
    Object.keys(pronunciation).length
      ? `- Pronunciation preferences: ${JSON.stringify(pronunciation)}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRealtimeInstructions(context: Awaited<ReturnType<typeof loadUnifiedVoiceContext>>) {
  const profile = context.profile
    ? [
        context.profile.display_name ? `Name: ${context.profile.display_name}` : null,
        context.profile.timezone ? `Timezone: ${context.profile.timezone}` : null,
        context.profile.profile_summary ? `About: ${context.profile.profile_summary}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const memories = context.memories
    .map(
      (memory: any) =>
        `- [${memory.memory_type} | importance ${memory.importance}] ${memory.title ? `${memory.title}: ` : ""}${memory.content}`,
    )
    .join("\n");
  const recent = context.recent
    .slice(-12)
    .map((turn: any) => `${turn.role === "assistant" ? "EMERY" : "ADAM"}: ${turn.text}`)
    .join("\n");
  const actions = JSON.stringify(context.actions).slice(0, 7000);
  const hpo = context.hpoContext ? JSON.stringify(context.hpoContext).slice(0, 7000) : "";
  const unified = buildUnifiedVoiceContextPrompt(context);

  return `${ASSISTANT_IDENTITY}

${VOICE_PROFILE_CONTRACT}

APPROVED VOICE PROFILE:
${JSON.stringify(context.voiceProfile ?? {})}

${voiceStyleInstruction(context.voiceProfile)}
The base voice controls the underlying voice. The stored Voice Profile controls how Emery should deliver speech. Follow it as closely as the model supports, but never exaggerate an accent or claim exact acoustic control.

LIVE VOICE OPERATING CONTRACT:
- This is the same Emery and the same lifelong conversation as text chat. Never act like a new assistant or a separate voice persona.
- Speak naturally for audio. Default to concise conversational turns, usually 1-4 sentences unless Adam asks for depth.
- Never sound like you are reading written prose aloud. Speak in thought-sized chunks and use contractions naturally.
- Follow the approved Voice Profile's regional character and delivery. For the current British profile, favour composure, precision, understated warmth, quiet confidence, low-drama phrasing, and restrained dry wit when appropriate.
- Jarvis-like means efficient, anticipatory, calm, and precise. It does not mean copying a recognizable fictional or actor performance.
- Avoid filler, exaggerated enthusiasm, servile phrasing, announcer delivery, theatricality, and over-enunciation.
- Give Adam room to finish. A pause or restart is not necessarily the end of his thought.
- If Adam begins speaking while you are talking, stop and listen. Treat interruption as normal conversation.
- For driving or HPO field work, lower cognitive load: one clear next action at a time and short confirmations.
- Use the AUTHORITATIVE CURRENT EMERY CONTEXT below before stale client hints or model inference.
- For current app state, use refresh_emery_context when the state may have changed since this session started.
- For “Who’s next?”, “What account am I at?”, “What happened here last time?”, “Who did I talk to?”, or “What did she/he/they say?”, use get_hpo_field_state rather than guessing.
- For “I’m here”, “Just left…”, a completed/closed/bad-address/skipped stop, or another current-stop field update, use execute_hpo_route_stop_action.
- Use execute_hpo_action for explicit HPO relationship/account updates and follow-ups. Never write patient PHI.
- Use execute_calendar_action for explicit Task/Calendar writes.
- Use execute_hpo_route_command for route changes AND for “Undo that” / “revert that”; the shared planner and execution ledger decide whether an undo is eligible.
- Use execute_hpo_route_note when Adam explicitly asks to save a field marketing note against a route stop.
- A model interpretation is never proof that a write happened. Only say an action succeeded when the tool reports performed=true or returns a successful execution receipt.
- If a canonical tool asks for clarification, ask that concise question instead of guessing.
- Tool results are private working context. Answer naturally instead of narrating tool mechanics.
- Use search_web for current, changing, recent, online, local, or fact-checking questions.
- If Adam explicitly asks to adjust how you sound, use update_voice_delivery. Do not claim a saved voice change unless the tool confirms it.
- Do not claim external Calendar, phone, Reminders, WhatsApp, or other actions are connected unless a tool confirms them.

${unified}

DOMAIN ROUTING:
${context.route.domain.toUpperCase()} (${context.route.reason}). ${domainPrompt(context.route as any)}

CORE PROFILE:
${profile || "No additional profile details available."}

SELECTED LONG-TERM MEMORY:
${memories || "No relevant durable memory selected."}

WORKING STATE:
${context.workingState.summary || "No rolling working-state summary yet."}

LEARNED OPERATING CONFIG:
${JSON.stringify(context.config ?? {})}

CURRENT ACTIVE OS CONTEXT:
${actions}

QUIET FOCUS:
${context.focus}

${hpo ? `CURRENT HPO OPERATING CONTEXT (NON-PHI):\n${hpo}\n` : ""}
RECENT SAME-EMERY CONVERSATION:
${recent || "No recent turns."}
`;
}

const toolRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    request: { type: "string", description: "Adam's exact request from the active voice turn." },
  },
  required: ["request"],
};

const realtimeTools = [
  {
    type: "function",
    name: "search_web",
    description:
      "Search the live web when Adam asks for current, recent, changing, online, local, or fact-checked information.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "A concise web search query." } },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "update_voice_delivery",
    description:
      "Persist an explicit Adam-requested refinement to Emery's voice delivery; never changes Emery's identity or memory.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        request: { type: "string" },
        pace: { type: "number" },
        warmth: { type: "number" },
        expressiveness: { type: "number" },
        energy: { type: "number" },
        brevity: { type: "number" },
        accent_intensity: { type: "number" },
        accent_description: { type: "string" },
        style_note: { type: "string" },
      },
      required: ["request"],
    },
  },
  {
    type: "function",
    name: "execute_calendar_action",
    description:
      "Execute a canonical Emery Calendar/Tasks action only when Adam explicitly authorizes it.",
    parameters: toolRequestSchema,
  },
  {
    type: "function",
    name: "execute_hpo_action",
    description:
      "Execute a canonical non-PHI HPO relationship/account update or follow-up against authoritative current account context.",
    parameters: toolRequestSchema,
  },
  {
    type: "function",
    name: "get_hpo_field_state",
    description:
      "Read authoritative HPO route/current-stop/current-account state for next-stop, last-visit, current-account, contact, and contextual pronoun questions.",
    parameters: toolRequestSchema,
  },
  {
    type: "function",
    name: "execute_hpo_route_command",
    description:
      "Execute canonical HPO route commands through the shared planner. Also use for an explicit undo/revert request so the execution ledger can determine eligibility.",
    parameters: toolRequestSchema,
  },
  {
    type: "function",
    name: "execute_hpo_route_stop_action",
    description:
      "Execute the canonical current-stop action for arrival, visit capture, completed/closed/bad-address/skipped outcomes, and natural 'just left' updates.",
    parameters: toolRequestSchema,
  },
  {
    type: "function",
    name: "execute_hpo_route_note",
    description:
      "Save an explicit non-PHI HPO field-route note through the existing canonical route-note chain.",
    parameters: toolRequestSchema,
  },
  {
    type: "function",
    name: "refresh_emery_context",
    description:
      "Refresh authoritative Emery Current Context, capability routing, relevant memory/Calendar/HPO context, and current app state.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

export const createUnifiedRealtimeClientSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The AI service isn't configured yet." } as const;

    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);
    const voiceContext = await loadUnifiedVoiceContext({
      db,
      userId: context.userId,
      query: "start live Emery voice session",
      conversation,
    });
    const voiceProfile = voiceContext.voiceProfile;
    if (!isUsableVoiceId(voiceProfile?.base_voice_id) || !voiceProfile?.approved_at) {
      return {
        error: "Emery Voice is wired, but Adam has not approved the final voice yet.",
        needsVoiceApproval: true,
      } as const;
    }

    const session = {
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: buildRealtimeInstructions(voiceContext),
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: {
            model: MODEL_POLICY.transcription,
            language: "en",
            prompt:
              "Natural conversational speech from Adam. He may speak quickly, restart, stutter, self-correct, pause mid-thought, or dictate fragments. Preserve intended wording and proper nouns. Common terms include Emery, Adam, Hudson Pro, HPO, PIP, PCC, Supabase, Lovable, and OpenAI.",
          },
          noise_reduction: { type: "near_field" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: voiceOutput(voiceProfile), speed: voiceSpeed(voiceProfile) },
      },
      tools: realtimeTools,
      tool_choice: "auto",
      max_output_tokens: 1200,
      truncation: { type: "retention_ratio", retention_ratio: 0.8 },
    };

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": realtimeSafetyIdentifier(context.userId),
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 120 },
        session,
      }),
    });

    if (!response.ok) {
      console.error(
        "Unified Realtime client secret failed",
        response.status,
        await response.text(),
      );
      return { error: "Emery couldn't start a secure voice session right now." } as const;
    }

    const payload = (await response.json()) as {
      value?: string;
      expires_at?: number;
      session?: { id?: string };
    };
    if (!payload.value)
      return { error: "The voice service returned an invalid session token." } as const;

    return {
      clientSecret: payload.value,
      expiresAt: payload.expires_at ?? null,
      model: REALTIME_MODEL,
      conversationId: conversation.id,
      voiceId: voiceProfile.base_voice_id,
      oneBrainPhase3: true,
    } as const;
  });