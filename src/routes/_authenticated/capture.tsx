import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, BriefcaseBusiness, Loader2, MessageCircle, Mic2, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { sendEmeryMessage } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/capture")({
  validateSearch: (search: Record<string, unknown>) => ({
    text: typeof search.text === "string" ? search.text.slice(0, 4000) : "",
    context: search.context === "hpo" ? "hpo" : "general",
    autosend: search.autosend === "1" || search.autosend === true,
    token: typeof search.token === "string" ? search.token.slice(0, 100) : "",
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

  async function submit(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setError(null);
    try {
      const prefix = search.context === "hpo" ? "HPO quick capture: " : "Quick capture: ";
      const result = await sendToEmery({ data: { message: `${prefix}${clean}`, attachments: [] } });
      if (!("reply" in result) || !result.reply) {
        throw new Error(("error" in result && result.error) || "Emery couldn't process that capture.");
      }
      await navigate({ to: "/chat" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't send that to Emery.");
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
    // The initial shortcut payload is intentionally a one-shot trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell
      title="Quick Capture"
      askEmery={search.context === "hpo" ? "Help me process this HPO capture and put it in the right work context." : "Help me process this quick capture and decide where it belongs."}
    >
      <div className="mx-auto max-w-xl space-y-4">
        <section className="emery-glass-strong rounded-[1.8rem] p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-2xl text-primary">
              {search.context === "hpo" ? <BriefcaseBusiness className="size-5" /> : <Sparkles className="size-5" />}
            </div>
            <div>
              <p className="emery-kicker">{search.context === "hpo" ? "HPO capture" : "Emery capture"}</p>
              <h1 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Get it out of your head.</h1>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Don’t organize it first. Say or type what happened and let Emery decide the right context, next action and specialist.
          </p>

          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus={!search.autosend}
            rows={5}
            placeholder={search.context === "hpo" ? "What happened at the office, with the account, or on your route?" : "What do you need Emery to capture?"}
            className="mt-4 min-h-36 w-full rounded-[1.4rem] border border-border/60 bg-card/60 px-4 py-3 text-[16px] leading-6 outline-none transition focus:border-primary/35"
          />

          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}

          <button
            type="button"
            onClick={() => void submit(draft)}
            disabled={sending || !draft.trim()}
            className="emery-press mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {sending ? "Emery is routing it…" : "Send to Emery"}
          </button>
        </section>

        <section className="emery-glass rounded-[1.55rem] p-4">
          <div className="flex items-start gap-3">
            <Mic2 className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Apple Shortcut ready</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                This page is a stable bridge for Dictate Text / Action Button shortcuts before full Emery Voice. A shortcut can open this route with text, context=hpo, autosend=1 and a unique token. It still writes into the same lifelong Emery conversation — not a second assistant.
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Link to="/chat" className="emery-press emery-surface flex min-h-12 items-center justify-center gap-2 rounded-2xl text-xs font-semibold text-muted-foreground hover:text-foreground">
            <MessageCircle className="size-4" /> Main Emery
          </Link>
          <Link to="/hpo" className="emery-press emery-surface flex min-h-12 items-center justify-center gap-2 rounded-2xl text-xs font-semibold text-muted-foreground hover:text-foreground">
            <BriefcaseBusiness className="size-4" /> HPO dashboard
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
