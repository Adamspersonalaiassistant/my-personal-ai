import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type HistoryTurn = { role: "user" | "assistant"; text: string };
type ChatInput = { message: string; history?: HistoryTurn[] };

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
    return { message, history };
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
                "You are a helpful personal AI assistant. Be concise, warm and practical.",
            },
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
