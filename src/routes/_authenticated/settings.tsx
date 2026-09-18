import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Brain,
  CheckSquare,
  ChevronRight,
  Database,
  FileUp,
  Mic2,
  Radio,
  Smartphone,
  Sparkles,
  UsersRound,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ImprovementHealthCard } from "@/components/ImprovementHealthCard";
import { RecentFilesCard } from "@/components/RecentFilesCard";
import { Button } from "@/components/ui/button";
import { listMemories } from "@/lib/chat.functions";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/settings")({ component: Settings });

const capabilities = [
  { label: "AI brain", value: "Connected", icon: Brain, live: true },
  { label: "Memory", value: "Online", icon: Database, live: true },
  { label: "Action layer", value: "Connected", icon: CheckSquare, live: true },
  { label: "Agent team", value: "Connected", icon: UsersRound, live: true },
  { label: "File uploads", value: "Connected", icon: FileUp, live: true },
  { label: "Shortcut bridge", value: "Ready", icon: Smartphone, live: true },
  { label: "Meetings", value: "Internal only", icon: Radio, live: true },
  { label: "Emery Voice", value: "Next", icon: Mic2, live: false },
  { label: "Automations", value: "Planned", icon: Workflow, live: false },
] as const;

const categoryMap: Record<string, string> = {
  goal: "Goals",
  preference: "Preferences",
  relationship: "Relationships",
  responsibility: "Responsibilities",
  routine: "Routines",
  project_context: "Projects",
  working_preference: "Working style",
  decision: "Decisions",
  constraint: "Constraints",
  core: "Core",
};

function Settings() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadMemories = useServerFn(listMemories);
  const [memorySummary, setMemorySummary] = useState({ total: 0, areas: 0, important: 0 });

  useEffect(() => {
    let cancelled = false;
    void loadMemories({})
      .then((result) => {
        if (cancelled || result.error) return;
        const memories = result.memories ?? [];
        const areas = new Set(memories.map((memory) => categoryMap[memory.memory_type] ?? "Core"));
        setMemorySummary({
          total: memories.length,
          areas: areas.size,
          important: memories.filter((memory) => memory.importance >= 4).length,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadMemories]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase?.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  const memoryLine = useMemo(() => {
    if (!memorySummary.total) return "Review what Emery carries forward about you.";
    return `${memorySummary.total} memories · ${memorySummary.areas} life areas`;
  }, [memorySummary]);

  return (
    <AppShell title="Settings">
      <div className="mx-auto max-w-3xl space-y-5 pb-4">
        <div>
          <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Emery, your phone, your data, and connected capabilities.
          </p>
        </div>

        <SettingsGroup title="Account">
          <div className="flex min-h-[64px] items-center gap-3 px-3.5 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.055] text-sm font-semibold text-primary">
              A
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Adam Ashraf</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup title="iPhone">
          <Link
            to="/iphone"
            className="emery-press flex min-h-[68px] items-center gap-3 px-3.5 py-3 hover:bg-white/[0.025]"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.055] text-primary">
              <Smartphone className="size-[17px]" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">iPhone & Shortcuts</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                One Emery Shortcut · dictated and typed capture ready
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </SettingsGroup>

        <SettingsGroup title="Personal context">
          <Link
            to="/memories"
            className="emery-press flex min-h-[64px] items-center gap-3 px-3.5 py-3 hover:bg-white/[0.025]"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.055] text-primary">
              <Database className="size-[17px]" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Memories & profile</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{memoryLine}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </SettingsGroup>

        <div className="space-y-3">
          <RecentFilesCard />
          <ImprovementHealthCard />
        </div>

        <SettingsGroup title="Capabilities">
          {capabilities.map((item, index) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className={`flex min-h-[58px] items-center gap-3 px-3.5 py-2.5 ${index ? "border-t border-border/30" : ""}`}
              >
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${item.live ? "bg-primary/[0.055] text-primary" : "bg-white/[0.025] text-muted-foreground"}`}
                >
                  <Icon className="size-[15px]" strokeWidth={1.8} />
                </div>
                <p className="min-w-0 flex-1 text-sm font-medium">{item.label}</p>
                <span
                  className={`text-[11px] font-medium ${item.live ? "text-primary/85" : "text-muted-foreground"}`}
                >
                  {item.value}
                </span>
              </div>
            );
          })}
        </SettingsGroup>

        <section className="flex items-start gap-3 rounded-xl border border-primary/12 bg-primary/[0.03] px-3.5 py-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Next: Emery Voice</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              The app, memory, action system and one-Emery phone bridge are the foundation Voice will use.
            </p>
          </div>
        </section>

        <Button
          variant="outline"
          className="h-11 w-full rounded-xl border-destructive/18 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    </AppShell>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </p>
      <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">{children}</div>
    </section>
  );
}
