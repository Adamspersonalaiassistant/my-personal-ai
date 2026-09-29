import { useEffect, useRef, useState } from "react";
/* eslint-disable @typescript-eslint/no-explicit-any -- Existing field-context payloads include dynamic account metadata. */
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  CalendarClock,
  History,
  FileText,
  MapPin,
  MapPinned,
  MessageCircle,
  Navigation,
  Mail,
  Phone,
  UserRound,
  X,
  Pencil,
} from "lucide-react";
import { getHpoAccountFieldContext } from "@/lib/hpo-field.functions";
import { addHpoFieldContact, updateHpoFieldAccount } from "@/lib/hpo-workspace.functions";
import { Button } from "@/components/ui/button";
import { openHpoEmery } from "@/components/HpoEmerySheet";
import { deriveHpoAccountIntelligence, latestHpoTimestamp } from "@/lib/hpo-account-intelligence";

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function HpoAccountFieldDetail({
  accountId,
  revision,
  revealHistory,
  onClose,
  onChanged,
  onNote,
  onLog,
  onFollowup,
}: {
  accountId: string;
  revision?: number;
  revealHistory?: boolean;
  onClose: () => void;
  onChanged?: () => void;
  onNote?: () => void;
  onLog?: () => void;
  onFollowup?: () => void;
}) {
  const load = useServerFn(getHpoAccountFieldContext);
  const update = useServerFn(updateHpoFieldAccount);
  const addContact = useServerFn(addHpoFieldContact);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactError, setContactError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLDetailsElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const pageScrollY = window.scrollY;
    const frame = window.requestAnimationFrame(() =>
      dialogRef.current?.scrollTo({ top: 0, left: 0 }),
    );
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      window.scrollTo({ top: pageScrollY, left: 0 });
    };
  }, [accountId]);

  useEffect(() => {
    if (revealHistory && data?.account) historyRef.current?.setAttribute("open", "");
  }, [revealHistory, data]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    dialogRef.current?.scrollTo({ top: 0, left: 0 });
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
  }, [accountId, load, revision]);

  const account = data?.account;
  const contacts = data?.contacts ?? [];
  const interactions = data?.interactions ?? [];
  const routeStops = data?.routeStops ?? [];
  const lastVisitAt = latestHpoTimestamp([
    ...interactions
      .filter((interaction: any) => interaction.interaction_type === "visit")
      .map((interaction: any) => interaction.occurred_at),
    ...routeStops
      .filter((stop: any) => ["completed", "visited", "closed"].includes(stop.status))
      .map((stop: any) => stop.visited_at ?? stop.updated_at),
  ]);
  const intelligence = deriveHpoAccountIntelligence(account ?? {}, lastVisitAt);
  const officeLocations = (data?.officeLocations ?? []).filter(
    (location: any, index: number, rows: any[]) =>
      typeof location?.address === "string" &&
      /\d/.test(location.address) &&
      location?.metadata?.map_as_location !== false &&
      rows.findIndex(
        (candidate: any) =>
          candidate?.metadata?.map_as_location !== false &&
          String(candidate?.address ?? "")
            .trim()
            .toLowerCase() === String(location.address).trim().toLowerCase(),
      ) === index,
  );
  const singleLinkedLocation = officeLocations.length === 1 ? officeLocations[0] : null;
  const routeAddress =
    [account?.address, singleLinkedLocation?.address].find(
      (address) => typeof address === "string" && /\d/.test(address),
    ) || "";
  const routeCity = routeAddress === account?.address ? account?.city : singleLinkedLocation?.city;

  return (
    <div
      className="hpo-crm fixed inset-0 z-[82] flex items-stretch bg-background/85 sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <section
        ref={dialogRef}
        className="emery-sheet-in h-dvh max-h-dvh w-full min-w-0 overflow-y-auto overscroll-contain border-0 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground shadow-xl [-webkit-overflow-scrolling:touch] sm:h-auto sm:max-h-[90dvh] sm:max-w-xl sm:rounded-lg sm:border sm:bg-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hpo-account-detail-title"
      >
        <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:bg-card/95 sm:pt-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase text-primary">Field account</p>
            <h2 id="hpo-account-detail-title" className="mt-1 break-words text-lg font-semibold">
              {account?.name ?? "Loading account…"}
            </h2>
          </div>
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            className="size-11 shrink-0"
            aria-label="Close account"
          >
            <X className="size-4" />
          </Button>
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
          <div className="space-y-3 pb-2 pt-3">
            <div className="min-w-0 border-b border-border pb-3">
              <p className="break-words text-xs text-muted-foreground">
                {[account.city, account.account_type, account.specialty]
                  .filter(Boolean)
                  .join(" · ") || "Account"}
              </p>
              <p className="mt-1 text-xs font-semibold capitalize text-primary">
                {account.relationship_stage || account.status || "Active"} · Priority{" "}
                {account.priority}
              </p>
              <div className="mt-3 rounded-lg border border-primary/25 bg-primary/10 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">
                  Next relationship action
                </p>
                <p
                  className={`mt-1 break-words text-sm font-semibold ${
                    intelligence.attention_state === "overdue" ? "text-destructive" : ""
                  }`}
                >
                  {account.next_action || "No follow-up set"}
                </p>
                {account.next_action_due_at ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Due {dateLabel(account.next_action_due_at)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {routeAddress ? (
                <a
                  href={`https://maps.apple.com/?daddr=${encodeURIComponent(
                    [routeAddress, routeCity].filter(Boolean).join(", "),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-card px-1 text-xs font-semibold text-foreground"
                >
                  <Navigation className="size-4 text-primary" />
                  Navigate
                </a>
              ) : null}
              {(routeAddress || officeLocations.length > 0) && (
                <Button
                  type="button"
                  onClick={() => {
                    openHpoEmery(
                      routeAddress
                        ? `Add ${account.name} at ${[routeAddress, routeCity]
                            .filter(Boolean)
                            .join(", ")} to today's HPO route.`
                        : `Add ${account.name} to today's HPO route. This relationship has multiple office locations: ${officeLocations
                            .map((location: any) =>
                              [location.address, location.city].filter(Boolean).join(", "),
                            )
                            .join(" | ")}. Ask me which office only if I did not specify one.`,
                      account.name,
                    );
                  }}
                  variant="outline"
                  className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs"
                >
                  <MapPinned className="size-4" />
                  Route
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={onNote}
                className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs"
              >
                <FileText className="size-4" />
                Note
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  onLog
                    ? onLog()
                    : openHpoEmery(
                        `Log an office visit for ${account.name}. Ask me what happened and who I spoke with, then save it to this HPO account.`,
                        account.name,
                      )
                }
                className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs"
              >
                <History className="size-4 text-primary" />
                Log Visit
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  onFollowup
                    ? onFollowup()
                    : openHpoEmery(
                        `Set or update the next follow-up for ${account.name}.`,
                        account.name,
                      )
                }
                className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs"
              >
                <CalendarClock className="size-4 text-primary" />
                Follow-Up
              </Button>
              <Button
                type="button"
                onClick={() =>
                  openHpoEmery(
                    `I'm working with ${account.name} (HPO account ID ${accountId}). Use this account's live relationship history, route context, contacts, visits and follow-ups to help me with the next action.`,
                    account.name,
                  )
                }
                className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs"
              >
                <MessageCircle className="size-4" />
                Emery
              </Button>
            </div>
            <Button
              variant="ghost"
              className="min-h-11 w-full justify-start px-1 text-xs text-muted-foreground"
              onClick={() => setEditing((value) => !value)}
            >
              <Pencil className="size-4" /> {editing ? "Close edit" : "Edit account details"}
            </Button>
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
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Relationship overview
              </p>
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
                <div className="rounded-md border border-border bg-card p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    Last visit
                  </p>
                  <p className="mt-1 text-xs font-semibold">{dateLabel(lastVisitAt)}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {intelligence.days_since_visit === null
                      ? "Never visited"
                      : intelligence.days_since_visit === 0
                        ? "Today"
                        : `${intelligence.days_since_visit} days ago`}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-card p-2.5">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    Last touch
                  </p>
                  <p className="mt-1 text-xs font-semibold">{dateLabel(account.last_touch_at)}</p>
                  <p className="mt-1 text-[10px] capitalize text-muted-foreground">
                    {account.relationship_health || account.relationship_stage || "Not classified"}
                  </p>
                </div>
              </div>
            </section>

            {officeLocations.length > 1 || (!account.address && officeLocations.length) ? (
              <section className="border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                  <MapPinned className="size-4 text-primary" />
                  <p className="text-sm font-semibold">Office locations</p>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {officeLocations.length} saved
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {officeLocations.map((location: any) => (
                    <div key={location.id} className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold">{location.city || account.name}</p>
                          <p className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">
                            {location.address}
                          </p>
                          {location.verification_status === "verified" ? (
                            <p className="mt-1 text-[9px] font-medium text-primary">
                              Verified office location
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <a
                            href={`https://maps.apple.com/?daddr=${encodeURIComponent(
                              [location.address, location.city].filter(Boolean).join(", "),
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="emery-press flex min-h-11 items-center gap-1 rounded-xl border border-border/55 px-2.5 text-[10px] font-semibold text-foreground"
                          >
                            <Navigation className="size-3.5 text-primary" />
                            Go
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              openHpoEmery(
                                `Add ${account.name} — ${[location.address, location.city]
                                  .filter(Boolean)
                                  .join(
                                    ", ",
                                  )} — to today's HPO route. Use this exact office location.`,
                                account.name,
                              )
                            }
                            className="emery-press flex min-h-11 items-center gap-1 rounded-xl bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground"
                          >
                            <MapPinned className="size-3.5" />
                            Route
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <UserRound className="size-4 text-primary" />
                <p className="text-sm font-semibold">Contacts</p>
                <Button
                  variant="ghost"
                  className="ml-auto min-h-11 text-xs text-primary"
                  onClick={() => setContactOpen((value) => !value)}
                >
                  {contactOpen ? "Cancel" : "Add contact"}
                </Button>
              </div>
              {contactOpen && (
                <form
                  className="mt-2 space-y-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    setContactError("");
                    try {
                      await addContact({
                        data: {
                          accountId,
                          name: String(form.get("name") || ""),
                          roleTitle: String(form.get("role") || ""),
                          phone: String(form.get("phone") || ""),
                          email: String(form.get("email") || ""),
                          relationshipNotes: String(form.get("notes") || ""),
                        },
                      });
                      setData(await load({ data: { accountId } }));
                      setContactOpen(false);
                      onChanged?.();
                    } catch (cause) {
                      setContactError(
                        cause instanceof Error ? cause.message : "Could not add contact.",
                      );
                    }
                  }}
                >
                  {[
                    ["name", "Name"],
                    ["role", "Role"],
                    ["phone", "Phone"],
                    ["email", "Email"],
                  ].map(([key, label]) => (
                    <label key={key} className="block text-xs text-muted-foreground">
                      {label}
                      <input
                        required={key === "name"}
                        name={key}
                        type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                        className="mt-1 min-h-11 w-full rounded-md border border-border bg-card px-3 text-base text-foreground"
                      />
                    </label>
                  ))}
                  <label className="block text-xs text-muted-foreground">
                    Relationship notes
                    <textarea
                      name="notes"
                      className="mt-1 min-h-24 w-full rounded-md border border-border bg-card p-3 text-base text-foreground"
                    />
                  </label>
                  {contactError && (
                    <p role="alert" className="text-sm text-destructive">
                      {contactError}
                    </p>
                  )}
                  <Button className="min-h-11 w-full">Save contact</Button>
                </form>
              )}
              <div className="mt-3 space-y-2">
                {!contacts.length && (
                  <p className="text-xs text-muted-foreground">No contacts saved yet.</p>
                )}
                {contacts.slice(0, 8).map((contact: any) => (
                  <div key={contact.id} className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{contact.name}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {contact.role_title || "Contact"}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {contact.phone ? (
                          <a
                            href={`tel:${contact.phone}`}
                            className="emery-press flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 text-primary"
                            aria-label={`Call ${contact.name}`}
                          >
                            <Phone className="size-3.5" />
                          </a>
                        ) : null}
                        {contact.email ? (
                          <a
                            href={`mailto:${contact.email}`}
                            className="emery-press flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 text-primary"
                            aria-label={`Email ${contact.name}`}
                          >
                            <Mail className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
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

            <details ref={historyRef} className="rounded-md border border-border bg-card p-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                Relationship history{" "}
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {interactions.length} recent
                </span>
              </summary>
              <div className="flex items-center gap-2">
                <History className="size-4 text-primary" />
                <p className="text-sm font-semibold">Relationship history</p>
              </div>
              {interactions.length ? (
                <div className="mt-3 space-y-2">
                  {interactions.slice(0, 10).map((interaction: any) => (
                    <div
                      key={interaction.id}
                      className="rounded-md border border-border bg-card p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold capitalize text-primary">
                          {interaction.interaction_type || "interaction"}
                        </p>
                        <span className="text-[9px] text-muted-foreground">
                          {dateLabel(interaction.occurred_at)}
                        </span>
                      </div>
                      {interaction.metadata?.spoken_with ? (
                        <p className="mt-1 text-[10px] text-primary">
                          Spoke with {interaction.metadata.spoken_with}
                        </p>
                      ) : null}
                      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5">
                        {interaction.summary}
                      </p>
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
            </details>

            <details className="rounded-md border border-border bg-card p-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
                Route visit history{" "}
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {routeStops.length} recent
                </span>
              </summary>
              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 text-primary" />
                <p className="text-sm font-semibold">Route visit history</p>
              </div>
              {routeStops.length ? (
                <div className="mt-3 space-y-2">
                  {routeStops.slice(0, 8).map((stop: any) => (
                    <div key={stop.id} className="rounded-md border border-border bg-card p-3">
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
            </details>

            {routeAddress ? (
              <a
                href={`https://maps.apple.com/?q=${encodeURIComponent(
                  [account.name, routeAddress, routeCity].filter(Boolean).join(", "),
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
