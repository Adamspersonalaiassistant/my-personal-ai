import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  FolderKanban,
  MessageCircle,
  Settings,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import { OperatingContextCard } from "@/components/OperatingContextCard";
import { CommandPanel } from "@/components/ui/emery/CommandPanel";
import { ContextStrip } from "@/components/ui/emery/ContextStrip";
import { SectionHeading } from "@/components/ui/emery/SectionHeading";
import type { EmeryVisualState } from "@/components/emery-visual/emery-visual.types";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Emery — Voice-first Personal Intelligence" },
      {
        name: "description",
        content:
          "Start a private voice briefing or open Emery's persistent conversation and workspaces.",
      },
      { property: "og:title", content: "Emery — Voice-first Personal Intelligence" },
      {
        property: "og:description",
        content: "A private command center for voice, context, Calendar, and HPO.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmeryHome,
});

const workspaces = [
  {
    to: "/conversation",
    label: "Open Chat",
    detail: "Persistent conversation and history",
    icon: MessageCircle,
    primary: true,
  },
  {
    to: "/hpo",
    label: "HPO",
    detail: "Planner, Maps, Accounts, Activity",
    icon: BriefcaseBusiness,
    primary: false,
  },
  {
    to: "/calendar",
    label: "Calendar",
    detail: "Tasks and schedule",
    icon: CalendarDays,
    primary: false,
  },
  {
    to: "/memories",
    label: "Memories",
    detail: "What Emery carries forward",
    icon: Brain,
    primary: false,
  },
  {
    to: "/projects",
    label: "Projects",
    detail: "Outcomes and next actions",
    icon: FolderKanban,
    primary: false,
  },
  {
    to: "/meetings",
    label: "Meetings",
    detail: "History and conversation context",
    icon: UsersRound,
    primary: false,
  },
  {
    to: "/settings",
    label: "Settings",
    detail: "Voice, iPhone, and system controls",
    icon: Settings,
    primary: false,
  },
] as const;

function EmeryHome() {
  const [voiceState, setVoiceState] = useState<EmeryVisualState>("idle");

  return (
    <AppShell title="Emery" padded={false}>
      <div className="emery-dashboard emery-scrollbar h-full overflow-y-auto overscroll-contain px-3 pb-5 pt-3 sm:px-5 md:px-7 md:py-6">
        <div className="mx-auto grid w-full max-w-[1180px] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0">
            <EmeryVoiceControl
              variant="core"
              persistTranscript={false}
              openingBrief
              onVisualStateChange={setVoiceState}
            />

            <ContextStrip className="mt-3" label="Continuity">
              <span className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em]">
                <span>Connected</span>
                <span className="size-1 rounded-full bg-live/60" />
                <span>Private</span>
                <span className="size-1 rounded-full bg-live/60" />
                <span>Current Context</span>
              </span>
            </ContextStrip>

            <div className="mt-5">
              <SectionHeading
                eyebrow="Command center"
                title="Your workspaces"
                description="Speak first, or move directly to the surface you need."
              />
              <div className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-surface/75">
                {workspaces.map(({ to, label, detail, icon: Icon, primary }, index) => (
                  <Link
                    key={to}
                    to={to}
                    className={`emery-dashboard-link emery-press flex min-h-[64px] items-center gap-3 px-3.5 py-2.5 focus-visible:z-10 ${index ? "border-t border-border/45" : ""}`}
                  >
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-md border ${primary ? "border-live/25 bg-live/10 text-live" : "border-primary/15 bg-primary/[0.06] text-primary"}`}
                    >
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">{label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {detail}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <aside className="min-w-0 space-y-3 xl:sticky xl:top-0 xl:self-start">
            <p className="emery-kicker px-1">Current Context</p>
            <OperatingContextCard />
            <CommandPanel variant="glass" active={voiceState !== "idle"} className="px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-live">
                One Emery
              </p>
              <p className="mt-2 text-sm leading-6 text-secondary-foreground">
                Voice and typed Chat share the same context, memory, tools, and actions. Dashboard
                voice stays out of Chat history.
              </p>
            </CommandPanel>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
