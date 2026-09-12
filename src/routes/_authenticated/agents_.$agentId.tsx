import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, BrainCircuit, Loader2, Send, ShieldCheck, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getAgentThread, sendAgentMessage } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/agents_/$agentId")({ component: AgentChat });

type Agent = { id: string; name: string; slug: string; description: string; mission: string };
type Message = {
  id: string;
  speaker: "user" | "emery" | "agent";
  speaker_name: string;
  content: string;
  created_at: string;
};

function AgentChat() {
  const { agentId } = Route.useParams();
  const loadThread = useServerFn(getAgentThread);
  const sendMessage = useServerFn(sendAgentMessage);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadThread({ data: { agentId } });
        if (cancelled) return;
        setAgent(result.agent as Agent);
        setMessages((result.messages ?? []) as Message[]);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Couldn't open this agent chat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, loadThread]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);
  const participants = useMemo(
    () => (agent ? `Adam + Emery + ${agent.name}` : "Adam + Emery + Specialist"),
    [agent],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending || !agent) return;
    setDraft("");
    setPending(true);
    setError(null);
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      speaker: "user",
      speaker_name: "Adam",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const result = await sendMessage({ data: { agentId: agent.id, message: text } });
      if (!result || "error" in result) {
        setError(result?.error ?? "That turn didn't finish. Try again.");
        setMessages((prev) => {
          const withoutOptimistic = prev.filter((message) => message.id !== optimistic.id);
          if (!result?.userMessage) return withoutOptimistic;
          return [
            ...withoutOptimistic,
            result.userMessage as Message,
            ...(result.emeryMessage ? [result.emeryMessage as Message] : []),
          ];
        });
        return;
      }
      setMessages((prev) => [
        ...prev.filter((message) => message.id !== optimistic.id),
        result.userMessage as Message,
        result.agentMessage as Message,
        ...(result.emeryMessage ? [result.emeryMessage as Message] : []),
      ]);
    } catch (err) {
      console.error(err);
      setError("That turn didn't finish. Try again.");
      setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell title={agent?.name ?? "Agent"} padded={false}>
      <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col">
        <section className="sticky top-[4.25rem] z-20 border-b border-border/35 bg-background/78 px-4 py-3 backdrop-blur-2xl sm:px-5">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <Link
              to="/agents"
              aria-label="Back to agents"
              className="emery-press emery-surface flex size-10 shrink-0 items-center justify-center rounded-2xl text-muted-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-2xl">
              <BrainCircuit className="size-[18px]" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight">{participants}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {agent?.description ?? "Emery specialist group chat"}
              </p>
            </div>
            <div className="emery-chip flex shrink-0">
              <ShieldCheck className="size-3" />
              <span className="hidden min-[380px]:inline">Emery leads</span>
              <span className="min-[380px]:hidden">Lead</span>
            </div>
          </div>
        </section>

        <div className="emery-scrollbar flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" /> Opening group chat…
            </div>
          ) : null}
          {!loading && agent && messages.length === 0 ? (
            <div className="emery-fade-up mx-auto max-w-lg py-12 text-center">
              <div className="emery-glass-strong mx-auto flex size-16 items-center justify-center rounded-[1.4rem] text-primary">
                <Users className="size-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold tracking-tight">The team is here.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Talk normally. {agent.name} brings the specialty; Emery keeps your bigger picture in
                view.
              </p>
              <p className="emery-surface mt-4 rounded-2xl p-3 text-xs leading-5 text-muted-foreground">
                {agent.mission}
              </p>
            </div>
          ) : null}

          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.map((message) => (
              <GroupMessage key={message.id} message={message} agentName={agent?.name ?? "Agent"} />
            ))}
            {pending ? (
              <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-primary" /> {agent?.name ?? "Agent"}{" "}
                and Emery are thinking together…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>

        {error ? (
          <div
            className="mx-4 mb-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="sticky bottom-0 z-20 bg-[linear-gradient(180deg,transparent,oklch(0.095_0.02_160/0.98)_24%)] px-3 pb-3 pt-6 sm:px-5"
        >
          <div className="emery-glass-strong mx-auto flex max-w-2xl items-end gap-2 rounded-[1.6rem] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={agent ? `Message Emery + ${agent.name}…` : "Message the team…"}
              rows={1}
              className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/65"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending || !agent}
              aria-label="Send message"
              className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-35"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

function GroupMessage({ message, agentName }: { message: Message; agentName: string }) {
  const isUser = message.speaker === "user";
  const isEmery = message.speaker === "emery";
  const label = isUser ? "You" : isEmery ? "Emery" : agentName;
  return (
    <div className={`emery-fade-up flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[90%] ${isUser ? "items-end" : "items-start"}`}>
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {!isUser ? (
            <span
              className={`size-1.5 rounded-full ${isEmery ? "bg-primary shadow-[0_0_7px_oklch(0.805_0.175_155/0.55)]" : "bg-emerald-300/80"}`}
            />
          ) : null}
          {label}
        </div>
        <div
          className={`whitespace-pre-wrap rounded-[1.4rem] px-4 py-3 text-sm leading-6 ${isUser ? "rounded-br-[0.45rem] bg-[linear-gradient(145deg,oklch(0.79_0.17_155),oklch(0.64_0.15_158))] text-primary-foreground" : isEmery ? "emery-glass rounded-bl-[0.45rem] border-primary/16" : "emery-surface rounded-bl-[0.45rem]"}`}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}
