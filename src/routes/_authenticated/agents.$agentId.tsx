import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, BrainCircuit, Loader2, Send, ShieldCheck, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getAgentThread, sendAgentMessage } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/agents/$agentId")({
  component: AgentChat,
});

type Agent = {
  id: string;
  name: string;
  slug: string;
  description: string;
  mission: string;
};

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

  const participants = useMemo(() => {
    if (!agent) return "Adam + Emery + Specialist";
    return `Adam + Emery + ${agent.name}`;
  }, [agent]);

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
        setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));
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
        <section className="sticky top-[4.25rem] z-20 border-b border-border/45 bg-background/88 px-4 py-3 backdrop-blur-2xl">
          <div className="flex items-center gap-3">
            <Link
              to="/agents"
              aria-label="Back to agents"
              className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-card/65 text-muted-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.07] text-primary">
              <BrainCircuit className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{participants}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {agent?.description ?? "Emery specialist group chat"}
              </p>
            </div>
            <div className="hidden items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.05] px-2.5 py-1 text-[10px] font-semibold text-primary sm:flex">
              <ShieldCheck className="size-3" /> Emery leads
            </div>
          </div>
        </section>

        <div className="flex-1 px-4 py-4 sm:px-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Opening group chat…
            </div>
          ) : null}

          {!loading && agent && messages.length === 0 ? (
            <div className="mx-auto max-w-lg py-10 text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-[1.4rem] border border-primary/20 bg-primary/[0.06] text-primary emery-glow">
                <Users className="size-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold tracking-tight">The team is here.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Talk normally. {agent.name} brings the specialty; Emery keeps the bigger picture, your goals and your other systems in view.
              </p>
              <p className="mt-3 text-xs leading-5 text-muted-foreground/80">{agent.mission}</p>
            </div>
          ) : null}

          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.map((message) => (
              <GroupMessage key={message.id} message={message} agentName={agent?.name ?? "Agent"} />
            ))}
            {pending ? (
              <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                {agent?.name ?? "Agent"} and Emery are working on it…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>

        {error ? (
          <div className="mx-4 mb-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">
            {error}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="sticky bottom-[4.6rem] z-20 border-t border-border/45 bg-background/90 px-3 pb-3 pt-2 backdrop-blur-2xl sm:px-5"
        >
          <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-[1.45rem] border border-border/70 bg-card/80 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.18)] focus-within:border-primary/35">
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
              className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending || !agent}
              aria-label="Send message"
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition disabled:opacity-35"
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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] ${isUser ? "items-end" : "items-start"}`}>
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {!isUser ? (
            <span
              className={`size-1.5 rounded-full ${isEmery ? "bg-primary" : "bg-emerald-300/80"}`}
            />
          ) : null}
          {label}
        </div>
        <div
          className={`whitespace-pre-wrap rounded-[1.35rem] px-4 py-3 text-sm leading-6 ${
            isUser
              ? "rounded-br-md bg-primary text-primary-foreground"
              : isEmery
                ? "rounded-bl-md border border-primary/15 bg-primary/[0.055] text-foreground"
                : "rounded-bl-md border border-border/65 bg-card/75 text-foreground"
          }`}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}
