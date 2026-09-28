import { useEffect, useState } from "react";
/* eslint-disable @typescript-eslint/no-explicit-any -- Existing field-context payloads include dynamic account metadata. */
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  CalendarClock,
  History,
  MapPin,
  Phone,
  UserRound,
  X,
  Pencil,
} from "lucide-react";
import { getHpoAccountFieldContext } from "@/lib/hpo-field.functions";
import { updateHpoFieldAccount } from "@/lib/hpo-workspace.functions";
import { Button } from "@/components/ui/button";

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function HpoAccountFieldDetail({
  accountId,
  onClose,
  onChanged,
  onLog,
  onFollowup,
}: {
  accountId: string;
  onClose: () => void;
  onChanged?: () => void;
  onLog?: () => void;
  onFollowup?: () => void;
}) {
  const load = useServerFn(getHpoAccountFieldContext);
  const update = useServerFn(updateHpoFieldAccount);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load({ data: { accountId } })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Couldn't load this account.");
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
        className="emery-sheet-in max-h-[92dvh] w-full overflow-y-auto rounded-t-lg border-t border-border/55 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_70px_rgba(0,0,0,0.42)] sm:max-w-xl sm:rounded-lg sm:border"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="HPO account field record"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-border/80 sm:hidden" />
        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-3 bg-background/95 px-1 pb-3 pt-3 backdrop-blur">
          <div className="min-w-0">
            <p className="emery-kicker">Field Account</p>
            <h2 className="mt-1 break-words text-lg font-semibold">
              {account?.name ?? "Loading account…"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="emery-press flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground"
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
          <div className="py-14 text-center text-sm text-muted-foreground">
            Loading relationship context…
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            <div className="grid grid-cols-3 gap-2">
              {onLog && (
                <Button className="min-h-11 px-2 text-xs" onClick={onLog}>
                  Log visit
                </Button>
              )}
              {onFollowup && (
                <Button variant="outline" className="min-h-11 px-2 text-xs" onClick={onFollowup}>
                  Follow-up
                </Button>
              )}
              <Button
                variant="outline"
                className="min-h-11 px-2 text-xs"
                onClick={() => setEditing((value) => !value)}
              >
                <Pencil className="size-4" /> Edit
              </Button>
            </div>
            {editing && (
              <form
                className="space-y-2 border-y border-border/60 py-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  setSaving(true);
                  setEditError("");
                  try {
                    await update({
                      data: {
                        accountId,
                        name: String(form.get("name") || ""),
                        accountType: String(form.get("type") || "") || null,
                        specialty: String(form.get("specialty") || "") || null,
                        city: String(form.get("city") || "") || null,
                        territory: String(form.get("territory") || "") || null,
                        address: String(form.get("address") || "") || null,
                        priority: Number(form.get("priority")),
                        relationshipStage: String(form.get("stage") || "prospect"),
                        relationshipHealth: String(form.get("health") || "") || null,
                        opportunity: String(form.get("opportunity") || "") || null,
                        blockers: String(form.get("blockers") || "") || null,
                        notes: String(form.get("notes") || "") || null,
                      },
                    });
                    setData(await load({ data: { accountId } }));
                    setEditing(false);
                    onChanged?.();
                  } catch (cause) {
                    setEditError(
                      cause instanceof Error ? cause.message : "Could not save account.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {(
                  [
                    ["name", "Office name", account.name],
                    ["type", "Type", account.account_type],
                    ["specialty", "Specialty", account.specialty],
                    ["address", "Address", account.address],
                    ["city", "City", account.city],
                    ["territory", "Territory", account.territory],
                    ["priority", "Priority (1–5)", account.priority],
                    ["stage", "Relationship stage", account.relationship_stage],
                    ["health", "Relationship health", account.relationship_health],
                    ["opportunity", "Opportunity", account.opportunity],
                    ["blockers", "Blockers", account.blockers],
                  ] as const
                ).map(([key, label, value]) => (
                  <label key={key} className="block text-xs text-muted-foreground">
                    {label}
                    <input
                      name={key}
                      type={key === "priority" ? "number" : "text"}
                      min={key === "priority" ? 1 : undefined}
                      max={key === "priority" ? 5 : undefined}
                      required={key === "name"}
                      defaultValue={value ?? ""}
                      className="mt-1 min-h-11 w-full rounded-md border border-border bg-card px-3 text-base text-foreground"
                    />
                  </label>
                ))}
                <label className="block text-xs text-muted-foreground">
                  Notes
                  <textarea
                    name="notes"
                    defaultValue={account.notes ?? ""}
                    className="mt-1 min-h-24 w-full rounded-md border border-border bg-card p-3 text-base text-foreground"
                  />
                </label>
                {editError && (
                  <p role="alert" className="text-sm text-destructive">
                    {editError}
                  </p>
                )}
                <Button disabled={saving} className="min-h-12 w-full">
                  {saving ? "Saving…" : "Save account"}
                </Button>
              </form>
            )}
            {(account.relationship_health ||
              account.opportunity ||
              account.blockers ||
              account.notes) && (
              <div className="space-y-1 border-y border-border/50 py-3 text-xs leading-5">
                {account.relationship_health && (
                  <p>
                    <strong>Relationship:</strong> {account.relationship_health}
                  </p>
                )}
                {account.opportunity && (
                  <p>
                    <strong>Opportunity:</strong> {account.opportunity}
                  </p>
                )}
                {account.blockers && (
                  <p>
                    <strong>Blockers:</strong> {account.blockers}
                  </p>
                )}
                {account.notes && (
                  <p className="whitespace-pre-wrap break-words">{account.notes}</p>
                )}
              </div>
            )}
            <section className="border-b border-border/50 pb-3">
              <div className="flex items-start gap-3">
                <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-xl text-primary">
                  <MapPin className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{account.name}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {[account.address, account.city].filter(Boolean).join(", ") ||
                      "Address not saved"}
                  </p>
                  <p className="mt-1 text-[10px] text-primary">
                    {[
                      account.account_type,
                      account.specialty,
                      account.owner_name ? `Owner: ${account.owner_name}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "HPO relationship account"}
                  </p>
                </div>
                <span className="emery-chip shrink-0">P{account.priority}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="emery-surface rounded-xl p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    Last touch
                  </p>
                  <p className="mt-1 text-xs font-semibold">{dateLabel(account.last_touch_at)}</p>
                </div>
                <div className="emery-surface rounded-xl p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    Status
                  </p>
                  <p className="mt-1 text-xs font-semibold capitalize">
                    {account.relationship_stage || account.status || "active"}
                  </p>
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-primary/15 bg-primary/[0.035] p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Next relationship action
                </p>
                <p className="mt-1 text-xs font-medium">
                  {account.next_action || "No next action saved"}
                </p>
                {account.next_action_due_at ? (
                  <p className="mt-1 text-[10px] text-primary">
                    Due {dateLabel(account.next_action_due_at)}
                  </p>
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
                            className="emery-press flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 text-primary"
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
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {interaction.outcome}
                        </p>
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
                        <span className="text-[9px] text-muted-foreground">
                          {dateLabel(stop.visited_at || stop.updated_at)}
                        </span>
                      </div>
                      {stop.visit_summary ? (
                        <p className="mt-1.5 text-xs leading-5">{stop.visit_summary}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No prior route visits recorded.
                </p>
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
