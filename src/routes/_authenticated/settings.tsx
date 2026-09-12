import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  CheckSquare,
  Database,
  FileUp,
  Mic2,
  Radio,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

const status = [
  { label: "AI Brain", value: "Connected", icon: Brain, live: true },
  { label: "Memory", value: "Online", icon: Database, live: true },
  { label: "Action layer", value: "Connected", icon: CheckSquare, live: true },
  { label: "Agent Team", value: "Connected", icon: UsersRound, live: true },
  { label: "File uploads", value: "Connected", icon: FileUp, live: true },
  { label: "Meetings", value: "Internal", icon: Radio, live: true },
  { label: "Emery Voice", value: "Next", icon: Mic2, live: false },
  { label: "Automations", value: "Planned", icon: Workflow, live: false },
] as const;

function Settings() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase?.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <AppShell title="System">
      <div className="space-y-4">
        <section className="emery-glass rounded-3xl p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.07] text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Private system
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Adam + Emery</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
        </section>

        <section className="emery-glass overflow-hidden rounded-3xl">
          <div className="border-b border-border/50 px-4 py-3.5">
            <p className="text-sm font-semibold">Emery System</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What is active now and what we’re building next.
            </p>
          </div>
          {status.map((row, i) => {
            const Icon = row.icon;
            return (
              <div
                key={row.label}
                className={`flex min-h-16 items-center justify-between gap-4 px-4 py-3 ${
                  i > 0 ? "border-t border-border/45" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card/60 text-muted-foreground">
                    <Icon className="size-[18px]" />
                  </div>
                  <span className="text-sm font-medium">{row.label}</span>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    row.live
                      ? "border-primary/20 bg-primary/[0.08] text-primary"
                      : "border-border/60 bg-card/60 text-muted-foreground"
                  }`}
                >
                  {row.value}
                </span>
              </div>
            );
          })}
        </section>

        <Link
          to="/memories"
          className="flex min-h-16 items-center justify-between rounded-3xl border border-border/60 bg-card/55 px-4 py-3 transition hover:border-primary/25"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.05] text-primary">
              <Database className="size-[18px]" />
            </div>
            <div>
              <p className="text-sm font-semibold">About Adam / Memories</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Review what Emery has learned and saved.</p>
            </div>
          </div>
          <span className="text-xs font-semibold text-primary">Open</span>
        </Link>

        <section className="rounded-3xl border border-primary/15 bg-primary/[0.045] p-4">
          <p className="text-sm font-semibold">Next milestone</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Emery Voice — a natural, low-friction voice layer on top of the same memory, agents,
            action system, files and main conversation working now.
          </p>
        </section>

        <Button
          variant="outline"
          className="h-12 w-full rounded-2xl border-destructive/20 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    </AppShell>
  );
}
