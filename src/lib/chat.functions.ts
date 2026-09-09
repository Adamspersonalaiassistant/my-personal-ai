import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type HistoryTurn = { role: "user" | "assistant"; text: string };
type ChatInput = { message: string; history?: HistoryTurn[]; conversationId?: string | null };

type StoredMessage = { role: "user" | "assistant"; text: string; at: string };

function readStoredMessages(metadata: unknown): StoredMessage[] {
  const raw =
    metadata && typeof metadata === "object" && "messages" in metadata
      ? (metadata as { messages?: unknown }).messages
      : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is StoredMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as StoredMessage).role === "user" || (m as StoredMessage).role === "assistant") &&
        typeof (m as StoredMessage).text === "string",
    )
    .map((m) => ({ role: m.role, text: m.text, at: typeof m.at === "string" ? m.at : "" }));
}

function toTranscript(messages: StoredMessage[]) {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n\n")
    .slice(0, 100000);
}

/** Loads the signed-in user's most recent conversation, in chronological order. */
export const getLatestConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("conversations")
      .select("id, metadata")
      .eq("user_id", userId)
      .eq("channel", "app")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Conversation load failed", error.message);
      return { conversationId: null, messages: [] as StoredMessage[] };
    }
    if (!data) return { conversationId: null, messages: [] as StoredMessage[] };
    return { conversationId: data.id, messages: readStoredMessages(data.metadata) };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ChatInput) => {
    const message = typeof input?.message === "string" ? input.message.trim() : "";
    if (!message) throw new Error("Message is required");
    if (message.length > 8000) throw new Error("Message is too long");
    const history = (Array.isArray(input?.history) ? input.history : [])
      .filter(
        (t): t is HistoryTurn =>
          !!t &&
          (t.role === "user" || t.role === "assistant") &&
          typeof t.text === "string" &&
          t.text.trim().length > 0,
      )
      .slice(-30)
      .map((t) => ({ role: t.role, text: t.text.slice(0, 8000) }));
    const conversationId =
      typeof input?.conversationId === "string" && input.conversationId ? input.conversationId : null;
    return { message, history, conversationId };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      return { error: "The AI service isn't configured yet." } as const;
    }

    const { supabase, userId } = context;

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
        const duplicate = (existing ?? []).some(
          (m) => normalize(m.content ?? "") === normalized,
        );
        if (!duplicate) {
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
        } else {
          savedMemory = fact;
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
                "You are a helpful personal AI assistant. Be concise, warm and practical." +
                (savedMemory
                  ? ` The user just asked you to remember something and it has been saved permanently: "${savedMemory}". Briefly confirm it.`
                  : ""),
            },
            ...(memoryBlock
              ? [
                  {
                    role: "system" as const,
                    content:
                      "LONG-TERM MEMORY about the user (saved from previous sessions). Treat these as known facts, but prefer newer corrections the user makes in the current conversation:\n" +
                      memoryBlock,
                  },
                ]
              : []),

            ...data.history.map((turn) => ({
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

    if (!text) {
      return { error: "The AI returned an empty response." } as const;
    }

    return { reply: text } as const;
  });

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function makeTitle(fact: string) {
  const words = fact.split(/\s+/).slice(0, 6).join(" ");
  return words.length < fact.length ? `${words}…` : words;
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
