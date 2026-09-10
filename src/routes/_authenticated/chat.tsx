import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Paperclip, ArrowUp, History, Plus, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  sendChatMessage,
  getLatestConversation,
  listConversations,
  getConversationMessages,
} from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat")({
  component: Chat,
});

type Message = { id: number; role: "user" | "assistant"; text: string };
type ConversationSummary = { id: string; title: string | null; started_at: string };

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const askAssistant = useServerFn(sendChatMessage);
  const loadConversation = useServerFn(getLatestConversation);
  const loadList = useServerFn(listConversations);
  const loadMessages = useServerFn(getConversationMessages);

  const refreshList = useCallback(async () => {
    try {
      const result = await loadList({});
      setConversations(result?.conversations ?? []);
    } catch {
      /* ignore */
    }
  }, [loadList]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadConversation({});
        if (cancelled || !result) return;
        setConversationId(result.conversationId ?? null);
        setMessages(
          (result.messages ?? []).map((m, i) => ({ id: i + 1, role: m.role, text: m.text })),
        );
      } catch {
        /* start with an empty chat */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    void refreshList();
    return () => {
      cancelled = true;
    };
  }, [loadConversation, refreshList]);

  async function openConversation(id: string) {
    setHistoryOpen(false);
    setLoading(true);
    setError(null);
    try {
      const result = await loadMessages({ data: { conversationId: id } });
      setConversationId(id);
      setMessages(
        (result?.messages ?? []).map((m, i) => ({ id: i + 1, role: m.role, text: m.text })),
      );
    } catch {
      setError("Couldn't open that conversation.");
    } finally {
      setLoading(false);
    }
  }

  function newChat() {
    setHistoryOpen(false);
    setConversationId(null);
    setMessages([]);
    setError(null);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", text }]);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const isNew = !conversationId;
      const result = await askAssistant({ data: { message: text, conversationId } });
      if ("reply" in result && result.reply) {
        if ("conversationId" in result && result.conversationId) {
          setConversationId(result.conversationId);
        }
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, role: "assistant", text: result.reply },
        ]);
        if (isNew) void refreshList();
      } else {
        setError(("error" in result && result.error) || "Something went wrong.");
      }
    } catch {
      setError("Couldn't send your message. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell title="Chat" padded={false}>
      <div className="flex min-h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen((v) => !v);
              void refreshList();
            }}
            className="flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <History className="size-4" />
            History
          </button>
          <button
            type="button"
            onClick={newChat}
            className="flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Plus className="size-4" />
            New chat
          </button>
        </div>

        {historyOpen && (
          <div className="border-b border-border/60 bg-secondary/30 px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Saved conversations</p>
              <button
                type="button"
                aria-label="Close history"
                onClick={() => setHistoryOpen(false)}
                className="text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            {conversations.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground">No saved conversations yet.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openConversation(c.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                        c.id === conversationId ? "bg-secondary text-primary" : "text-foreground"
                      }`}
                    >
                      <span className="line-clamp-1">{c.title || "Untitled chat"}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {new Date(c.started_at).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex-1 space-y-3 px-4 py-5">
          {loading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Loading your conversation…
            </p>
          ) : messages.length === 0 ? (
            <div className="mx-auto max-w-sm py-16 text-center">
              <h2 className="text-base font-semibold">Ask me anything</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Your assistant is connected. Your conversation is saved to your account.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <p
                  className={
                    m.role === "user"
                      ? "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                      : "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm text-secondary-foreground"
                  }
                >
                  {m.text}
                </p>
              </div>
            ))
          )}

          {pending && (
            <div className="flex justify-start">
              <p className="rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
                Thinking…
              </p>
            </div>
          )}

          {error && (
            <p className="px-1 text-center text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <form
          onSubmit={send}
          className="sticky bottom-0 flex items-end gap-2 border-t border-border/60 bg-background/95 px-3 py-3 backdrop-blur"
        >
          <button
            type="button"
            disabled
            aria-label="Attach a file — uploads coming soon"
            title="Uploads coming soon"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-50"
          >
            <Paperclip className="size-5" />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            className="h-11 min-w-0 flex-1 rounded-full border border-input bg-secondary/50 px-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            disabled
            aria-label="Voice input — coming soon"
            title="Voice coming soon"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-50"
          >
            <Mic className="size-5" />
          </button>
          <button
            type="submit"
            aria-label="Send"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            disabled={!draft.trim() || pending}
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </AppShell>
  );
}
