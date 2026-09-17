import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Paperclip, ArrowUp, History, Plus, X, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import brainImage from "@/assets/neural-brain.png";
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

const quickPrompts = [
  "What should I focus on?",
  "What do you remember about me?",
  "Help me think this through",
];

function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: pending ? "smooth" : "auto" });
  }, [messages, pending]);

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

  function resetComposer() {
    setDraft("");
    if (composerRef.current) composerRef.current.style.height = "auto";
  }

  function newChat() {
    setHistoryOpen(false);
    setConversationId(null);
    setMessages([]);
    setError(null);
    resetComposer();
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || pending) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", text: clean }]);
    resetComposer();
    setError(null);
    setPending(true);
    try {
      const isNew = !conversationId;
      const result = await askAssistant({ data: { message: clean, conversationId } });
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

  async function send(e: React.FormEvent) {
    e.preventDefault();
    await sendMessage(draft);
  }

  return (
    <AppShell title="Chat" padded={false}>
      <div className="relative flex min-h-[calc(100dvh-132px)] flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-background/45 px-3 py-2 backdrop-blur-xl sm:px-4">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(true);
              void refreshList();
            }}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3.5 text-xs font-medium text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
          >
            <History className="size-4" />
            History
          </button>
          <button
            type="button"
            onClick={newChat}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.08] px-3.5 text-xs font-semibold text-primary transition hover:bg-primary/[0.14]"
          >
            <Plus className="size-4" />
            New chat
          </button>
        </div>

        {historyOpen ? (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
            <aside
              className="emery-glass absolute inset-y-0 left-0 w-[min(88vw,360px)] overflow-hidden rounded-r-2xl border-y-0 border-l-0 p-4 pt-[max(1rem,env(safe-area-inset-top))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Memory archive</p>
                  <p className="mt-1 text-sm font-semibold">Conversation history</p>
                </div>
                <button
                  type="button"
                  aria-label="Close history"
                  onClick={() => setHistoryOpen(false)}
                  className="flex size-11 items-center justify-center rounded-xl border border-border/60 bg-card/70 text-muted-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              {conversations.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No saved conversations yet.</p>
              ) : (
                <ul className="emery-scrollbar mt-5 max-h-[calc(100dvh-110px)] space-y-2 overflow-y-auto pr-1">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openConversation(c.id)}
                        className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                          c.id === conversationId
                            ? "border-primary/35 bg-primary/[0.10] shadow-[0_0_18px_oklch(0.72_0.17_244/0.08)]"
                            : "border-border/50 bg-card/55 hover:border-primary/25"
                        }`}
                      >
                        <span className="line-clamp-1 text-sm font-medium">{c.title || "Untitled chat"}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {new Date(c.started_at).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        ) : null}

        <div className="emery-scrollbar flex-1 overflow-y-auto px-4 pb-5 pt-5 sm:px-6">
          {loading ? (
            <div className="flex min-h-[48vh] items-center justify-center">
              <p className="text-sm text-muted-foreground">Restoring Emery context…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex min-h-[54vh] max-w-md flex-col items-center justify-center py-8 text-center">
              <div className="relative">
                <div className="absolute inset-1 rounded-full bg-primary/18 blur-3xl" />
                <div className="emery-breathe relative flex size-28 items-center justify-center overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.06] shadow-[inset_0_0_30px_oklch(0.72_0.17_244/0.06)]">
                  <img src={brainImage} alt="Emery neural core" className="h-24 w-24 object-cover" />
                </div>
              </div>
              <div className="mt-6 flex items-center gap-2 text-primary">
                <Sparkles className="size-4" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em]">Core online</span>
              </div>
              <h2 className="emery-text-gradient mt-3 text-2xl font-semibold tracking-tight">I’m here, Adam.</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                What are we working through?
              </p>
              <div className="mt-7 flex w-full flex-wrap justify-center gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    className="min-h-11 rounded-xl border border-border/60 bg-card/60 px-3.5 text-xs font-medium text-muted-foreground transition hover:border-primary/35 hover:bg-primary/[0.08] hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end pl-10">
                    <div className="max-w-[86%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-primary/25 bg-[linear-gradient(145deg,oklch(0.69_0.18_244),oklch(0.54_0.16_252))] px-4 py-3 text-[15px] leading-6 text-white shadow-[0_12px_34px_oklch(0.38_0.13_250/0.22)]">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-start gap-2.5 pr-4">
                    <div className="mt-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary/25 bg-primary/[0.06]">
                      <img src={brainImage} alt="" className="emery-orb size-7 object-cover" />
                    </div>
                    <div className="emery-glass max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-md px-4 py-3 text-[15px] leading-6 text-foreground">
                      {m.text}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {pending ? (
            <div className="mt-5 flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg border border-primary/25 bg-primary/[0.06]">
                <img src={brainImage} alt="" className="emery-orb size-7 object-cover" />
              </div>
              <div className="emery-glass flex min-h-11 items-center gap-2 rounded-xl px-4 text-xs text-muted-foreground">
                <span>Emery is thinking</span>
                <span className="flex items-center gap-1">
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                  <span className="emery-dot size-1.5 rounded-full bg-primary" />
                </span>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 z-20 bg-[linear-gradient(180deg,transparent,oklch(0.095_0.024_255/0.99)_18%)] px-3 pb-3 pt-5 sm:px-4">
          <form onSubmit={send} className="emery-glass flex items-end gap-1.5 rounded-2xl p-2 shadow-[0_0_30px_oklch(0.45_0.13_244/0.08)]">
            <button
              type="button"
              disabled
              aria-label="Attach a file — planned"
              title="File uploads are planned"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground opacity-45"
            >
              <Paperclip className="size-[19px]" />
            </button>
            <textarea
              ref={composerRef}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => {
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(draft);
                }
              }}
              placeholder="Talk to Emery…"
              className="max-h-32 min-h-11 min-w-0 flex-1 bg-transparent px-2 py-2.5 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/75"
            />
            <button
              type="button"
              disabled
              aria-label="Emery Voice — next feature"
              title="Emery Voice is next"
              className="relative flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/[0.09] text-primary opacity-90 shadow-[inset_0_0_18px_oklch(0.72_0.17_244/0.05)]"
            >
              <Mic className="size-[19px]" />
              <span className="absolute -right-1 -top-1 rounded-full border border-background bg-card px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-primary">
                Next
              </span>
            </button>
            <button
              type="submit"
              aria-label="Send"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_22px_oklch(0.72_0.17_244/0.24)] transition hover:brightness-110 disabled:opacity-30"
              disabled={!draft.trim() || pending}
            >
              <ArrowUp className="size-[19px]" />
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
