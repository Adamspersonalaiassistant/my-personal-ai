import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, MessageCircle, Mic2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { deviceSourceMetadata } from "@/lib/emery/device-continuity";
import { sendEmeryMessage } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/capture")({
  validateSearch: (search: Record<string, unknown>) => ({
    text: typeof search["text"] === "string" ? search["text"].slice(0, 4000) : "",
    autosend: search["autosend"] === "1" || search["autosend"] === true,
    token: typeof search["token"] === "string" ? search["token"].slice(0, 100) : "",
    source: search["source"] === "shortcut" ? ("shortcut" as const) : ("capture" as const),
    input: search["input"] === "dictated" ? ("dictated" as const) : ("typed" as const),
  }),
  component: QuickCapture,
});

function QuickCapture() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const sendToEmery = useServerFn(sendEmeryMessage);
  const [draft, setDraft] = useState(search.text);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoAttempted = useRef(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  async function submit(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendToEmery({
        data: {
          message: clean,
          attachments: [],
          source: {
            entryPoint: search.source,
            inputMode: search.input,
            shortcutName: search.source === "shortcut" ? "Emery" : "",
            surface: "chat",
            ...deviceSourceMetadata(),
          },
        },
      });
      if (!("reply" in result) || !result.reply) {
        throw new Error(("error" in result && result.error) || "Emery couldn't process that.");
      }
      await navigate({ to: "/chat" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't reach Emery.");
      setSending(false);
    }
  }

  useEffect(() => {
    if (!search.autosend || !search.text.trim() || autoAttempted.current) return;
    autoAttempted.current = true;
    const key = search.token ? `emery:capture:${search.token}` : "";
    if (key && typeof window !== "undefined") {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "sent");
    }
    void submit(search.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 120), 260)}px`;
  }, [draft]);

  return (
    <AppShell title="Emery Capture">
      <div className="mx-auto max-w-xl pb-[max(1rem,env(safe-area-inset-bottom))]">
        <section className="emery-glass-strong rounded-[1.6rem] p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-2xl text-primary">
              <MessageCircle className="size-5" />
            </div>
            <div>
              <p className="emery-kicker">Same Emery · same conversation</p>
              <h1 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Say it naturally.</h1>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            No workspace choice. Emery keeps the conversation first, then routes HPO/work, Personal,
            General, or Mixed context behind the scenes.
          </p>
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus={!search.autosend}
            enterKeyHint="send"
            aria-label="Message Emery"
            placeholder="What’s on your mind?"
            className="mt-4 min-h-32 w-full resize-none rounded-[1.3rem] border border-border/60 bg-card/60 px-4 py-3 text-[16px] leading-6 outline-none transition focus:border-primary/35"
          />
          <div aria-live="polite">
            {error ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void submit(draft)}
            disabled={sending || !draft.trim()}
            aria-label="Send to Emery"
            className="emery-press mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {sending ? "Sending to Emery…" : "Send to Emery"}
          </button>
        </section>
        <section className="mt-3 rounded-[1.4rem] border border-border/45 bg-card/30 p-4">
          <div className="flex items-start gap-3">
            <Mic2 className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Shortcut bridge ready</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Dictated or typed Shortcut turns enter this same lifelong conversation. Device and
                source metadata only tell Emery how the turn arrived; they never create another
                assistant, memory, or workspace.
              </p>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
