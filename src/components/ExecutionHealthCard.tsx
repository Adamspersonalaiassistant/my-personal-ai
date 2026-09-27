import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  ShieldCheck,
} from "lucide-react";
import { getExecutionHealth } from "@/lib/execution.functions";

type ExecutionRun = {
  id: string;
  domain: string;
  action: string;
  status: string;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
};

export function ExecutionHealthCard() {
  const loadHealth = useServerFn(getExecutionHealth);
  const [data, setData] = useState<{
    counts: { completed: number; failed: number; clarification: number; running: number };
    recent: ExecutionRun[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadHealth({})
      .then((result) => {
        if (!cancelled) setData(result as any);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadHealth]);

  const counts = data?.counts ?? { completed: 0, failed: 0, clarification: 0, running: 0 };

  return (
    <section className="emery-glass overflow-hidden rounded-[1.55rem] border border-primary/12">
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.08] text-primary">
          <ShieldCheck className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Execution health</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Migrated structured actions record verified execution receipts here. Coverage is still being expanded.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 border-y border-border/30">
        <Metric label="Done" value={counts.completed} />
        <Metric label="Failed" value={counts.failed} />
        <Metric label="Needs you" value={counts.clarification} />
        <Metric label="Running" value={counts.running} />
      </div>

      {data?.recent?.length ? (
        <div className="divide-y divide-border/25">
          {data.recent.slice(0, 5).map((run) => (
            <div key={run.id} className="flex items-center gap-3 px-4 py-3">
              <StatusIcon status={run.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold capitalize">
                  {run.action.replaceAll("_", " ")}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {run.domain} · {run.status.replaceAll("_", " ")}
                  {run.error_code ? ` · ${run.error_code}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-[9px] text-muted-foreground">
                {new Date(run.created_at).toLocaleString([], {
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 pb-4 text-xs text-muted-foreground">
          No retained production receipts yet. The execution architecture is built and still being proven through real use.
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-2 py-3 text-center">
      <p className="text-sm font-semibold">{value}</p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed")
    return <CheckCircle2 className="size-4 shrink-0 text-primary" />;
  if (status === "failed")
    return <AlertTriangle className="size-4 shrink-0 text-destructive" />;
  if (status === "needs_clarification")
    return <HelpCircle className="size-4 shrink-0 text-amber-400" />;
  return <Clock3 className="size-4 shrink-0 text-muted-foreground" />;
}
