import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Cpu,
  GitBranch,
  Loader2,
  Send,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getJarvisRoom, getJarvisStatusPanel, sendJarvisMessage } from "@/lib/jarvis.functions";

type ToolTrace = { tool: string; ok: boolean; ms: number; summary: string; error?: string };
type RoomMessage = {
  id: string;
  speaker: "user" | "agent";
  speaker_name: string;
  content: string;
  created_at: string;
  metadata?: {
    tool_trace?: ToolTrace[];
    approval_required?: boolean;
    recoverable_error?: boolean;
  } | null;
};

type Panel = Awaited<ReturnType<typeof getJarvisStatusPanel>>;

const STATUS_ROWS: Array<{ key: string; label: string }> = [
  { key: "queued", label: "Queued" },
  { key: "researching", label: "Researching" },
  { key: "building", label: "Building" },
  { key: "testing", label: "Testing" },
  { key: "repairing", label: "Repairing" },
  { key: "ready_for_release", label: "Ready" },
  { key: "blocked", label: "Blocked" },
  { key: "completed", label: "Completed" },
];

export function JarvisRoom() {
  const loadRoom = useServerFn(getJarvisRoom);
  const loadPanel = useServerFn(getJarvisStatusPanel);
  const send = useServerFn(sendJarvisMessage);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function refreshPanel() {
    try {
      setPanel(await loadPanel());
      setPanelError(null);
    } catch (caught) {
      console.error(caught);
      setPanelError("Engineering status unavailable.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const room = await loadRoom();
        if (!cancelled) setMessages((room.messages ?? []) as RoomMessage[]);
      } catch (caught) {
        console.error(caught);
        if (!cancelled) setError("Couldn't open the JARVIS room.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    void refreshPanel();
    return () => {
      cancelled = true;
    };
  }, [loadRoom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [draft]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    setPending(true);
    setError(null);
    const optimistic: RoomMessage = {
      id: `temp-${Date.now()}`,
      speaker: "user",
      speaker_name: "Adam",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const result = await send({ data: { message: text } });
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        result.userMessage as RoomMessage,
        ...(result.agentMessage ? [result.agentMessage as RoomMessage] : []),
      ]);
      if (result.error) setError(result.error);
      void refreshPanel();
    } catch (caught) {
      console.error(caught);
      setError("That turn didn't finish. Try again.");
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setPending(false);
    }
  }

  const status = panel?.status;
  const production = panel?.production;
  const githubMissing = panel ? !panel.configuration["JARVIS_GITHUB_TOKEN"] : false;
  const approvals = status?.approvals_required ?? [];

  return (
    <AppShell title="JARVIS Engineer" padded={false}>
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
            <div className="emery-icon-well hidden size-10 shrink-0 items-center justify-center rounded-xl min-[390px]:flex">
              <Cpu className="size-[18px]" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-[-0.015em]">
                Adam ↔ JARVIS Engineer
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {production?.commit
                  ? `Production ${production.commit.slice(0, 7)}${production.source === "release_ledger" ? " (ledger)" : ""}${production.in_sync === false ? " · main differs" : production.in_sync ? " · in sync" : ""}`
                  : (panelError ?? "Reading production state…")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={panelOpen}
              className="emery-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border/45 bg-card/30 px-2.5 text-[11px] font-semibold text-muted-foreground"
            >
              {status ? `${status.accepted_today}/${status.capacity}` : "—"}
              <ChevronDown
                className={`size-3.5 transition-transform ${panelOpen ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          {approvals.length ? (
            <div
              className="mx-auto mt-2 flex max-w-2xl items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-100/90"
              role="status"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Approval required: {approvals.length} item{approvals.length === 1 ? "" : "s"}
              </span>
            </div>
          ) : null}

          {panelOpen ? (
            <div className="emery-fade-up mx-auto mt-2 max-h-[46dvh] max-w-2xl space-y-2.5 overflow-y-auto pb-1">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Accepted today"
                  value={status ? `${status.accepted_today} / ${status.capacity}` : "—"}
                />
                <Stat
                  label="Active session"
                  value={status?.active_session ? status.active_session.status : "None"}
                />
                <Stat
                  label="Production"
                  value={production?.commit ? production.commit.slice(0, 7) : "Unknown"}
                />
                <Stat
                  label="GitHub main"
                  value={
                    production?.github_main
                      ? production.github_main.slice(0, 7)
                      : githubMissing
                        ? "No token"
                        : "—"
                  }
                />
              </div>
              {status ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {STATUS_ROWS.map((row) => (
                    <div
                      key={row.key}
                      className="rounded-lg border border-border/35 bg-card/25 px-2 py-1.5 text-center"
                    >
                      <p className="text-sm font-semibold tabular-nums">
                        {status.status_counts[row.key as keyof typeof status.status_counts] ?? 0}
                      </p>
                      <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                        {row.label}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {production?.discrepancies?.length ? (
                <PanelList
                  title="Deployment discrepancies"
                  items={production.discrepancies}
                  tone="warn"
                />
              ) : null}
              {githubMissing ? (
                <PanelList
                  title="Configuration"
                  tone="warn"
                  items={[
                    "GitHub tools need the JARVIS_GITHUB_TOKEN server secret (the repository is private).",
                  ]}
                />
              ) : null}
              {panel?.latest_improvements?.length ? (
                <PanelList
                  title="Latest improvements"
                  items={panel.latest_improvements.map(
                    (item) => `${item.title}${item.verified ? " · verified" : ""}`,
                  )}
                />
              ) : null}
              {status?.self_improvement_research?.length ? (
                <PanelList
                  title="JARVIS self-improvement research"
                  items={status.self_improvement_research
                    .slice(0, 3)
                    .map(
                      (f: { topic: string; classification: string }) =>
                        `${f.topic} → ${f.classification}`,
                    )}
                />
              ) : null}
              {approvals.length ? (
                <PanelList
                  title="Approval required"
                  tone="warn"
                  items={approvals.map(
                    (a: { detail: string | null }) => a.detail ?? "Pending decision",
                  )}
                />
              ) : null}
            </div>
          ) : null}
        </section>

        <div
          className="emery-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
          aria-label="JARVIS engineering conversation"
        >
          {loading ? (
            <div
              className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="size-4 animate-spin" /> Opening the engineering room…
            </div>
          ) : null}
          {!loading && messages.length === 0 ? (
            <div className="mx-auto max-w-md py-12 text-center">
              <Cpu className="mx-auto size-7 text-primary/80" strokeWidth={1.7} />
              <p className="mt-3 text-sm font-medium">Engineering room</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Ask what I'm working on, what's broken, or hand me an engineering task.
              </p>
            </div>
          ) : null}
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {messages.map((message) => (
              <RoomBubble key={message.id} message={message} />
            ))}
            {pending ? (
              <div
                className="flex items-center gap-2 pl-1 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="size-3.5 animate-spin text-primary" /> JARVIS is working…
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

        <form onSubmit={handleSubmit} className="z-20 shrink-0 px-2.5 pb-2 pt-3 sm:px-5 sm:pb-3">
          <div className="emery-glass-strong mx-auto flex max-w-2xl items-end gap-2 rounded-[1.6rem] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  window.matchMedia("(pointer: fine)").matches
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Talk to JARVIS…"
              rows={1}
              className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[16px] leading-6 outline-none placeholder:text-muted-foreground/65 sm:text-[15px]"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending}
              aria-label="Send message"
              className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-35"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
          <p className="mx-auto mt-1.5 max-w-2xl px-2 text-center text-[9px] leading-4 text-muted-foreground/70">
            <ShieldCheck className="mr-1 inline size-2.5" /> Free-first. Candidate work stays on
            jarvis/ branches; releases and paid credits need your approval.
          </p>
        </form>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/28 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PanelList({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${tone === "warn" ? "border-amber-400/20 bg-amber-400/[0.04]" : "border-border/35 bg-card/22"}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </p>
      <ul className="mt-1 space-y-1">
        {items.slice(0, 6).map((item, index) => (
          <li key={index} className="text-[11px] leading-5 text-foreground/85">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoomBubble({ message }: { message: RoomMessage }) {
  const isUser = message.speaker === "user";
  const [open, setOpen] = useState(false);
  const trace = message.metadata?.tool_trace ?? [];
  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  return (
    <div className={`emery-fade-up flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[94%] sm:max-w-[88%]">
        <div className={`mb-1.5 flex items-center gap-2 px-1 ${isUser ? "justify-end" : ""}`}>
          {!isUser ? <Wrench className="size-3 text-primary/80" /> : null}
          <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            {isUser ? "You" : "JARVIS"}
          </span>
          {time ? <span className="text-[9px] text-muted-foreground/55">{time}</span> : null}
        </div>
        <div
          className={`whitespace-pre-wrap rounded-[1.45rem] px-4 py-3 text-[15px] leading-6 ${
            isUser
              ? "rounded-br-[0.45rem] bg-primary text-primary-foreground"
              : `rounded-tl-[0.45rem] border bg-card/42 text-foreground ${message.metadata?.recoverable_error ? "border-destructive/30" : message.metadata?.approval_required ? "border-amber-400/30" : "border-border/50"}`
          }`}
        >
          {message.content}
        </div>
        {!isUser && trace.length ? (
          <div className="mt-1.5 px-1">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            >
              <GitBranch className="size-3" /> {trace.length} tool call
              {trace.length === 1 ? "" : "s"} · {trace.filter((t) => t.ok).length} ok
              <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? (
              <ul className="mt-1.5 space-y-1 rounded-xl border border-border/35 bg-card/20 p-2">
                {trace.map((entry, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-[10px] leading-4">
                    {entry.ok ? (
                      <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-primary" />
                    ) : (
                      <XCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0">
                      <span className="font-semibold text-foreground/85">{entry.tool}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {entry.ms}ms · {entry.ok ? entry.summary : (entry.error ?? entry.summary)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
