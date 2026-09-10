import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ChatInput = { message: string; conversationId?: string | null };
type StoredMessage = { role: "user" | "assistant"; text: string };

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
      typeof input?.conversationId === "string" && input.conversationId ? input.conversationId : null;
    return { message, conversationId };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The AI service isn't configured yet." } as const;

    const { supabase, userId } = context;

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
      if (profileError) console.error("Profile upsert failed", profileError.message);
    }

    let profileBlock = "";
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, assistant_name, timezone, profile_summary")
        .eq("user_id", userId)
        .maybeSingle();
      if (profile) {
        const lines = [
          profile.display_name ? `Name: ${profile.display_name}` : null,
          profile.assistant_name ? `Assistant name: ${profile.assistant_name}` : null,
          profile.timezone ? `Timezone: ${profile.timezone}` : null,
          profile.profile_summary ? `About: ${profile.profile_summary}` : null,
        ].filter(Boolean);
        profileBlock = lines.join("\n");
      }
    } catch (e) {
      console.error("Profile read error", e instanceof Error ? e.message : "unknown");
    }

    // --- Explicit memory write -------------------------------------------
    const fact = extractExplicitMemory(data.message);
    let savedMemory: string | null = null;
    if (fact) {
      try {
        const { data: existing } = await supabase
          .from("memories")
          .select("id, content")
          .eq("user_id", userId)
          .eq("memory_type", "core")
          .limit(200);
        const normalized = normalize(fact);
        const duplicate = (existing ?? []).find((m) => normalize(m.content ?? "") === normalized);
        const superseded = (existing ?? []).find(
          (m) => !duplicate && sharesSubject(m.content ?? "", fact),
        );
        if (duplicate) {
          savedMemory = fact;
        } else if (superseded) {
          const { error: updateError } = await supabase
            .from("memories")
            .update({ content: fact, title: makeTitle(fact), confidence: 1.0, importance: 4 })
            .eq("id", superseded.id)
            .eq("user_id", userId);
          if (updateError) console.error("Memory update failed", updateError.message);
          else savedMemory = fact;
        } else {
          const { error: insertError } = await supabase.from("memories").insert({
            user_id: userId,
            memory_type: "core",
            title: makeTitle(fact),
            content: fact,
            importance: 4,
            confidence: 1.0,
            source_type: "chat",
          });
          if (insertError) console.error("Memory insert failed", insertError.message);
          else savedMemory = fact;
        }
      } catch (e) {
        console.error("Memory write error", e instanceof Error ? e.message : "unknown");
      }
    }

    // --- Long-term memory read -------------------------------------------
    let memoryBlock = "";
    try {
      const nowIso = new Date().toISOString();
      const { data: memories } = await supabase
        .from("memories")
        .select("title, content, importance, created_at, expires_at")
        .eq("user_id", userId)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(40);
      if (memories && memories.length > 0) {
        memoryBlock = memories
          .map((m) => `- ${m.title ? `${m.title}: ` : ""}${m.content}`)
          .join("\n");
      }
    } catch (e) {
      console.error("Memory read error", e instanceof Error ? e.message : "unknown");
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
                "You are a helpful personal AI assistant. Be concise, warm and practical. " +
                "You are given CORE PROFILE (permanent identity), LONG-TERM MEMORY (persistent facts and preferences), " +
                "and CURRENT CONVERSATION. Treat CORE PROFILE and LONG-TERM MEMORY as known facts about the user, " +
                "but always prefer newer explicit corrections from the current conversation." +
                (savedMemory
                  ? ` The user just asked you to remember something and it has been saved permanently: "${savedMemory}". Briefly confirm it.`
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
      return { error: "Couldn't reach the AI service. Please try again." } as const;
    }

    if (!response.ok) {
      console.error("OpenAI request failed with status", response.status);
      if (response.status === 429) {
        return { error: "Too many requests right now. Please try again shortly." } as const;
      }
      if (response.status === 401 || response.status === 403) {
        return { error: "The AI service rejected the request." } as const;
      }
      return { error: "The AI couldn't answer right now. Please try again." } as const;
    }

    let payload: {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    try {
      payload = await response.json();
    } catch {
      return { error: "The AI sent an unreadable response." } as const;
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

    if (!text) return { error: "The AI returned an empty response." } as const;

    const { error: assistantMsgError } = await supabase.from("conversation_messages").insert({
      user_id: userId,
      conversation_id: conversationId,
      role: "assistant",
      content: text,
    });
    if (assistantMsgError) console.error("Assistant message save failed", assistantMsgError.message);

    return { reply: text, conversationId } as const;
  });

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function makeTitle(fact: string) {
  const words = fact.split(/\s+/).slice(0, 6).join(" ");
  return words.length < fact.length ? `${words}…` : words;
}

/** Rough "same subject" check so a correction replaces the old fact. */
function sharesSubject(oldContent: string, newFact: string) {
  const stop = new Set([
    "my","the","a","an","is","are","that","this","i","me","to","of","and","in","for","it","with","prefer","favorite","favourite",
  ]);
  const keys = (s: string) =>
    new Set(normalize(s).split(" ").filter((w) => w.length > 2 && !stop.has(w)));
  const oldKeys = keys(oldContent);
  const newKeys = keys(newFact);
  if (oldKeys.size === 0 || newKeys.size === 0) return false;
  let shared = 0;
  newKeys.forEach((k) => {
    if (oldKeys.has(k)) shared += 1;
  });
  return shared / Math.min(oldKeys.size, newKeys.size) >= 0.7;
}

/** Detects an explicit, unambiguous statement of the user's own name. */
function extractName(message: string): string | null {
  const m = message.match(
    /^\s*(?:hi[, ]+|hello[, ]+)?(?:my name is|i am called|i'm called|you can call me|call me)\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,2})\s*[.!]?\s*$/i,
  );
  if (!m?.[1]) return null;
  const name = m[1].trim();
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
      const fact = m[1].trim().replace(/^that\s+/i, "").replace(/\s+/g, " ").trim();
      if (fact.length >= 2 && fact.length <= 2000) return fact;
    }
  }
  return null;
}
