import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  CalendarClock,
  History,
  MapPin,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import { getHpoAccountFieldContext } from "@/lib/hpo-field.functions";

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function HpoAccountFieldDetail({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const load = useServerFn(getHpoAccountFieldContext);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load({ data: { accountId } })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Couldn't load this account.");
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, load]);

  const account = data?.account;
  const contacts = data?.contacts ?? [];
  const interactions = data?.interactions ?? [];
  const routeStops = data?.routeStops ?? [];
  const primary = contacts.find((contact: any) => contact.is_primary) ?? contacts[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-[82] flex items-end bg-background/68 backdrop-blur-[4px] sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="emery-sheet-in max-h-[90dvh] w-full overflow-y-auto rounded-t-[1.8rem] border-t border-border/55 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_70px_rgba(0,0,0,0.42)] sm:max-w-xl sm:rounded-[1.8rem] sm:border"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="HPO account field record"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-border/80 sm:hidden" />
        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 bg-background/95 px-1 pb-3 pt-3 backdrop-blur">
          <div className="min-w-0">
            <p className="emery-kicker">Field Account</p>
            <h2 className="mt-1 truncate text-lg font-semibold">{account?.name ?? "Loading account…"}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="emery-press flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground"
            aria-label="Close account"
          >
            <X className="size-4" />
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            {error}
          </div>
        ) : !account ? (
          <div className="py-14 text-center text-sm text-muted-foreground">Loading relationship context…</div>
        ) : (
          <div className="space-y-3 pb-2">
            <section className="emery-glass rounded-[1.45rem] p-4">
              <div className="flex items-start gap-3">
                <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-xl text-primary">
                  <MapPin className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{account.name}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {[account.address, account.city].filter(Boolean).join(", ") || "Address not saved"}
                  </p>
                  <p className="mt-1 text-[10px] text-primary">
                    {[account.account_type, account.specialty, account.owner_name ? `Owner: ${account.owner_name}` : null]
                      .filter(Boolean)
                      .join(" · ") || "HPO relationship account"}
                  </p>
                </div>
                <span className="emery-chip shrink-0">P{account.priority}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="emery-surface rounded-xl p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Last touch</p>
                  <p className="mt-1 text-xs font-semibold">{dateLabel(account.last_touch_at)}</p>
                </div>
                <div className="emery-surface rounded-xl p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Status</p>
                  <p className="mt-1 text-xs font-semibold capitalize">
                    {account.relationship_stage || account.status || "active"}
                  </p>
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-primary/15 bg-primary/[0.035] p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Next relationship action
                </p>
                <p className="mt-1 text-xs font-medium">{account.next_action || "No next action saved"}</p>
                {account.next_action_due_at ? (
                  <p className="mt-1 text-[10px] text-primary">Due {dateLabel(account.next_action_due_at)}</p>
                ) : null}
              </div>
            </section>

            {primary || contacts.length ? (
              <section className="emery-glass rounded-[1.45rem] p-4">
                <div className="flex items-center gap-2">
                  <UserRound className="size-4 text-primary" />
                  <p className="text-sm font-semibold">Contacts</p>
                </div>
                <div className="mt-3 space-y-2">
                  {contacts.slice(0, 8).map((contact: any) => (
                    <div key={contact.id} className="emery-surface rounded-xl p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{contact.name}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {contact.role_title || "Contact"}
                            {contact.is_primary ? " · Primary" : ""}
                          </p>
                        </div>
                        {contact.phone ? (
                          <a
                            href={`tel:${contact.phone}`}
                            className="emery-press flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 text-primary"
                            aria-label={`Call ${contact.name}`}
                          >
                            <Phone className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                      {contact.relationship_notes ? (
                        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                          {contact.relationship_notes}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="emery-glass rounded-[1.45rem] p-4">
              <div className="flex items-center gap-2">
                <History className="size-4 text-primary" />
                <p className="text-sm font-semibold">Relationship history</p>
              </div>
              {interactions.length ? (
                <div className="mt-3 space-y-2">
                  {interactions.slice(0, 10).map((interaction: any) => (
                    <div key={interaction.id} className="emery-surface rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold capitalize text-primary">
                          {interaction.interaction_type || "interaction"}
                        </p>
                        <span className="text-[9px] text-muted-foreground">
                          {dateLabel(interaction.occurred_at)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5">{interaction.summary}</p>
                      {interaction.outcome ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">{interaction.outcome}</p>
                      ) : null}
                      {interaction.next_action ? (
                        <p className="mt-1.5 text-[10px] font-medium text-primary">
                          Next: {interaction.next_action}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No interactions recorded yet.</p>
              )}
            </section>

            <section className="emery-glass rounded-[1.45rem] p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 text-primary" />
                <p className="text-sm font-semibold">Route visit history</p>
              </div>
              {routeStops.length ? (
                <div className="mt-3 space-y-2">
                  {routeStops.slice(0, 8).map((stop: any) => (
                    <div key={stop.id} className="emery-surface rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold capitalize text-primary">
                          {String(stop.status).replaceAll("_", " ")}
                        </p>
                        <span className="text-[9px] text-muted-foreground">{dateLabel(stop.visited_at || stop.updated_at)}</span>
                      </div>
                      {stop.visit_summary ? (
                        <p className="mt-1.5 text-xs leading-5">{stop.visit_summary}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No prior route visits recorded.</p>
              )}
            </section>

            {account.address ? (
              <a
                href={`https://maps.apple.com/?q=${encodeURIComponent(
                  [account.name, account.address, account.city].filter(Boolean).join(", "),
                )}`}
                target="_blank"
                rel="noreferrer"
                className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                <ArrowUpRight className="size-4" /> Open in Maps
              </a>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
