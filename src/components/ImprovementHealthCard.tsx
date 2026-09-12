/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
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
      setError(
        cause instanceof Error ? cause.message : "Could not load Emery's improvement system.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const recentOpen = useMemo(
    () =>
      (data?.backlog ?? [])
        .filter((item: any) => ["observed", "proposed", "testing"].includes(item.status))
        .slice(0, 3),
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
      <div className="flex items-start justify-between gap-3 border-b border-border/40 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 gap-3">
          <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-2xl">
            <BrainCircuit className="size-[18px]" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <p className="emery-kicker">How Emery gets better</p>
            <h3 className="mt-1 text-base font-semibold tracking-tight">
              Improvement & system health
            </h3>
            <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
              Emery watches for repeated friction, tests low-risk improvements, and keeps only
              changes that pass her safeguards.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh Emery improvement health"
          className="emery-press flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/50 bg-card/38 text-muted-foreground hover:text-primary"
        >
          <RefreshCcw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Checking Emery's improvement loop…
        </div>
      ) : error ? (
        <div className="flex gap-3 px-5 py-5 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <HealthStat
              label="Watching"
              value={String(data?.health?.openItems ?? 0)}
              icon={Activity}
            />
            <HealthStat
              label="Needs attention"
              value={String(data?.health?.highSeverity ?? 0)}
              icon={AlertTriangle}
            />
            <HealthStat
              label="Improvements kept"
              value={String(data?.health?.acceptedChanges ?? 0)}
              icon={CheckCircle2}
            />
            <HealthStat
              label="Reverted"
              value={String(data?.health?.rolledBackChanges ?? 0)}
              icon={RotateCcw}
            />
          </div>

          <div className="rounded-2xl border border-primary/12 bg-primary/[0.028] p-3.5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-xs font-semibold">Safe by design</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Emery can refine low-risk response, routing, and memory behavior after validation.
                  She cannot spend money, change security, delete your data, message outsiders, or
                  expand agent authority on her own.
                </p>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">What Emery is improving</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Only repeated or meaningful friction belongs here.
                </p>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {data?.backlog?.length ?? 0} tracked
              </span>
            </div>
            {recentOpen.length ? (
              <div className="space-y-2">
                {recentOpen.map((item: any) => (
                  <div key={item.id} className="emery-surface rounded-2xl p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{item.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {item.problem_statement}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-border/45 bg-card/35 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Priority {item.severity}
                      </span>
                    </div>
                    {item.occurrence_count > 1 ? (
                      <p className="mt-2 text-[10px] text-muted-foreground/75">
                        Seen {item.occurrence_count} times
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="emery-surface rounded-2xl px-4 py-6 text-center">
                <Sparkles className="mx-auto size-4 text-primary" />
                <p className="mt-2 text-sm font-semibold">
                  Nothing important needs fixing right now
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  Emery keeps this list selective instead of treating every imperfect answer like a
                  project.
                </p>
              </div>
            )}
          </div>

          {recentChanges.length ? (
            <div>
              <p className="mb-2.5 text-sm font-semibold">Recent improvements</p>
              <div className="space-y-2">
                {recentChanges.map((change: any) => (
                  <div
                    key={change.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/42 bg-card/38 px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{humanize(change.scope)}</p>
                      <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
                        {change.status.replaceAll("_", " ")}
                      </p>
                    </div>
                    {change.status === "accepted" && change.change_type === "safe_config" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 shrink-0 rounded-xl"
                        disabled={rollingBack === change.id}
                        onClick={() => void rollback(change.id)}
                      >
                        <RotateCcw className="mr-1.5 size-3.5" />
                        {rollingBack === change.id ? "Reverting" : "Revert"}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(data?.agents ?? []).length ? (
            <div>
              <div className="mb-2.5">
                <p className="text-sm font-semibold">Agent health</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  A simple signal for how Emery's specialist team is performing.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.agents.slice(0, 4).map((agent: any) => (
                  <div key={agent.slug} className="emery-surface rounded-2xl px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium capitalize">
                        {humanize(agent.slug)}
                      </p>
                      {agent.successRate == null ? null : (
                        <span className="text-xs font-semibold text-primary">
                          {Math.round(agent.successRate * 100)}%
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {agent.calls} uses{agent.webCalls ? ` · ${agent.webCalls} researched` : ""}
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

function humanize(value: string) {
  return value.replaceAll("-", " ").replaceAll("_", " ");
}

function HealthStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
}) {
  return (
    <div className="emery-surface rounded-2xl p-3 text-center">
      <Icon className="mx-auto size-4 text-primary" />
      <p className="mt-1.5 text-base font-semibold">{value}</p>
      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
