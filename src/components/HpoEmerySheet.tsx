import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, X } from "lucide-react";
import brainImage from "@/assets/neural-brain.png";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import { sendEmeryMessage } from "@/lib/emery.functions";

const EVENT_NAME = "emery:hpo-chat";

type HpoEmeryDetail = {
  prompt?: string;
  title?: string;
  autoSend?: boolean;
};

type MiniMessage = {
  id?: string;
  role: "user" | "assistant";
  text: string;
};

export function openHpoEmery(
  prompt = "",
  title = "HPO",
  options: { autoSend?: boolean } = {},
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<HpoEmeryDetail>(EVENT_NAME, {
      detail: { prompt, title, autoSend: options.autoSend === true },
    }),
  );
}

export function HpoEmerySheet({
  onChanged,
  onRouteBuilt,
  routeId,
  stopId,
  selectedAccountId,
  surface = "hpo",
}: {
  onChanged?: () => void;
  onRouteBuilt?: (routeId: string) => void;
  routeId?: string | null;
  stopId?: string | null;
  selectedAccountId?: string | null;
  surface?: string;
}) {
  const askEmery = useServerFn(sendEmeryMessage);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<string>("");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("HPO");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MiniMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [autoPrompt, setAutoPrompt] = useState("");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<HpoEmeryDetail>).detail ?? {};
      sessionRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `hpo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setTitle(detail.title || "HPO");
      setDraft(detail.autoSend ? "" : detail.prompt || "");
      setAutoPrompt(detail.autoSend ? detail.prompt || "" : "");
      setMessages([]);
      setError("");
      setPending(false);
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ block: "end", behavior: pending ? "smooth" : "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, pending, error, open]);

  useEffect(() => {
    if (!open || !autoPrompt || pending) return;
    const prompt = autoPrompt;
    setAutoPrompt("");
    const timer = window.setTimeout(() => {
      void sendText(prompt, false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [autoPrompt, open, pending]);

  async function sendText(text: string, showUser: boolean) {
    const clean = text.trim();
    if (!clean || pending) return;
    if (showUser) {
      setMessages((current) => [...current, { role: "user", text: clean }]);
      setDraft("");
    }
    setPending(true);
    setError("");
    try {
      const result = await askEmery({
        data: {
          message: clean,
          attachments: [],
          source: {
            entryPoint: "chat",
            inputMode: "typed",
            surface,
            hpoRouteId: routeId ?? null,
            hpoStopId: stopId ?? null,
            selectedAccountId: selectedAccountId ?? null,
            hpoEphemeral: true,
            hpoEphemeralSession: sessionRef.current || null,
          },
        },
      });
      if (!("reply" in result) || !result.reply) {
        throw new Error(("error" in result && result.error) || "Emery couldn't complete that.");
      }
      setMessages((current) => [
        ...current,
        {
          id: "assistantMessage" in result ? result.assistantMessage?.id : undefined,
          role: "assistant",
          text: result.reply,
        },
      ]);
      onChanged?.();

      const routeCommand =
        "hpoRouteCommand" in result ? (result as any).hpoRouteCommand : null;
      if (
        routeCommand?.performed &&
        routeCommand?.action === "hpo.route.create" &&
        routeCommand?.routeId
      ) {
        const builtRouteId = String(routeCommand.routeId);
        window.setTimeout(() => {
          setOpen(false);
          onRouteBuilt?.(builtRouteId);
        }, 650);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Emery couldn't complete that.");
    } finally {
      setPending(false);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }

  async function send() {
    const clean = draft.trim();
    if (!clean || pending) return;
    await sendText(clean, true);
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end bg-black/55 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-4"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Ask Emery"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-t-[1.6rem] border border-border/60 bg-background shadow-[0_-24px_70px_rgba(0,0,0,0.45)] sm:rounded-[1.4rem]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border/80 sm:hidden" />
        <div className="flex items-center gap-3 border-b border-border/45 px-4 py-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/15 bg-primary/[0.05]">
            <img src={brainImage} alt="" className="emery-blue-brain size-9 object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Emery</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {title} · quick HPO session · same Emery brain and tools
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            aria-label="Close Emery"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[42dvh] min-h-24 space-y-3 overflow-y-auto px-4 py-3">
          {!messages.length ? (
            <p className="text-sm leading-6 text-muted-foreground">
              This is a focused HPO work session. Tell Emery what you want to plan or change; she still uses your HPO history, notes, memory and route tools underneath.
            </p>
          ) : null}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  message.role === "user"
                    ? "max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-6 text-primary-foreground"
                    : "max-w-[92%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 text-sm leading-6 text-foreground"
                }
              >
                {message.text}
              </div>
            </div>
          ))}
          {pending ? <p className="text-xs text-muted-foreground">Emery is working…</p> : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div ref={endRef} aria-hidden="true" className="h-px" />
        </div>

        <div className="border-t border-border/45 bg-background/96 px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))] pt-2">
          <div className="flex items-end gap-1.5 rounded-xl border border-input bg-card p-1.5">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Tell Emery what to do…"
              className="max-h-28 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground/60"
            />
            <EmeryVoiceControl
              hpoRouteId={routeId ?? null}
              hpoStopId={stopId ?? null}
              hpoAccountId={selectedAccountId ?? null}
              onConversationChanged={() => {
                onChanged?.();
                window.setTimeout(() => {
                  endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
                }, 80);
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || pending}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-35"
              aria-label="Send to Emery"
            >
              <ArrowUp className="size-[18px]" />
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
