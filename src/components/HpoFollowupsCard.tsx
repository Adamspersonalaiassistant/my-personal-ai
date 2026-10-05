import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, CalendarDays, Check, ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  completeHpoFollowup,
  listHpoFollowups,
  setHpoFollowupDate,
  type HpoFollowupGroup,
  type HpoFollowupList,
} from "@/lib/hpo-followups.functions";

const GROUPS: { key: HpoFollowupGroup; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "no_date", label: "No date" },
];

function dueLabel(key: string | null) {
  if (!key) return "No date";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function HpoFollowupsCard({
  refreshKey = 0,
  onOpenAccount,
}: {
  refreshKey?: number;
  onOpenAccount: (accountId: string) => void;
}) {
  const load = useServerFn(listHpoFollowups);
  const complete = useServerFn(completeHpoFollowup);
  const setDate = useServerFn(setHpoFollowupDate);
  const [data, setData] = useState<HpoFollowupList | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [datingId, setDatingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = (await load()) as HpoFollowupList;
      setData(result);
      setOpen((current) => (current === null ? result.items.length > 0 : current));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load follow ups.");
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  async function markDone(accountId: string) {
    if (busyId) return;
    setBusyId(accountId);
    try {
      await complete({ data: { accountId, idempotencyKey: `planner:${crypto.randomUUID()}:hpo.followup.complete` } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't complete that follow up.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveDate(accountId: string, date: string) {
    if (!date) return;
    setBusyId(accountId);
    try {
      await setDate({ data: { accountId, date } });
      setDatingId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't set that date.");
    } finally {
      setBusyId(null);
    }
  }

  const total = data?.items.length ?? 0;
  const overdue = data?.counts.overdue ?? 0;

  return (
    <section className="min-w-0 rounded-lg border border-live/15 bg-surface/90 p-3 shadow-sm">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={Boolean(open)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <BellRing className="size-4 shrink-0 text-live" />
          <span className="text-sm font-semibold">Follow ups</span>
          <span className="truncate text-xs text-muted-foreground">
            {data ? `${total} open${overdue ? `, ${overdue} overdue` : ""}` : "Loading"}
          </span>
        </span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      {open && data ? (
        total === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No open follow ups. Nice work.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {GROUPS.map((group) => {
              const rows = data.items.filter((item) => item.group === group.key);
              if (!rows.length) return null;
              return (
                <div key={group.key} className="min-w-0">
                  <p
                    className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${
                      group.key === "overdue" ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {group.label} ({rows.length})
                  </p>
                  <ul className="space-y-2">
                    {rows.map((item) => (
                      <li key={item.accountId} className="min-w-0 rounded-md border border-border/60 bg-background/40 p-2.5">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium">{item.name}</p>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{dueLabel(item.dueDate)}</span>
                        </div>
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">{item.nextAction}</p>
                        {datingId === item.accountId ? (
                          <div className="mt-2 flex min-w-0 gap-2">
                            <input
                              type="date"
                              defaultValue={item.dueDate ?? data.today}
                              className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base"
                              onChange={(event) => void saveDate(item.accountId, event.target.value)}
                              aria-label={`Follow up date for ${item.name}`}
                            />
                            <Button type="button" variant="ghost" className="min-h-11 shrink-0 px-3 text-xs" onClick={() => setDatingId(null)}>
                              Close
                            </Button>
                          </div>
                        ) : (
                          <div className="mt-2 grid grid-cols-3 gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11 gap-1 px-1 text-xs"
                              disabled={busyId === item.accountId}
                              onClick={() => void markDone(item.accountId)}
                            >
                              <Check className="size-4" /> Done
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11 gap-1 px-1 text-xs"
                              disabled={busyId === item.accountId}
                              onClick={() => setDatingId(item.accountId)}
                            >
                              <CalendarDays className="size-4" /> Set date
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11 gap-1 px-1 text-xs"
                              onClick={() => onOpenAccount(item.accountId)}
                            >
                              <ExternalLink className="size-4" /> Open
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </section>
  );
}
