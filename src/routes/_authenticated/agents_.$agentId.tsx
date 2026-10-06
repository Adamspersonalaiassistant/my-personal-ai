import { AssistantText } from "@/components/AssistantText";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BrainCircuit,
  Crown,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { JarvisRoom } from "@/components/JarvisRoom";
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [draft]);

  const participants = useMemo(
    () => (agent ? `Adam · Emery · ${agent.name}` : "Adam · Emery · Specialist"),
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

  // JARVIS Engineer has a dedicated Adam ↔ JARVIS room (no Emery commander).
  if (agent?.slug === "jarvis-engineer") return <JarvisRoom />;

  return (
    <AppShell title={agent?.name ?? "Agent"} padded={false}>
      <div className="flex h-full min-h-0 flex-col">
        <section className="shrink-0 border-b border-border/35 bg-background/62 px-3 py-2 backdrop-blur-2xl sm:px-5">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <Link
              to="/agents"
              aria-label="Back to agents"
              className="emery-press emery-surface flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>

            <div className="relative hidden shrink-0 min-[390px]:block">
              <div className="emery-icon-well flex size-10 items-center justify-center rounded-xl">
                <BrainCircuit className="size-[18px]" strokeWidth={1.8} />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-primary" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold tracking-[-0.015em]">{participants}</p>
                <span className="hidden shrink-0 items-center gap-1 rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary/80 sm:flex">
                  <Crown className="size-2.5" /> Emery leads
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {agent?.description ?? "Persistent Emery specialist group"}
              </p>
            </div>

            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/10 bg-primary/[0.035] text-primary sm:hidden"
              aria-label="Emery leads this group"
            >
              <Crown className="size-4" />
            </div>
          </div>

          {agent ? (
            <div className="mx-auto mt-2 flex max-w-2xl items-start gap-2 rounded-xl border border-border/40 bg-card/28 px-3 py-2">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <p className="line-clamp-1 text-[11px] leading-5 text-muted-foreground">
                <span className="font-semibold text-foreground/90">{agent.name}'s mission:</span>{" "}
                {agent.mission}
              </p>
            </div>
          ) : null}
        </section>

        <div
          className="emery-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6 sm:py-6"
          aria-label="Specialist group conversation"
        >
          {loading ? (
            <div
              className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
              role="status"
            >
              <div className="emery-glass flex size-12 items-center justify-center rounded-2xl text-primary">
                <Loader2 className="size-5 animate-spin" />
              </div>
              Opening the team conversation…
            </div>
          ) : null}

          {!loading && agent && messages.length === 0 ? (
            <div className="emery-fade-up mx-auto flex min-h-[36vh] max-w-lg flex-col items-center justify-center py-5 text-center">
              <div className="relative">
                <div className="absolute inset-1 rounded-full bg-primary/10 blur-2xl" />
                <div className="emery-glass-strong relative flex size-16 items-center justify-center rounded-[1.4rem] text-primary">
                  <Users className="size-6" />
                </div>
              </div>
              <p className="emery-kicker mt-3">Persistent group chat</p>
              <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.02em]">
                The right people are already in the room.
              </h2>
              <p className="mt-1.5 max-w-sm text-sm leading-5 text-muted-foreground">
                Talk normally. {agent.name} brings the specialty. Emery keeps your priorities,
                context, and final decision connected.
              </p>
              <div className="mt-3 grid w-full gap-2 sm:grid-cols-3">
                <Participant label="You" detail="Goal & context" />
                <Participant label="Emery" detail="Leader & synthesis" primary />
                <Participant
                  label={agent.name.replace(" Agent", "")}
                  detail="Specialist judgment"
                />
              </div>
            </div>
          ) : null}

          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {messages.map((message) => (
              <GroupMessage key={message.id} message={message} agentName={agent?.name ?? "Agent"} />
            ))}
            {pending ? (
              <div
                className="flex items-center gap-2.5 pl-1 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <div className="flex size-8 items-center justify-center rounded-xl border border-primary/10 bg-primary/[0.035] text-primary">
                  <Loader2 className="size-3.5 animate-spin" />
                </div>
                <span>{agent?.name ?? "Specialist"} is working with Emery on the answer…</span>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>

        {error ? (
          <div
            className="mx-3 mb-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive sm:mx-6"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="z-20 shrink-0 bg-[linear-gradient(180deg,transparent,oklch(0.095_0.02_160/0.98)_22%)] px-2.5 pb-2 pt-3 sm:px-5 sm:pb-3"
        >
          <div className="emery-glass-strong mx-auto flex max-w-2xl items-end gap-2 rounded-[1.6rem] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  const finePointer =
                    typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
                  if (finePointer) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }
              }}
              enterKeyHint="enter"
              placeholder={agent ? `Talk to Emery + ${agent.name}…` : "Message the team…"}
              rows={1}
              className="max-h-32 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2.5 text-[16px] leading-6 outline-none placeholder:text-muted-foreground/65 sm:text-[15px]"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending || !agent}
              aria-label="Send message"
              className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_0_20px_oklch(0.805_0.175_155/0.12)] disabled:opacity-35"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
          <p className="mx-auto mt-1.5 max-w-2xl px-2 text-center text-[9px] leading-4 text-muted-foreground/70">
            <ShieldCheck className="mr-1 inline size-2.5" /> Emery keeps specialist advice inside
            your privacy and approval boundaries.
          </p>
        </form>
      </div>
    </AppShell>
  );
}

function Participant({
  label,
  detail,
  primary = false,
}: {
  label: string;
  detail: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-3 py-3 text-left ${primary ? "border-primary/18 bg-primary/[0.055]" : "border-border/45 bg-card/30"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${primary ? "bg-primary shadow-[0_0_8px_oklch(0.805_0.175_155/0.55)]" : "bg-muted-foreground/55"}`}
        />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{detail}</p>
    </div>
  );
}

function GroupMessage({ message, agentName }: { message: Message; agentName: string }) {
  const isUser = message.speaker === "user";
  const isEmery = message.speaker === "emery";
  const label = isUser ? "You" : isEmery ? "Emery" : agentName;
  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <div className={`emery-fade-up flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[94%] sm:max-w-[88%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`mb-1.5 flex items-center gap-2 px-1 ${isUser ? "justify-end" : "justify-start"}`}
        >
          {!isUser ? (
            <span
              className={`flex size-6 items-center justify-center rounded-lg border ${isEmery ? "border-primary/14 bg-primary/[0.055] text-primary" : "border-border/45 bg-card/35 text-foreground/75"}`}
            >
              {isEmery ? <Crown className="size-3" /> : <BrainCircuit className="size-3" />}
            </span>
          ) : null}
          <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            {label}
          </span>
          {time ? <span className="text-[9px] text-muted-foreground/55">{time}</span> : null}
        </div>
        <div
          className={`rounded-[1.45rem] px-4 py-3 text-[15px] leading-6 ${
            isUser
              ? "rounded-br-[0.45rem] bg-[linear-gradient(145deg,oklch(0.79_0.17_155),oklch(0.64_0.15_158))] text-primary-foreground shadow-[0_10px_30px_oklch(0.3_0.09_158/0.12)]"
              : isEmery
                ? "emery-glass rounded-tl-[0.45rem] border-primary/16"
                : "rounded-tl-[0.45rem] border border-border/50 bg-card/42 text-foreground"
          }`}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <AssistantText text={message.content} />
          )}
        </div>
      </div>
    </div>
  );
}
