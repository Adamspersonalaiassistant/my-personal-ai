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
  ShieldCheck,
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

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

const status = [
  { label: "AI Brain", value: "Connected", icon: Brain, live: true },
  { label: "Memory", value: "Online", icon: Database, live: true },
  { label: "Action layer", value: "Connected", icon: CheckSquare, live: true },
  { label: "Agent Team", value: "Connected", icon: UsersRound, live: true },
  { label: "Self-improvement", value: "Bounded", icon: Sparkles, live: true },
  { label: "File uploads", value: "Connected", icon: FileUp, live: true },
  { label: "Meetings", value: "Internal", icon: Radio, live: true },
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

  const activeCount = status.filter((item) => item.live).length;
  const memoryLine = useMemo(() => {
    if (!memorySummary.total) return "Review what Emery carries forward about you.";
    return `${memorySummary.total} durable memories across ${memorySummary.areas} life areas${memorySummary.important ? ` · ${memorySummary.important} high priority` : ""}.`;
  }, [memorySummary]);

  return (
    <AppShell title="System">
      <div className="space-y-4">
        <section className="emery-glass-strong overflow-hidden rounded-[1.7rem] p-5">
          <div className="flex items-start gap-4">
            <div className="emery-icon-well flex size-13 shrink-0 items-center justify-center rounded-[1.15rem]">
              <ShieldCheck className="size-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="emery-kicker">Private system</p>
                  <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">Adam + Emery</h2>
                </div>
                <span className="emery-chip">
                  <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_oklch(0.805_0.175_155/0.7)]" />
                  {activeCount} systems live
                </span>
              </div>
              <p className="mt-2 truncate text-xs text-muted-foreground">{user?.email}</p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                One private operating system for conversation, memory, execution, specialist
                intelligence and bounded self-improvement.
              </p>
            </div>
          </div>
        </section>

        <Link
          to="/memories"
          className="emery-press emery-glass group block rounded-[1.55rem] p-4 hover:border-primary/25"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-2xl">
                <Database className="size-[18px]" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">About Adam / Memories</p>
                  <span className="emery-chip">Selective</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{memoryLine}</p>
              </div>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
          {memorySummary.total ? (
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/40 pt-3">
              <MiniStat label="Memories" value={String(memorySummary.total)} />
              <MiniStat label="Life areas" value={String(memorySummary.areas)} />
              <MiniStat label="Important" value={String(memorySummary.important)} />
            </div>
          ) : null}
        </Link>

        <ImprovementHealthCard />

        <RecentFilesCard />

        <section className="emery-glass overflow-hidden rounded-[1.7rem]">
          <div className="flex items-end justify-between gap-3 border-b border-border/45 px-4 py-4 sm:px-5">
            <div>
              <p className="emery-kicker">System health</p>
              <h3 className="mt-1 text-base font-semibold tracking-tight">Emery stack</h3>
            </div>
            <span className="text-[11px] font-medium text-muted-foreground">Live status</span>
          </div>

          <div className="grid sm:grid-cols-2">
            {status.map((row, i) => {
              const Icon = row.icon;
              return (
                <div
                  key={row.label}
                  className={`flex min-h-[74px] items-center justify-between gap-3 px-4 py-3.5 sm:px-5 ${i > 0 ? "border-t border-border/35 sm:border-t-0" : ""} ${i >= 2 ? "sm:border-t sm:border-border/35" : ""} ${i % 2 === 1 ? "sm:border-l sm:border-border/35" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-2xl border ${row.live ? "border-primary/15 bg-primary/[0.055] text-primary" : "border-border/55 bg-card/55 text-muted-foreground"}`}
                    >
                      <Icon className="size-[17px]" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.label}</p>
                      <p
                        className={`mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${row.live ? "text-primary/85" : "text-muted-foreground"}`}
                      >
                        {row.value}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`size-2 rounded-full ${row.live ? "bg-primary shadow-[0_0_8px_oklch(0.805_0.175_155/0.55)]" : "bg-muted-foreground/30"}`}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-[1.55rem] border border-primary/14 bg-primary/[0.038] p-4">
          <div className="flex gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Next milestone: Emery Voice</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Voice stays intentionally untouched until Adam designs the live experience with
                Emery. The same memory, agents, action and improvement systems will sit underneath
                it.
              </p>
            </div>
          </div>
        </section>

        <Button
          variant="outline"
          className="h-12 w-full rounded-2xl border-destructive/18 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    </AppShell>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/45 bg-card/45 px-3 py-2.5 text-center">
      <p className="text-sm font-semibold">{value}</p>
      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
