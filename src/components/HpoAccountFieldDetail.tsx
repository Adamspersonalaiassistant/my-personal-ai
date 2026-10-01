import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
/* eslint-disable @typescript-eslint/no-explicit-any -- Existing field-context payloads include dynamic account metadata. */
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  FileText,
  History,
  Mail,
  MapPin,
  MapPinned,
  MessageCircle,
  Navigation,
  Pencil,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import { Button } from "@/components/ui/button";
import { openHpoEmery } from "@/components/HpoEmerySheet";
import { deriveHpoAccountIntelligence, latestHpoTimestamp } from "@/lib/hpo-account-intelligence";
import { getHpoAccountFieldContext } from "@/lib/hpo-field.functions";
import { addHpoFieldContact, updateHpoFieldAccount } from "@/lib/hpo-workspace.functions";

function dateLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function titleCase(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function SectionTitle({
  icon,
  title,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      {icon ? <span className="text-primary">{icon}</span> : null}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0, left: 0 });
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      window.scrollTo({ top: pageScrollY, left: 0 });
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [accountId]);

  useEffect(() => {
    if (revealHistory && data?.account) historyRef.current?.setAttribute("open", "");
  }, [revealHistory, data]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setEditing(false);
    setContactOpen(false);
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
    void load({ data: { accountId } })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Couldn't load this account.");
        }
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

  const openAccountEditor = () =>
    openHpoEmery(
      "Update this account: ",
      account?.name ? `Edit · ${account.name}` : "Edit account",
    );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="hpo-crm fixed inset-0 z-[260] flex bg-background sm:items-center sm:justify-center sm:bg-black/70 sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.currentTarget === event.target && window.innerWidth >= 640) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="emery-sheet-in flex h-[100dvh] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden border-0 bg-background text-foreground shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:max-w-xl sm:rounded-[1.4rem] sm:border sm:border-border/70 sm:bg-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hpo-account-detail-title"
      >
        <header className="shrink-0 border-b border-border/70 bg-background/96 px-4 pb-3 pt-[max(0.8rem,env(safe-area-inset-top))] backdrop-blur-xl sm:bg-card/96 sm:pt-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                HPO account
              </p>
              <h2
                id="hpo-account-detail-title"
                className="mt-1 break-words text-xl font-semibold leading-tight tracking-[-0.02em]"
              >
                {account?.name ?? "Loading account…"}
              </h2>
              {account ? (
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                  {[account.city, account.account_type, account.specialty].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <Button
              ref={closeButtonRef}
              variant="ghost"
              type="button"
              onClick={onClose}
              className="size-11 shrink-0 rounded-full"
              aria-label="Close account"
            >
              <X className="size-5" />
            </Button>
          </div>
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-4 [-webkit-overflow-scrolling:touch]"
        >
          {error ? (
            <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : !account ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Loading relationship context…
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {titleCase(account.relationship_stage || account.status || "active")}
                  </span>
                  <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs font-semibold">
                    P{account.priority}
                  </span>
                  {account.account_type ? (
                    <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
                      {account.account_type}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-start gap-3">
                  <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-xl text-primary">
                    <MapPin className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium leading-5">
                      {[account.address, account.city].filter(Boolean).join(", ") || "Address not saved"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[
                        account.owner_name ? `Owner: ${account.owner_name}` : null,
                        account.territory,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Relationship account"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Last visit
                    </p>
                    <p className="mt-1 text-sm font-semibold">{dateLabel(lastVisitAt)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {intelligence.days_since_visit === null
                        ? "Never physically visited"
                        : intelligence.days_since_visit === 0
                          ? "Today"
                          : `${intelligence.days_since_visit} days ago`}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3">
                    <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Last touch
                    </p>
                    <p className="mt-1 text-sm font-semibold">{dateLabel(account.last_touch_at)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {titleCase(account.relationship_health || account.relationship_stage) ||
                        "Not classified"}
                    </p>
                  </div>
                </div>
              </section>

              <section
                className={`rounded-2xl border p-4 ${
                  intelligence.attention_state === "overdue"
                    ? "border-destructive/30 bg-destructive/[0.07]"
                    : "border-primary/25 bg-primary/[0.07]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <CalendarClock
                    className={`mt-0.5 size-5 shrink-0 ${
                      intelligence.attention_state === "overdue" ? "text-destructive" : "text-primary"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Next relationship action
                    </p>
                    <p className="mt-1 break-words text-base font-semibold leading-6">
                      {account.next_action || "No follow-up scheduled"}
                    </p>
                    {account.next_action_due_at ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Due {dateLabel(account.next_action_due_at)}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => (onFollowup ? onFollowup() : openHpoEmery("Set a follow-up for this account.", account.name))}
                    className="min-h-11 shrink-0 px-3 text-xs text-primary"
                  >
                    {account.next_action ? "Update" : "Set"}
                  </Button>
                </div>
              </section>

              {account.metadata?.latest_field_note_summary ? (
                <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Latest field note
                      </p>
                      <p className="mt-1 text-xs text-primary">
                        {dateTimeLabel(account.metadata.latest_field_note_at)}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                        {account.metadata.latest_field_note_summary}
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Quick actions
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {routeAddress ? (
                    <a
                      href={`https://maps.google.com/?saddr=Current+Location&daddr=${encodeURIComponent(
                        [routeAddress, routeCity].filter(Boolean).join(", "),
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="emery-press flex min-h-[68px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-1 text-xs font-semibold text-foreground"
                    >
                      <Navigation className="size-5 text-primary" />
                      Navigate
                    </a>
                  ) : (
                    <div className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border/50 bg-card/45 px-1 text-xs text-muted-foreground/60">
                      <Navigation className="size-5" />
                      Navigate
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      openHpoEmery(
                        routeAddress
                          ? `Add this account at ${[routeAddress, routeCity].filter(Boolean).join(", ")} to today's HPO route.`
                          : `Add this account to today's HPO route.`,
                        account.name,
                      )
                    }
                    className="h-auto min-h-[68px] min-w-0 flex-col gap-1.5 rounded-xl px-1 text-xs"
                  >
                    <MapPinned className="size-5 text-primary" />
                    Route
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onLog
                        ? onLog()
                        : openHpoEmery(
                            "Log a visit for this account. Ask me what happened and who I spoke with, then save it.",
                            account.name,
                          )
                    }
                    className="h-auto min-h-[68px] min-w-0 flex-col gap-1.5 rounded-xl px-1 text-xs"
                  >
                    <History className="size-5 text-primary" />
                    Visit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onNote}
                    className="h-auto min-h-[68px] min-w-0 flex-col gap-1.5 rounded-xl px-1 text-xs"
                  >
                    <FileText className="size-5 text-primary" />
                    Note
                  </Button>
                </div>
              </section>

              <section className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.12] to-primary/[0.035] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <MessageCircle className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold">Edit with Emery</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      Tell Emery what to change. This account is already attached to the conversation, so you can say things like “make this P5,” “change the address,” or “mark this relationship warm.”
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Button
                    type="button"
                    onClick={openAccountEditor}
                    className="min-h-12 justify-center rounded-xl"
                  >
                    <MessageCircle className="size-4" />
                    Chat to edit
                  </Button>
                  <div className="flex min-h-12 items-center gap-2 rounded-xl border border-primary/25 bg-background/55 pl-3 pr-1">
                    <span className="text-xs font-semibold text-foreground">Voice</span>
                    <EmeryVoiceControl
                      hpoAccountId={accountId}
                      {...(onChanged ? { onConversationChanged: onChanged } : {})}
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border/70 bg-card/60">
                <Button
                  variant="ghost"
                  className="min-h-12 w-full justify-between rounded-2xl px-4 text-sm"
                  onClick={() => setEditing((value) => !value)}
                  aria-expanded={editing}
                >
                  <span className="flex items-center gap-2">
                    <Pencil className="size-4 text-primary" />
                    Edit manually
                  </span>
                  <ChevronDown className={`size-4 transition-transform ${editing ? "rotate-180" : ""}`} />
                </Button>
                {editing ? (
                  <form
                    className="space-y-3 border-t border-border/60 px-4 pb-4 pt-3"
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
                      <label key={key} className="block text-sm text-muted-foreground">
                        {label}
                        <input
                          name={key}
                          type={key === "priority" ? "number" : "text"}
                          min={key === "priority" ? 1 : undefined}
                          max={key === "priority" ? 5 : undefined}
                          required={key === "name"}
                          defaultValue={value ?? ""}
                          className="mt-1.5 min-h-12 w-full rounded-xl border border-border bg-background/70 px-3 text-base text-foreground outline-none focus:border-primary"
                        />
                      </label>
                    ))}
                    <label className="block text-sm text-muted-foreground">
                      Notes
                      <textarea
                        name="notes"
                        defaultValue={account.notes ?? ""}
                        className="mt-1.5 min-h-28 w-full rounded-xl border border-border bg-background/70 p-3 text-base text-foreground outline-none focus:border-primary"
                      />
                    </label>
                    {editError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {editError}
                      </p>
                    ) : null}
                    <Button disabled={saving} className="min-h-12 w-full rounded-xl">
                      {saving ? "Saving…" : "Save account"}
                    </Button>
                  </form>
                ) : null}
              </section>

              {(account.relationship_health ||
                account.opportunity ||
                account.blockers ||
                account.notes) ? (
                <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
                  <SectionTitle title="Relationship notes" />
                  <div className="space-y-3 text-sm leading-6">
                    {account.relationship_health ? (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          Health
                        </p>
                        <p className="mt-0.5">{account.relationship_health}</p>
                      </div>
                    ) : null}
                    {account.opportunity ? (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          Opportunity
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{account.opportunity}</p>
                      </div>
                    ) : null}
                    {account.blockers ? (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          Blockers
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{account.blockers}</p>
                      </div>
                    ) : null}
                    {account.notes ? (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          Notes
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words">{account.notes}</p>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
                <SectionTitle
                  icon={<UserRound className="size-5" />}
                  title="Contacts"
                  action={
                    <Button
                      variant="ghost"
                      className="min-h-11 px-2 text-xs text-primary"
                      onClick={() => setContactOpen((value) => !value)}
                    >
                      {contactOpen ? "Cancel" : "Add contact"}
                    </Button>
                  }
                />

                {contactOpen ? (
                  <form
                    className="mt-2 space-y-3 border-t border-border/60 pt-3"
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
                      <label key={key} className="block text-sm text-muted-foreground">
                        {label}
                        <input
                          required={key === "name"}
                          name={key}
                          type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                          className="mt-1.5 min-h-12 w-full rounded-xl border border-border bg-background/70 px-3 text-base text-foreground outline-none focus:border-primary"
                        />
                      </label>
                    ))}
                    <label className="block text-sm text-muted-foreground">
                      Relationship notes
                      <textarea
                        name="notes"
                        className="mt-1.5 min-h-24 w-full rounded-xl border border-border bg-background/70 p-3 text-base text-foreground outline-none focus:border-primary"
                      />
                    </label>
                    {contactError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {contactError}
                      </p>
                    ) : null}
                    <Button className="min-h-12 w-full rounded-xl">Save contact</Button>
                  </form>
                ) : null}

                <div className="mt-2 space-y-2">
                  {!contacts.length ? (
                    <div className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                      No contacts saved yet. Add the person you should ask for when you walk in.
                    </div>
                  ) : null}
                  {contacts.slice(0, 8).map((contact: any) => (
                    <div key={contact.id} className="rounded-xl border border-border/70 bg-background/45 p-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold">{contact.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {contact.role_title || "Contact"}
                          </p>
                          {contact.relationship_notes ? (
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              {contact.relationship_notes}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {contact.phone ? (
                            <a
                              href={`tel:${contact.phone}`}
                              className="emery-press flex size-11 items-center justify-center rounded-xl border border-primary/15 text-primary"
                              aria-label={`Call ${contact.name}`}
                            >
                              <Phone className="size-4" />
                            </a>
                          ) : null}
                          {contact.email ? (
                            <a
                              href={`mailto:${contact.email}`}
                              className="emery-press flex size-11 items-center justify-center rounded-xl border border-primary/15 text-primary"
                              aria-label={`Email ${contact.name}`}
                            >
                              <Mail className="size-4" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {officeLocations.length > 1 || (!account.address && officeLocations.length) ? (
                <section className="rounded-2xl border border-border/70 bg-card/60 p-4">
                  <SectionTitle
                    icon={<MapPinned className="size-5" />}
                    title="Office locations"
                    action={
                      <span className="text-xs text-muted-foreground">
                        {officeLocations.length} saved
                      </span>
                    }
                  />
                  <div className="mt-2 space-y-2">
                    {officeLocations.map((location: any) => (
                      <div key={location.id} className="rounded-xl border border-border/70 bg-background/45 p-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{location.city || account.name}</p>
                            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                              {location.address}
                            </p>
                            {location.verification_status ? (
                              <p className="mt-1 text-xs font-medium text-primary">
                                {titleCase(location.verification_status)} location
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <a
                              href={`https://maps.google.com/?saddr=Current+Location&daddr=${encodeURIComponent(
                                [location.address, location.city].filter(Boolean).join(", "),
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              className="emery-press flex min-h-11 items-center gap-1 rounded-xl border border-border px-2.5 text-xs font-semibold"
                            >
                              <Navigation className="size-4 text-primary" />
                              Go
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                openHpoEmery(
                                  `Add this account at ${[location.address, location.city]
                                    .filter(Boolean)
                                    .join(", ")} to today's HPO route. Use this exact office location.`,
                                  account.name,
                                )
                              }
                              className="emery-press flex min-h-11 items-center gap-1 rounded-xl bg-primary px-2.5 text-xs font-semibold text-primary-foreground"
                            >
                              <MapPinned className="size-4" />
                              Route
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <details
                ref={historyRef}
                className="group rounded-2xl border border-border/70 bg-card/60 p-4"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                  <History className="size-5 text-primary" />
                  Relationship history
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {interactions.length} recent
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                {interactions.length ? (
                  <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                    {interactions.slice(0, 10).map((interaction: any) => (
                      <article key={interaction.id} className="rounded-xl border border-border/70 bg-background/45 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold capitalize text-primary">
                            {interaction.interaction_type || "interaction"}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {dateTimeLabel(interaction.occurred_at)}
                          </span>
                        </div>
                        {interaction.metadata?.spoken_with ? (
                          <p className="mt-1 text-xs text-primary">
                            Spoke with {interaction.metadata.spoken_with}
                          </p>
                        ) : null}
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                          {interaction.summary}
                        </p>
                        {interaction.metadata?.note_updated_at &&
                        interaction.metadata?.note_saved_at &&
                        interaction.metadata.note_updated_at !==
                          interaction.metadata.note_saved_at ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Edited {dateTimeLabel(interaction.metadata.note_updated_at)}
                          </p>
                        ) : null}
                        {interaction.outcome ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Outcome: {interaction.outcome}
                          </p>
                        ) : null}
                        {interaction.relationship_signal ? (
                          <p className="mt-1 text-xs font-medium capitalize text-primary">
                            Relationship signal: {String(interaction.relationship_signal).replaceAll("_", " ")}
                          </p>
                        ) : null}
                        {interaction.next_action ? (
                          <p className="mt-2 text-xs font-medium text-primary">
                            Next: {interaction.next_action}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
                    No relationship interactions recorded yet.
                  </p>
                )}
              </details>

              <details className="group rounded-2xl border border-border/70 bg-card/60 p-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="size-5 text-primary" />
                  Route visit history
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {routeStops.length} recent
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                {routeStops.length ? (
                  <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                    {routeStops.slice(0, 8).map((stop: any) => (
                      <article key={stop.id} className="rounded-xl border border-border/70 bg-background/45 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold capitalize text-primary">
                            {String(stop.status).replaceAll("_", " ")}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {dateTimeLabel(
                              stop.metadata?.route_note_saved_at ||
                                stop.visited_at ||
                                stop.updated_at,
                            )}
                          </span>
                        </div>
                        {stop.notes || stop.visit_summary ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {stop.notes || stop.visit_summary}
                          </p>
                        ) : null}
                        {stop.metadata?.route_note_updated_at &&
                        stop.metadata?.route_note_saved_at &&
                        stop.metadata.route_note_updated_at !==
                          stop.metadata.route_note_saved_at ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Edited {dateTimeLabel(stop.metadata.route_note_updated_at)}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
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
                  className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 text-sm font-semibold text-primary"
                >
                  <ArrowUpRight className="size-4" />
                  Open account in Maps
                </a>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
