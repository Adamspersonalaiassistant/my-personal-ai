/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSISTANT_IDENTITY } from "@/lib/assistant-identity";
import { persistDurableMemoryFromMessage } from "@/lib/chat.functions";
import { inferEmeryDomain, domainPrompt } from "@/lib/emery-domain";
import { selectRelevantMemories, buildExecutiveFocus } from "@/lib/emery-intelligence";
import { loadHpoAgentContext } from "@/lib/hpo-agent-context";
import { VOICE_PROFILE_CONTRACT, isUsableVoiceId } from "@/lib/voice-profile";

const REALTIME_MODEL = "gpt-realtime-2.1";

function realtimeSafetyIdentifier(userId: string) {
  return "emery_" + createHash("sha256").update(userId).digest("hex").slice(0, 32);
}


async function mainConversation(db: any, userId: string) {
  const { data: existing, error } = await db
    .from("conversations")
    .select("id, metadata")
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
    .select("id, metadata")
    .single();
  if (createError || !created) throw createError ?? new Error("Could not create Emery conversation");
  return created;
}

async function loadVoiceContext(db: any, userId: string, query = "current voice conversation") {
  const now = new Date().toISOString();
  const conversation = await mainConversation(db, userId);
  const route = inferEmeryDomain(query);

  const [
    profileResult,
    memoryResult,
    voiceResult,
    taskResult,
    projectResult,
    meetingResult,
    recentResult,
  ] = await Promise.all([
    db
      .from("profiles")
      .select("display_name, assistant_name, timezone, profile_summary")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("memories")
      .select("id,title,content,memory_type,importance,confidence,created_at,updated_at")
      .eq("user_id", userId)
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(100),
    db
      .from("voice_profiles")
      .select(
        "base_voice_id,stable_identity,delivery_preferences,contextual_preferences,pronunciation_preferences,provider_capabilities,approved_at,version",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("tasks")
      .select("id,title,details,status,priority,due_at,metadata,project_id")
      .eq("user_id", userId)
      .neq("status", "completed")
      .order("priority", { ascending: false })
      .limit(12),
    db
      .from("projects")
      .select("id,name,description,status,priority,goal,next_action")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(8),
    db
      .from("meetings")
      .select("id,title,meeting_at,participants,metadata")
      .eq("user_id", userId)
      .gte("meeting_at", now)
      .order("meeting_at", { ascending: true })
      .limit(8),
    db
      .from("conversation_messages")
      .select("role,content,created_at")
      .eq("user_id", userId)
      .eq("conversation_id", conversation.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(16),
  ]);

  const recent = (recentResult.data ?? [])
    .reverse()
    .map((row: any) => ({
      role: row.role as "user" | "assistant",
      text: String(row.content ?? ""),
      createdAt: row.created_at as string,
    }));

  const selected = selectRelevantMemories(memoryResult.data ?? [], query, recent, {
    maxItems: 14,
    maxCharacters: 5000,
  });

  const actions = {
    tasks: taskResult.data ?? [],
    projects: projectResult.data ?? [],
    meetings: meetingResult.data ?? [],
  };

  const routeContext =
    route.domain === "hpo" || route.domain === "mixed"
      ? await loadHpoAgentContext(db, userId, query).catch(() => null)
      : null;

  return {
    conversation,
    route,
    profile: profileResult.data ?? null,
    voiceProfile: voiceResult.data ?? null,
    memories: selected,
    actions,
    focus: buildExecutiveFocus(actions),
    recent,
    hpoContext: routeContext,
  };
}

function validVoiceId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  return isUsableVoiceId(id);
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

function buildRealtimeInstructions(context: Awaited<ReturnType<typeof loadVoiceContext>>) {
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

  return `${ASSISTANT_IDENTITY}

${VOICE_PROFILE_CONTRACT}

APPROVED VOICE PROFILE:
${JSON.stringify(context.voiceProfile ?? {})}
Apply stable_identity, delivery_preferences, contextual_preferences, and pronunciation_preferences naturally when the provider supports them. The base voice controls vocal identity; these preferences control delivery only.

LIVE VOICE OPERATING CONTRACT:
- This is the same Emery and the same lifelong conversation as text chat. Never act like a new assistant or a separate voice persona.
- Speak naturally for audio. Default to concise conversational turns, usually 1-4 sentences unless Adam asks for depth.
- Adam may speak quickly, trail off, restart phrases, stutter, self-correct, change direction mid-sentence, or speak in fragments. Follow the intended meaning and active thread instead of demanding polished wording.
- Allow natural pauses. Do not jump in merely because Adam pauses briefly to think.
- If Adam begins speaking while you are talking, stop and listen. Treat interruption as normal conversation, not an error.
- Use the supplied profile, memories, recent conversation, and current operating context to resolve names and references. If a proper noun remains materially ambiguous, ask one short clarification rather than inventing it.
- Use the search_web tool for current, changing, recent, online, or fact-checking questions. Never pretend current knowledge came from live search if the tool was not used.
- Use refresh_emery_context when Adam asks about a task, project, appointment, HPO item, memory, or other app state that may have changed since this voice session began.
- Tool results are private working context. Answer Adam naturally rather than narrating tool mechanics.
- Do not claim Calendar, Reminders, WhatsApp, PLAUD, phone control, or any external action is connected unless a tool confirms it.
- Voice delivery may follow approved voice profile preferences, but personality and judgment always come from Emery's central identity.
- If Adam explicitly asks during the live conversation to slow down, speed up, be warmer, calmer, more or less expressive, more energetic, or briefer, use update_voice_delivery. Do not claim the preference was saved unless the tool confirms it.

DOMAIN ROUTING:
${context.route.domain.toUpperCase()} (${context.route.reason}). ${domainPrompt(context.route)}

CORE PROFILE:
${profile || "No additional profile details available."}

SELECTED LONG-TERM MEMORY:
${memories || "No relevant durable memory selected."}

CURRENT ACTIVE OS CONTEXT:
${actions}

QUIET FOCUS:
${context.focus}

${hpo ? `CURRENT HPO OPERATING CONTEXT (NON-PHI):\n${hpo}\n` : ""}
RECENT SAME-EMERY CONVERSATION:
${recent || "No recent turns."}
`;
}

export const getVoiceReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data: profile } = await db
      .from("voice_profiles")
      .select("base_voice_id,approved_at,version,delivery_preferences,provider_capabilities")
      .eq("user_id", context.userId)
      .maybeSingle();

    const configured = validVoiceId(profile?.base_voice_id);
    const approved = Boolean(profile?.approved_at);
    return {
      infrastructureReady: true,
      voiceConfigured: configured,
      voiceApproved: approved,
      canStart: configured && approved,
      selectedVoice: profile?.base_voice_id ?? null,
      model: REALTIME_MODEL,
      capabilities: {
        speechToSpeech: true,
        interruptions: true,
        semanticTurnDetection: true,
        sameConversationPersistence: true,
        durableMemoryPersistence: true,
        webSearch: true,
        freshAppContextTool: true,
      },
    };
  });

export const createRealtimeClientSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The AI service isn't configured yet." } as const;

    const db = context.supabase as any;
    const voiceContext = await loadVoiceContext(db, context.userId, "start live Emery voice session");
    const voiceProfile = voiceContext.voiceProfile;
    if (!validVoiceId(voiceProfile?.base_voice_id) || !voiceProfile?.approved_at) {
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
            model: "gpt-4o-transcribe",
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
        output: {
          voice: voiceOutput(voiceProfile),
          speed: voiceSpeed(voiceProfile),
        },
      },
      tools: [
        {
          type: "function",
          name: "search_web",
          description:
            "Search the live web when Adam asks for current, recent, changing, online, local, or fact-checked information. Return findings to Emery before she answers.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", description: "A concise web search query." },
            },
            required: ["query"],
          },
        },
        {
          type: "function",
          name: "update_voice_delivery",
          description:
            "Persist an explicit Adam-requested change to Emery's live delivery. Use only when Adam directly asks for a voice delivery change such as pace, warmth, energy, expressiveness, or brevity. This never changes Emery's identity or base voice.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              request: { type: "string", description: "Adam's explicit voice-delivery request." },
              pace: { type: "number", description: "Playback pace, 0.75 to 1.25." },
              warmth: { type: "number", description: "Desired warmth, 0 to 1." },
              expressiveness: { type: "number", description: "Desired expressiveness, 0 to 1." },
              energy: { type: "number", description: "Desired energy, 0 to 1." },
              brevity: { type: "number", description: "Desired spoken brevity, 0 to 1." },
            },
            required: ["request"],
          },
        },
        {
          type: "function",
          name: "refresh_emery_context",
          description:
            "Refresh Emery's current app context when Adam asks about tasks, projects, meetings, memories, HPO work, or other state that may have changed since the voice session started.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: {
                type: "string",
                description: "What current Emery context is needed for the active question.",
              },
            },
            required: ["query"],
          },
        },
      ],
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
      console.error("Realtime client secret failed", response.status, await response.text());
      return { error: "Emery couldn't start a secure voice session right now." } as const;
    }

    const payload = (await response.json()) as {
      value?: string;
      expires_at?: number;
      session?: { id?: string };
    };
    if (!payload.value) return { error: "The voice service returned an invalid session token." } as const;

    return {
      clientSecret: payload.value,
      expiresAt: payload.expires_at ?? null,
      model: REALTIME_MODEL,
      conversationId: voiceContext.conversation.id,
      voiceId: voiceProfile.base_voice_id,
    } as const;
  });

export const persistVoiceTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { role: "user" | "assistant"; text: string; eventKey: string }) => {
      const role = input?.role === "assistant" ? ("assistant" as const) : ("user" as const);
      return {
        role,
        text: String(input?.text ?? "").trim().slice(0, 12000),
        eventKey: String(input?.eventKey ?? "").trim().slice(0, 200),
      };
    },
  )
  .handler(async ({ data, context }) => {
    if (!data.text || !data.eventKey) return { ok: false, error: "Empty voice transcript." } as const;
    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);

    const { data: duplicate } = await db
      .from("conversation_messages")
      .select("id")
      .eq("user_id", context.userId)
      .eq("conversation_id", conversation.id)
      .contains("source_metadata", { voice_event_key: data.eventKey })
      .limit(1)
      .maybeSingle();
    if (duplicate) return { ok: true, duplicate: true } as const;

    const route = data.role === "user" ? inferEmeryDomain(data.text) : null;
    const { data: saved, error } = await db
      .from("conversation_messages")
      .insert({
        user_id: context.userId,
        conversation_id: conversation.id,
        role: data.role,
        content: data.text,
        source_metadata: {
          entryPoint: "voice",
          inputMode: data.role === "user" ? "voice" : "realtime_audio",
          voice_event_key: data.eventKey,
          domain: route?.domain ?? undefined,
          emery_identity: "central-v1",
        },
      })
      .select("id,created_at")
      .single();
    if (error || !saved) return { ok: false, error: "Couldn't save the voice turn." } as const;

    let memoryWrite = null;
    if (data.role === "user") {
      const apiKey = process.env["OPENAI_API_KEY"];
      if (apiKey) {
        memoryWrite = await persistDurableMemoryFromMessage({
          supabase: db,
          userId: context.userId,
          apiKey,
          message: data.text,
        });
      }
    }

    await db
      .from("conversations")
      .update({
        metadata: {
          ...(conversation.metadata && typeof conversation.metadata === "object"
            ? conversation.metadata
            : {}),
          identity: "central-v1",
          last_entry_point: "voice",
          ...(route ? { last_domain: route.domain } : {}),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id)
      .eq("user_id", context.userId);

    return {
      ok: true,
      id: saved.id,
      createdAt: saved.created_at,
      memoryWrite,
    } as const;
  });

export const searchWebForVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query: string }) => ({
    query: String(input?.query ?? "").trim().slice(0, 1200),
  }))
  .handler(async ({ data }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "Web search isn't configured." } as const;
    if (!data.query) return { error: "Search query is empty." } as const;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        input: [
          {
            role: "system",
            content:
              "You are the live web-search tool for Emery. Research the user's query using current web results. Return a concise factual synthesis with dates and source names where useful. Do not address Adam as a separate assistant.",
          },
          { role: "user", content: data.query },
        ],
      }),
    });
    if (!response.ok) return { error: "Live web search failed." } as const;
    const payload = (await response.json()) as any;
    const text =
      typeof payload.output_text === "string"
        ? payload.output_text.trim()
        : (payload.output ?? [])
            .flatMap((item: any) => item.content ?? [])
            .filter((item: any) => item.type === "output_text")
            .map((item: any) => item.text ?? "")
            .join("")
            .trim();
    return { result: text || "No useful live web result was returned." } as const;
  });

export const updateVoiceDeliveryFromLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request: string;
      pace?: number;
      warmth?: number;
      expressiveness?: number;
      energy?: number;
      brevity?: number;
    }) => {
      const bounded = (value: unknown, min = 0, max = 1) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : undefined;
      };
      return {
        request: String(input?.request ?? "").trim().slice(0, 500),
        pace: bounded(input?.pace, 0.75, 1.25),
        warmth: bounded(input?.warmth),
        expressiveness: bounded(input?.expressiveness),
        energy: bounded(input?.energy),
        brevity: bounded(input?.brevity),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: profile, error } = await db
      .from("voice_profiles")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error || !profile?.approved_at || !validVoiceId(profile.base_voice_id)) {
      return { ok: false, error: "No approved Emery Voice is active." } as const;
    }

    const patch: Record<string, number> = Object.fromEntries(
      Object.entries({
        pace: data.pace,
        warmth: data.warmth,
        expressiveness: data.expressiveness,
        energy: data.energy,
        brevity: data.brevity,
      }).filter(([, value]) => value !== undefined),
    ) as Record<string, number>;

    if (!Object.keys(patch).length) {
      const request = data.request.toLowerCase();
      if (/slow down|slower/.test(request)) patch["pace"] = 0.85;
      if (/speed up|faster/.test(request)) patch["pace"] = 1.15;
      if (/warmer|more warm/.test(request)) patch["warmth"] = 0.72;
      if (/calmer|more calm/.test(request)) patch["energy"] = 0.35;
      if (/more energetic|higher energy/.test(request)) patch["energy"] = 0.72;
      if (/more expressive/.test(request)) patch["expressiveness"] = 0.72;
      if (/less expressive/.test(request)) patch["expressiveness"] = 0.35;
      if (/briefer|shorter|more concise/.test(request)) patch["brevity"] = 0.75;
    }
    if (!Object.keys(patch).length) {
      return { ok: false, error: "No supported voice-delivery change was supplied." } as const;
    }

    const { error: versionError } = await db.from("voice_profile_versions").insert({
      user_id: context.userId,
      voice_profile_id: profile.id,
      version: profile.version,
      snapshot: profile,
      change_request: data.request,
      change_source: "live_voice",
    });
    if (versionError) throw versionError;

    const nextDelivery = { ...(profile.delivery_preferences ?? {}), ...patch };
    const { data: updated, error: updateError } = await db
      .from("voice_profiles")
      .update({
        delivery_preferences: nextDelivery,
        version: Number(profile.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .eq("user_id", context.userId)
      .select("delivery_preferences,version")
      .single();
    if (updateError || !updated) {
      return { ok: false, error: "Could not save that Voice preference." } as const;
    }

    return {
      ok: true,
      deliveryPreferences: updated.delivery_preferences,
      version: updated.version,
      speed: typeof data.pace === "number" ? data.pace : null,
      note:
        typeof data.pace === "number"
          ? "Preference saved; playback speed can update for the next turn."
          : "Preference saved; Emery should adapt the requested delivery on following turns where supported.",
    } as const;
  });

export const refreshVoiceContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query: string }) => ({
    query: String(input?.query ?? "").trim().slice(0, 1200),
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const current = await loadVoiceContext(
      db,
      context.userId,
      data.query || "refresh current Emery context",
    );
    const memories = current.memories
      .map((item: any) => `[${item.memory_type}] ${item.title ? `${item.title}: ` : ""}${item.content}`)
      .join("\n");
    return {
      result: [
        `Domain: ${current.route.domain}`,
        `Focus: ${current.focus}`,
        `Actions: ${JSON.stringify(current.actions).slice(0, 6500)}`,
        memories ? `Relevant memories:\n${memories}` : "",
        current.hpoContext
          ? `HPO context: ${JSON.stringify(current.hpoContext).slice(0, 6500)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    } as const;
  });
