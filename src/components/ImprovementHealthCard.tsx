import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getImprovementDashboard, rollbackImprovementChange } from "@/lib/improvement.functions";

type Dashboard = Awaited<ReturnType<ReturnType<typeof useServerFn<typeof getImprovementDashboard>>>>;

export function ImprovementHealthCard() {
  const loadDashboard = useServerFn(getImprovementDashboard);
  const rollbackChange = useServerFn(rollbackImprovementChange);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const result = await loadDashboard({});
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Emery's improvement system.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const recentOpen = useMemo(
    () => (data?.backlog ?? []).filter((item: any) => ["observed", "proposed", "testing"].includes(item.status)).slice(0, 3),
    [data],
  );
  const recentChanges = useMemo(() => (data?.changes ?? []).slice(0, 3), [data]);

  async function rollback(id: string) {
    setRollingBack(id);
    try {
      await rollbackChange({ data: { id } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rollback failed.");
    } finally {
      setRollingBack(null);
    }
  }

  return (
    <section className="emery-glass overflow-hidden rounded-[1.7rem]">
      <div className="flex items-start justify-between gap-3 border-b border-border/45 px-4 py-4 sm:px-5">
        <div className="flex gap-3">
          <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <BrainCircuit className="size-[18px]" strokeWidth={1.8} />
          </div>
          <div>
            <p className="emery-kicker">Self-improvement</p>
            <h3 className="mt-1 text-base font-semibold tracking-tight">System Health</h3>
            <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
              Emery can observe recurring friction, keep an improvement backlog and apply only validated, reversible low-risk configuration changes.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh system health"
          className="emery-press flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/55 bg-card/45 text-muted-foreground hover:text-primary"
        >
          <RefreshCcw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">Checking Emery's improvement loop…</div>
      ) : error ? (
        <div className="flex gap-3 px-5 py-5 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <HealthStat label="Open" value={String(data?.health?.openItems ?? 0)} icon={Activity} />
            <HealthStat label="High priority" value={String(data?.health?.highSeverity ?? 0)} icon={AlertTriangle} />
            <HealthStat label="Accepted" value={String(data?.health?.acceptedChanges ?? 0)} icon={CheckCircle2} />
            <HealthStat label="Rollbacks" value={String(data?.health?.rolledBackChanges ?? 0)} icon={RotateCcw} />
          </div>

          <div className="rounded-2xl border border-primary/14 bg-primary/[0.035] p-3.5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-xs font-semibold">Bounded autonomy</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Emery may tune allowlisted response, routing and memory-budget settings only after validation. She cannot change billing, secrets, authentication, RLS, delete data, message outsiders, run arbitrary SQL or expand agent authority.
                </p>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Improvement backlog</p>
              <span className="emery-chip">{data?.backlog?.length ?? 0} tracked</span>
            </div>
            {recentOpen.length ? (
              <div className="space-y-2">
                {recentOpen.map((item: any) => (
                  <div key={item.id} className="emery-surface rounded-2xl p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.problem_statement}</p>
                      </div>
                      <span className="emery-chip shrink-0">S{item.severity} · {item.occurrence_count}×</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="emery-surface rounded-2xl px-4 py-5 text-center">
                <Sparkles className="mx-auto size-4 text-primary" />
                <p className="mt-2 text-sm font-semibold">No material issues queued</p>
                <p className="mt-1 text-xs text-muted-foreground">Emery will keep this list selective instead of turning every imperfect answer into noise.</p>
              </div>
            )}
          </div>

          {recentChanges.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recent changes</p>
              <div className="space-y-2">
                {recentChanges.map((change: any) => (
                  <div key={change.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/45 bg-card/45 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{change.scope}</p>
                      <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">{change.status.replaceAll("_", " ")}</p>
                    </div>
                    {change.status === "accepted" && change.change_type === "safe_config" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-xl"
                        disabled={rollingBack === change.id}
                        onClick={() => void rollback(change.id)}
                      >
                        <RotateCcw className="mr-1.5 size-3.5" />
                        {rollingBack === change.id ? "Rolling back" : "Rollback"}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(data?.agents ?? []).length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent performance</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.agents.slice(0, 4).map((agent: any) => (
                  <div key={agent.slug} className="emery-surface rounded-2xl px-3.5 py-3">
                    <p className="text-sm font-medium">{agent.slug.replaceAll("-", " ")}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {agent.calls} calls{agent.successRate == null ? "" : ` · ${Math.round(agent.successRate * 100)}% successful`}{agent.webCalls ? ` · ${agent.webCalls} web` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function HealthStat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
  return (
    <div className="emery-surface rounded-2xl p-3 text-center">
      <Icon className="mx-auto size-4 text-primary" />
      <p className="mt-1.5 text-base font-semibold">{value}</p>
      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
    </div>
  );
}
