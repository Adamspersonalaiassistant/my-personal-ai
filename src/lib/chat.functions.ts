import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSISTANT_IDENTITY } from "@/lib/assistant-identity";

type ChatInput = { message: string; conversationId?: string | null };
type StoredMessage = { role: "user" | "assistant"; text: string };
type MemoryResult = {
  memorySaved: boolean;
  memoryUpdated: boolean;
  memoryError: string | null;
};

type Profile = {
  display_name: string | null;
  assistant_name: string | null;
  timezone: string | null;
  profile_summary: string | null;
};

type ExistingMemory = {
  id: string;
  title: string | null;
  content: string;
  memory_type: string;
};

type MemoryCandidate = {
  action: "create" | "update" | "profile_update" | "none";
  memory_type: string;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  reason: string;
  target_memory_id: string | null;
};

type SavedMemory = {
  id: string;
  title: string | null;
  content: string;
  memory_type: string;
  importance: number;
  created_at: string;
  updated_at: string;
};

/** Lists the signed-in user's saved memories, highest importance first. */
export const listMemories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data, error }, { data: profile, error: profileError }] = await Promise.all([
      supabase
        .from("memories")
        .select("id, title, content, memory_type, importance, created_at, updated_at")
        .eq("user_id", userId)
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("display_name, assistant_name, timezone, profile_summary")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (error) {
      console.error("Memory SELECT failed while listing saved memories", error.message);
      return {
        memories: [] as SavedMemory[],
        profile: null as Profile | null,
        profileError: profileError ? "Your profile couldn't be loaded right now." : null,
        error: "Your saved memories couldn't be loaded. Please try again.",
      };
    }

    if (profileError) {
      console.error("Profile SELECT failed while loading memories page", profileError.message);
    }

    return {
      memories: data ?? [],
      profile: (profile ?? null) as Profile | null,
      profileError: profileError ? "Your profile couldn't be loaded right now." : null,
      error: null,
    };
  });

/** Lists the signed-in user's saved conversations, newest first. */
export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, started_at")
      .eq("user_id", userId)
      .eq("channel", "app")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Conversation list failed", error.message);
      return { conversations: [] as { id: string; title: string | null; started_at: string }[] };
    }
    return { conversations: data ?? [] };
  });

/** Loads one conversation's messages in chronological order. */
export const getConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string }) => {
    if (!input?.conversationId || typeof input.conversationId !== "string") {
      throw new Error("conversationId is required");
    }
    return { conversationId: input.conversationId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("conversation_messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      console.error("Message load failed", error.message);
      return { messages: [] as StoredMessage[] };
    }
    return {
      messages: (rows ?? [])
        .filter((r) => r.role === "user" || r.role === "assistant")
        .map((r) => ({ role: r.role as "user" | "assistant", text: r.content })),
    };
  });

/** Loads the most recent conversation plus its messages. */
export const getLatestConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("channel", "app")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return { conversationId: null, messages: [] as StoredMessage[] };

    const { data: rows } = await supabase
      .from("conversation_messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .eq("conversation_id", data.id)
      .order("created_at", { ascending: true })
      .limit(500);
    return {
      conversationId: data.id,
      messages: (rows ?? [])
        .filter((r) => r.role === "user" || r.role === "assistant")
        .map((r) => ({ role: r.role as "user" | "assistant", text: r.content })),
    };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ChatInput) => {
    const message = typeof input?.message === "string" ? input.message.trim() : "";
    if (!message) throw new Error("Message is required");
    if (message.length > 8000) throw new Error("Message is too long");
    const conversationId =
      typeof input?.conversationId === "string" && input.conversationId
        ? input.conversationId
        : null;
    return { message, conversationId };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The AI service isn't configured yet." } as const;

    const { supabase, userId } = context;
    const memoryResult: MemoryResult = {
      memorySaved: false,
      memoryUpdated: false,
      memoryError: null,
    };

    const recordMemoryError = (operation: "SELECT" | "INSERT" | "UPDATE", message: string) => {
      console.error(`Memory ${operation} failed`, message);
      memoryResult.memoryError = "Your memory couldn't be saved or loaded right now.";
    };

    // --- Ensure a conversation exists ------------------------------------
    let conversationId = data.conversationId;
    if (conversationId) {
      const { data: owned } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!owned) conversationId = null;
    }
    if (!conversationId) {
      const { data: created, error: createError } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          channel: "app",
          title: data.message.slice(0, 60),
        })
        .select("id")
        .single();
      if (createError || !created) {
        console.error("Conversation create failed", createError?.message);
        return { error: "Couldn't start a conversation. Please try again." } as const;
      }
      conversationId = created.id;
    }

    // --- Save the user message -------------------------------------------
    const { error: userMsgError } = await supabase.from("conversation_messages").insert({
      user_id: userId,
      conversation_id: conversationId,
      role: "user",
      content: data.message,
    });
    if (userMsgError) console.error("User message save failed", userMsgError.message);

    // --- Core identity ----------------------------------------------------
    const statedName = extractName(data.message);
    if (statedName) {
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ user_id: userId, display_name: statedName }, { onConflict: "user_id" });
      if (profileError) {
        console.error("Profile UPSERT failed for display_name", profileError.message);
        memoryResult.memoryError = "Your profile couldn't be saved right now.";
      }
    }

    let profileBlock = "";
    const { data: initialProfile, error: initialProfileError } = await supabase
      .from("profiles")
      .select("display_name, assistant_name, timezone, profile_summary")
      .eq("user_id", userId)
      .maybeSingle();
    if (initialProfileError) {
      console.error("Profile SELECT failed before memory extraction", initialProfileError.message);
      memoryResult.memoryError ??= "Your profile couldn't be loaded right now.";
    }

    // --- Existing memory read --------------------------------------------
    const { data: existingRows, error: existingError } = await supabase
      .from("memories")
      .select("id, title, content, memory_type")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    const existingMemories: ExistingMemory[] = existingError ? [] : (existingRows ?? []);
    if (existingError) recordMemoryError("SELECT", existingError.message);

    // --- Explicit and automatic memory write -----------------------------
    const fact = extractExplicitMemory(data.message);
    let savedMemory: string | null = null;
    if (fact && (statedName || extractName(fact)) && isAboutOwnName(fact)) {
      // "Please save in memories my name is Adam Ashraf" — this belongs on the
      // profile, not as an awkward literal long-term memory row.
      const name = statedName ?? extractName(fact);
      if (name) {
        const { error: nameError } = await supabase
          .from("profiles")
          .upsert({ user_id: userId, display_name: name }, { onConflict: "user_id" });
        if (nameError) {
          console.error("Profile UPSERT failed for display_name", nameError.message);
          memoryResult.memoryError ??= "Your profile couldn't be saved right now.";
        } else {
          savedMemory = `Adam's name is ${name}`;
          memoryResult.memorySaved = true;
          memoryResult.memoryUpdated = true;
        }
      }
    } else if (fact) {
      const duplicate = existingMemories.some((m) => normalize(m.content) === normalize(fact));
      if (!existingError && !duplicate) {
        const { error: insertError } = await supabase.from("memories").insert({
          user_id: userId,
          memory_type: "core",
          title: makeTitle(fact),
          content: fact,
          importance: 4,
          confidence: 1.0,
          source_type: "chat",
        });
        if (insertError) {
          recordMemoryError("INSERT", insertError.message);
        } else {
          savedMemory = fact;
          memoryResult.memorySaved = true;
        }
      } else if (!existingError && duplicate) {
        savedMemory = fact;
      }
    } else if (!existingError) {
      const candidates = await extractAutomaticMemories(
        apiKey,
        data.message,
        initialProfile,
        existingMemories,
      );
      if (candidates === null) {
        memoryResult.memoryError ??= "Automatic memory analysis wasn't available right now.";
      }
      for (const candidate of (candidates ?? []).slice(0, 3)) {
        if (!isSafeDurableCandidate(candidate)) continue;

        if (candidate.action === "profile_update") {
          const update = profileUpdateForCandidate(candidate);
          if (!update) continue;
          const { error: profileUpdateError } = await supabase
            .from("profiles")
            .upsert({ user_id: userId, ...update }, { onConflict: "user_id" });
          if (profileUpdateError) {
            console.error(
              "Profile UPSERT failed during automatic extraction",
              profileUpdateError.message,
            );
            memoryResult.memoryError ??= "Your profile couldn't be saved right now.";
          } else {
            memoryResult.memorySaved = true;
            memoryResult.memoryUpdated = true;
          }
          continue;
        }

        if (candidate.action === "update") {
          if (!isClearCorrection(data.message) || !candidate.target_memory_id) continue;
          const target = existingMemories.find((m) => m.id === candidate.target_memory_id);
          if (!target) continue;
          const { error: updateError } = await supabase
            .from("memories")
            .update({
              memory_type: candidate.memory_type,
              title: candidate.title,
              content: candidate.content,
              importance: candidate.importance,
              confidence: candidate.confidence,
              source_type: "chat_auto",
              updated_at: new Date().toISOString(),
            })
            .eq("id", target.id)
            .eq("user_id", userId);
          if (updateError) {
            recordMemoryError("UPDATE", updateError.message);
          } else {
            memoryResult.memorySaved = true;
            memoryResult.memoryUpdated = true;
          }
          continue;
        }

        if (candidate.action === "create") {
          if (isClearCorrection(data.message)) continue;
          const duplicate = existingMemories.some(
            (memory) => normalize(memory.content) === normalize(candidate.content),
          );
          if (duplicate) continue;
          const { error: insertError } = await supabase.from("memories").insert({
            user_id: userId,
            memory_type: candidate.memory_type,
            title: candidate.title,
            content: candidate.content,
            importance: candidate.importance,
            confidence: candidate.confidence,
            source_type: "chat_auto",
          });
          if (insertError) recordMemoryError("INSERT", insertError.message);
          else memoryResult.memorySaved = true;
        }
      }
    }

    // Re-read the profile after any automatic profile update so this response and
    // completely new conversations receive the confirmed database value.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("display_name, assistant_name, timezone, profile_summary")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) {
      console.error("Profile SELECT failed before assistant response", profileError.message);
      memoryResult.memoryError ??= "Your profile couldn't be loaded right now.";
    } else if (profile) {
      const lines = [
        profile.display_name ? `Name: ${profile.display_name}` : null,
        profile.assistant_name ? `Assistant name: ${profile.assistant_name}` : null,
        profile.timezone ? `Timezone: ${profile.timezone}` : null,
        profile.profile_summary ? `About: ${profile.profile_summary}` : null,
      ].filter(Boolean);
      profileBlock = lines.join("\n");
    }

    // --- Long-term memory read -------------------------------------------
    let memoryBlock = "";
    try {
      const nowIso = new Date().toISOString();
      const { data: memories, error: memoriesError } = await supabase
        .from("memories")
        .select("title, content, memory_type, importance, created_at, expires_at")
        .eq("user_id", userId)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(40);
      if (memoriesError) {
        recordMemoryError("SELECT", memoriesError.message);
      } else if (memories && memories.length > 0) {
        memoryBlock = buildMemoryBlock(memories);
      }
    } catch (e) {
      recordMemoryError("SELECT", e instanceof Error ? e.message : "unknown error");
    }

    // --- Conversation history from the database ---------------------------
    let history: StoredMessage[] = [];
    try {
      const { data: rows } = await supabase
        .from("conversation_messages")
        .select("role, content, created_at")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(60);
      history = (rows ?? [])
        .filter((r) => r.role === "user" || r.role === "assistant")
        .map((r) => ({ role: r.role as "user" | "assistant", text: r.content }));
      // Drop the message we just saved; it is sent separately as the newest turn.
      const lastIndex = history.map((h) => h.text).lastIndexOf(data.message);
      if (lastIndex >= 0 && history[lastIndex]?.role === "user") history.splice(lastIndex, 1);
      history = history.slice(-30);
    } catch (e) {
      console.error("History read error", e instanceof Error ? e.message : "unknown");
    }

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: [
            {
              role: "system",
              content:
                ASSISTANT_IDENTITY +
                (savedMemory
                  ? `\n\nAdam just asked you to remember something and it has been saved permanently: "${savedMemory}". Briefly confirm it.`
                  : ""),
            },
            ...(profileBlock
              ? [{ role: "system" as const, content: `CORE PROFILE:\n${profileBlock}` }]
              : []),
            ...(memoryBlock
              ? [{ role: "system" as const, content: `LONG-TERM MEMORY:\n${memoryBlock}` }]
              : []),
            ...history.map((turn) => ({
              role: turn.role,
              content: [
                {
                  type: turn.role === "assistant" ? "output_text" : "input_text",
                  text: turn.text,
                },
              ],
            })),
            { role: "user", content: data.message },
          ],
        }),
      });
    } catch {
      return {
        error: "Couldn't reach the AI service. Please try again.",
        ...memoryResult,
      } as const;
    }

    if (!response.ok) {
      console.error("OpenAI request failed with status", response.status);
      if (response.status === 429) {
        return {
          error: "Too many requests right now. Please try again shortly.",
          ...memoryResult,
        } as const;
      }
      if (response.status === 401 || response.status === 403) {
        return { error: "The AI service rejected the request.", ...memoryResult } as const;
      }
      return {
        error: "The AI couldn't answer right now. Please try again.",
        ...memoryResult,
      } as const;
    }

    let payload: {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    try {
      payload = await response.json();
    } catch {
      return { error: "The AI sent an unreadable response.", ...memoryResult } as const;
    }

    let text = typeof payload.output_text === "string" ? payload.output_text : "";
    if (!text && Array.isArray(payload.output)) {
      text = payload.output
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .filter((c) => c?.type === "output_text")
        .map((c) => c.text ?? "")
        .join("")
        .trim();
    }

    if (!text) return { error: "The AI returned an empty response.", ...memoryResult } as const;

    const { error: assistantMsgError } = await supabase.from("conversation_messages").insert({
      user_id: userId,
      conversation_id: conversationId,
      role: "assistant",
      content: text,
    });
    if (assistantMsgError)
      console.error("Assistant message save failed", assistantMsgError.message);

    return { reply: text, conversationId, ...memoryResult } as const;
  });

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeTitle(fact: string) {
  const words = fact.split(/\s+/).slice(0, 6).join(" ");
  return words.length < fact.length ? `${words}…` : words;
}

const AUTOMATIC_MEMORY_TYPES = new Set([
  "goal",
  "preference",
  "relationship",
  "routine",
  "responsibility",
  "working_preference",
  "decision",
  "constraint",
  "project_context",
]);

const PROFILE_MEMORY_TYPES = new Set([
  "profile_name",
  "profile_assistant_name",
  "profile_timezone",
  "profile_summary",
]);

const SENSITIVE_CONTENT =
  /\b(password|passcode|pin|api[ _-]?key|secret|private key|seed phrase|recovery phrase|access token|refresh token|bank account|routing number|credit card|cvv|social security|ssn)\b/i;

function looksSensitive(text: string) {
  return (
    SENSITIVE_CONTENT.test(text) ||
    /\bsk-[A-Za-z0-9_-]{16,}\b/.test(text) ||
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(text) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
  );
}

function isSafeDurableCandidate(candidate: MemoryCandidate) {
  if (candidate.action === "none") return false;
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0.9) return false;
  if (
    !Number.isInteger(candidate.importance) ||
    candidate.importance < 3 ||
    candidate.importance > 5
  ) {
    return false;
  }
  if (!candidate.content.trim() || candidate.content.length > 1000) return false;
  if (!candidate.reason.trim() || looksSensitive(candidate.content)) return false;
  if (candidate.action === "profile_update") {
    return PROFILE_MEMORY_TYPES.has(candidate.memory_type) && candidate.confidence >= 0.95;
  }
  return AUTOMATIC_MEMORY_TYPES.has(candidate.memory_type) && candidate.title.trim().length > 0;
}

function profileUpdateForCandidate(candidate: MemoryCandidate): Partial<Profile> | null {
  const content = candidate.content.trim();
  if (!content) return null;
  if (candidate.memory_type === "profile_name" && content.length <= 60) {
    return { display_name: content };
  }
  if (candidate.memory_type === "profile_assistant_name" && content.length <= 60) {
    return { assistant_name: content };
  }
  if (candidate.memory_type === "profile_timezone" && content.length <= 100) {
    return { timezone: content };
  }
  if (candidate.memory_type === "profile_summary" && content.length <= 1000) {
    return { profile_summary: content };
  }
  return null;
}

function isClearCorrection(message: string) {
  return /\b(actually|correction|correct that|no longer|not anymore|changed|instead|from now on|now (?:i|my|we))\b/i.test(
    message,
  );
}

function buildMemoryBlock(
  memories: {
    title: string | null;
    content: string;
    importance: number;
    memory_type: string;
  }[],
) {
  const maxCharacters = 6000;
  const lines: string[] = [];
  let length = 0;
  for (const memory of memories) {
    const fullLine = `- [${memory.memory_type.toUpperCase()} | importance ${memory.importance}] ${
      memory.title ? `${memory.title}: ` : ""
    }${memory.content}`;
    const remaining = maxCharacters - length - 1;
    if (remaining <= 0) break;
    const line = fullLine.slice(0, remaining);
    lines.push(line);
    length += line.length + 1;
    if (line.length < fullLine.length) break;
  }
  return lines.join("\n");
}

async function extractAutomaticMemories(
  apiKey: string,
  message: string,
  profile: Profile | null,
  existingMemories: ExistingMemory[],
): Promise<MemoryCandidate[] | null> {
  if (message.length < 8 || looksSensitive(message)) return [];

  const existing = existingMemories.slice(0, 60).map((memory) => ({
    id: memory.id,
    memory_type: memory.memory_type,
    title: memory.title,
    content: memory.content,
  }));

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: [
          {
            role: "system",
            content:
              "Extract only durable, explicitly user-stated personal context. Return zero candidates for temporary plans, casual chat, one-off questions, speculation, assumptions, assistant-generated ideas, or secrets. " +
              "Durable memories include enduring goals, preferences, relationships, routines, responsibilities, working preferences, decisions, constraints, and important ongoing project context. " +
              "Use profile_update only for name, assistant name, timezone, or a stable user summary. " +
              "Use update only for a clear user correction and only with the exact target_memory_id from EXISTING MEMORIES. Never infer a target by loose keyword similarity. When uncertain, return none. " +
              "Confidence must reflect direct support in the user's message; only use 0.9 or higher when the fact is explicit and durable.",
          },
          {
            role: "user",
            content: `CURRENT PROFILE:\n${JSON.stringify(profile ?? {})}\n\nEXISTING MEMORIES:\n${JSON.stringify(existing)}\n\nUSER MESSAGE:\n${message}`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "memory_candidates",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                candidates: {
                  type: "array",
                  maxItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      action: {
                        type: "string",
                        enum: ["create", "update", "profile_update", "none"],
                      },
                      memory_type: { type: "string" },
                      title: { type: "string" },
                      content: { type: "string" },
                      importance: { type: "integer", minimum: 1, maximum: 5 },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                      reason: { type: "string" },
                      target_memory_id: { type: ["string", "null"] },
                    },
                    required: [
                      "action",
                      "memory_type",
                      "title",
                      "content",
                      "importance",
                      "confidence",
                      "reason",
                      "target_memory_id",
                    ],
                  },
                },
              },
              required: ["candidates"],
            },
          },
        },
      }),
    });
  } catch (error) {
    console.error(
      "Automatic memory extraction request failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }

  if (!response.ok) {
    console.error("Automatic memory extraction failed with status", response.status);
    return null;
  }

  try {
    const payload = (await response.json()) as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    const text = getResponseText(payload);
    if (!text) {
      console.error("Automatic memory extraction returned no structured text");
      return null;
    }
    const parsed = JSON.parse(text) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) {
      console.error("Automatic memory extraction returned invalid candidates");
      return null;
    }
    return parsed.candidates.filter(isMemoryCandidate);
  } catch (error) {
    console.error(
      "Automatic memory extraction response parse failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

function getResponseText(payload: {
  output_text?: string;
  output?: { content?: { type?: string; text?: string }[] }[];
}) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((content) => content?.type === "output_text")
    .map((content) => content.text ?? "")
    .join("")
    .trim();
}

function isMemoryCandidate(value: unknown): value is MemoryCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemoryCandidate>;
  return (
    ["create", "update", "profile_update", "none"].includes(candidate.action ?? "") &&
    typeof candidate.memory_type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.importance === "number" &&
    typeof candidate.confidence === "number" &&
    typeof candidate.reason === "string" &&
    (typeof candidate.target_memory_id === "string" || candidate.target_memory_id === null)
  );
}

/** True when the text is clearly a statement about the user's own name. */
function isAboutOwnName(text: string): boolean {
  return /\bmy\s+(?:full\s+|first\s+|legal\s+)?name\s+(?:is|=|:)/i.test(text) ||
    /\b(?:i am called|i'm called|you can call me|call me)\b/i.test(text)
    ? true
    : false;
}

/** Words that clearly end a name and start another clause. */
const NAME_STOP_WORDS = new Set([
  "and",
  "but",
  "so",
  "then",
  "also",
  "please",
  "remember",
  "moving",
  "forward",
  "from",
  "for",
  "in",
  "to",
  "that",
  "thanks",
  "thank",
  "ok",
  "okay",
]);

/** Detects an explicit, unambiguous statement of the user's own name. */
function extractName(message: string): string | null {
  const m = message.match(
    /\b(?:my\s+(?:full\s+|first\s+|legal\s+)?name\s+(?:is|=|:)|i am called|i'm called|you can call me|call me)\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,3})/i,
  );
  if (!m?.[1]) return null;

  const words: string[] = [];
  for (const word of m[1].trim().split(/\s+/)) {
    if (NAME_STOP_WORDS.has(word.toLowerCase())) break;
    words.push(word);
    if (words.length === 3) break;
  }
  const name = words.join(" ").replace(/[.,!?;:]+$/, "");
  if (name.length < 2 || name.length > 60) return null;
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Detects explicit "remember this" phrasing and returns the clean fact,
 * or null when the message is not an explicit memory request.
 */
function extractExplicitMemory(message: string): string | null {
  const patterns = [
    /^\s*(?:hey\s+)?(?:please\s+|can you\s+|could you\s+)?(?:remember|memorize|keep in mind|note|save)(?:\s+this|\s+that|\s+it)?\s*(?:to|in|into)?\s*(?:memory|long[- ]term memory)?\s*[:,-]?\s+(.+)$/is,
    /^\s*(?:please\s+)?save\s+(?:this|that)\s+(?:to|in|into)\s+memory\s*[:,-]?\s*(.*)$/is,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m && m[1]) {
      const fact = m[1]
        .trim()
        .replace(/^that\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (fact.length >= 2 && fact.length <= 2000) return fact;
    }
  }
  return null;
}
