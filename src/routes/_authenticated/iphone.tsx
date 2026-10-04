import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clipboard,
  Files,
  Keyboard,
  Laptop,
  Mic2,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/iphone")({ component: IPhoneSetup });

const shortcutUrl =
  "https://emery-personal-ai.lovable.app/capture?text=[URL Encoded Text]&autosend=1&source=shortcut&input=dictated&token=[Current Date]";

function IPhoneSetup() {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(shortcutUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <AppShell title="iPhone & Shortcuts">
      <div className="mx-auto max-w-2xl space-y-5 pb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-primary/80">
            One Emery · every screen
          </p>
          <h1 className="mt-1.5 text-[1.55rem] font-semibold tracking-[-0.035em]">
            Use the same Emery on iPhone and computer.
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The PWA, browser, Voice, and Shortcut are only entry points. They all return to the same
            Emery, the same memory, the same main conversation, the same HPO state, and the same
            canonical action system.
          </p>
        </div>

        <section className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
          <StatusRow
            icon={Laptop}
            title="iPhone + computer continuity"
            detail="Ready · both devices use the same server-backed Emery state"
            ready
          />
          <StatusRow
            icon={Mic2}
            title="Dictated capture"
            detail="Ready now · sends speech-to-text into the same Emery conversation"
            ready
          />
          <StatusRow
            icon={Keyboard}
            title="Typed capture"
            detail="Ready now · use Ask for Input instead of Dictate Text"
            ready
          />
          <StatusRow
            icon={CalendarDays}
            title="Native iOS Calendar & Reminders"
            detail="Not connected yet · native iOS permissions remain separate from Emery's internal Calendar"
          />
          <StatusRow
            icon={Files}
            title="Photos & Files"
            detail="App uploads work now; Shortcut access still depends on the iOS actions you choose to add"
          />
        </section>

        <section className="rounded-2xl border border-border/40 bg-card/28 p-4">
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Install Emery like an app</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                On iPhone, open Emery in Safari and use Share → Add to Home Screen. On a supported
                desktop browser, install the Emery web app when the browser offers it. Both launch
                the same server-backed Emery; installing never creates another account or memory.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-primary/14 bg-primary/[0.035] p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary">
              <Smartphone className="size-[18px]" />
            </div>
            <div>
              <p className="text-sm font-semibold">Create one Shortcut named Emery</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                You do not need separate Emery shortcuts for HPO, Personal, or general thoughts.
                Emery routes the content after it reaches the same brain.
              </p>
            </div>
          </div>

          <ol className="mt-4 space-y-3 text-sm leading-6">
            <Step number="1">
              Add <strong>Dictate Text</strong> and set Stop Listening to After Pause.
            </Step>
            <Step number="2">
              Add <strong>URL Encode</strong> for the dictated text.
            </Step>
            <Step number="3">
              Add <strong>Current Date</strong> and format it as ISO 8601. This is only used to prevent
              an accidental duplicate autosend.
            </Step>
            <Step number="4">
              Add a <strong>URL</strong> action and use the template below.
            </Step>
            <Step number="5">
              Add <strong>Open URLs</strong>.
            </Step>
            <Step number="6">
              Add the Shortcut to your Home Screen, Action Button, or invoke it with Siri by saying
              “Emery.”
            </Step>
          </ol>
        </section>

        <section>
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Shortcut URL template
          </p>
          <div className="rounded-2xl border border-border/45 bg-card/32 p-3">
            <code className="block break-all text-[11px] leading-5 text-foreground/85">{shortcutUrl}</code>
            <button
              type="button"
              onClick={() => void copyUrl()}
              className="emery-press mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/45 bg-white/[0.025] text-xs font-semibold text-muted-foreground hover:border-primary/25 hover:text-foreground"
            >
              {copied ? <Check className="size-4 text-primary" /> : <Clipboard className="size-4" />}
              {copied ? "Copied" : "Copy template"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-border/40 bg-card/28 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Phone permissions stay under your control.</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Connecting the Emery Shortcut or installing the PWA does not give Emery blanket
                access to your iPhone. Calendar, Reminders, Photos, Files, Contacts, and other native
                permissions are requested only when an explicit Shortcut action or future native
                integration actually needs them.
              </p>
            </div>
          </div>
        </section>

        <Link
          to="/capture"
          search={{ text: "", autosend: false, token: "", source: "capture", input: "typed" }}
          className="emery-press flex min-h-12 items-center justify-between rounded-2xl border border-primary/15 bg-primary/[0.04] px-4 text-sm font-semibold"
        >
          Test the Emery capture bridge
          <ChevronRight className="size-4 text-primary" />
        </Link>
      </div>
    </AppShell>
  );
}

function StatusRow({
  icon: Icon,
  title,
  detail,
  ready = false,
}: {
  icon: typeof Smartphone;
  title: string;
  detail: string;
  ready?: boolean;
}) {
  return (
    <div className="flex min-h-[66px] items-center gap-3 border-b border-border/30 px-3.5 py-3 last:border-b-0">
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${ready ? "bg-primary/[0.06] text-primary" : "bg-white/[0.025] text-muted-foreground"}`}
      >
        <Icon className="size-[17px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{detail}</p>
      </div>
      {ready ? (
        <span className="shrink-0 rounded-full bg-primary/[0.08] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-primary">
          Ready
        </span>
      ) : null}
    </div>
  );
}

function Step({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.07] text-[11px] font-semibold text-primary">
        {number}
      </span>
      <span className="pt-0.5 text-sm text-foreground/88">{children}</span>
    </li>
  );
}
