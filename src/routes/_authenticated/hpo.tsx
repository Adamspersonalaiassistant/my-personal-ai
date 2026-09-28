import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  CalendarDays,
  ChevronRight,
  Clock3,
  MapPinned,
  MessageCircle,
  Plus,
  Search,
  UsersRound,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { HpoRoutePlanner } from "@/components/HpoRoutePlanner";
import { HpoFieldToday } from "@/components/HpoFieldToday";
import { HpoAccountFieldDetail } from "@/components/HpoAccountFieldDetail";
import { HpoEmerySheet, openHpoEmery } from "@/components/HpoEmerySheet";
import { createHpoAccount, logHpoInteraction } from "@/lib/hpo.functions";
import { getHpoWorkspace, setHpoFieldAccountFollowup } from "@/lib/hpo-workspace.functions";
import { getHpoFieldToday } from "@/lib/hpo-field.functions";

type View = "today" | "map" | "accounts" | "activity";
type Workspace = Awaited<ReturnType<typeof getHpoWorkspace>>;
type Account = Workspace["accounts"][number];
type Touch = Workspace["interactions"][number];
const tabs = [
  { key: "today", label: "Today", icon: Clock3 },
  { key: "map", label: "Map", icon: MapPinned },
  { key: "accounts", label: "Accounts", icon: UsersRound },
  { key: "activity", label: "Activity", icon: Activity },
] as const;
const field =
  "min-h-12 w-full rounded-md border border-border/70 bg-card/60 px-3 text-base text-foreground outline-none focus:border-primary";
const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

export const Route = createFileRoute("/_authenticated/hpo")({
  head: () => ({
    meta: [
      { title: "HPO Field — Emery" },
      {
        name: "description",
        content: "Hudson Pro field routes, territory, accounts, and relationship activity.",
      },
      { property: "og:title", content: "HPO Field — Emery" },
      {
        property: "og:description",
        content: "Hudson Pro field routes, territory, accounts, and relationship activity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HpoWorkspace,
});

function HpoWorkspace() {
  const read = useServerFn(getHpoWorkspace);
  const readToday = useServerFn(getHpoFieldToday);
  const createAccount = useServerFn(createHpoAccount);
  const logTouch = useServerFn(logHpoInteraction);
  const setFollowup = useServerFn(setHpoFieldAccountFollowup);
  const [view, setView] = useState<View>("map");
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"add" | "log" | "followup" | null>(null);
  const [logAccount, setLogAccount] = useState("");
  const [logKind, setLogKind] = useState("visit");
  const [page, setPage] = useState(0);
  const [moreLoading, setMoreLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [initialResolved, setInitialResolved] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await read({ data: { page: 0 } }));
      setPage(0);
      setRevision((n) => n + 1);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load HPO.");
    } finally {
      setLoading(false);
    }
  }, [read]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (initialResolved) return;
    let cancelled = false;
    void readToday({})
      .then((result) => {
        if (cancelled) return;
        if (
          result.route &&
          (result.route.route_date === result.today ||
            ["active", "in_progress"].includes(result.route.status))
        )
          setView("today");
        setInitialResolved(true);
      })
      .catch(() => setInitialResolved(true));
    return () => {
      cancelled = true;
    };
  }, [readToday, initialResolved]);

  async function loadMore() {
    if (!data || moreLoading || !data.hasMore) return;
    setMoreLoading(true);
    try {
      const next = await read({ data: { page: page + 1 } });
      setData({
        ...data,
        interactions: [...data.interactions, ...next.interactions],
        hasMore: next.hasMore,
      });
      setPage(page + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more activity.");
    } finally {
      setMoreLoading(false);
    }
  }
  const account = data?.accounts.find((item) => item.id === selected) ?? null;
  const emeryContextPrompt = account
    ? `I'm looking at ${account.name} in HPO. Help me with this account and use the live HPO record.`
    : view === "map"
      ? "I'm on the HPO map. Help me add offices, build or change my route, or work with the accounts on this map."
      : view === "today"
        ? "I'm in HPO Today. Help me run today's route, log visits, change stops, or handle the next action."
        : view === "accounts"
          ? "I'm in HPO Accounts. Help me add, update, research, or plan follow-up for an account."
          : "I'm in HPO Activity. Help me log a visit or touch, update follow-ups, or review recent account activity.";
  return (
    <AppShell
      title="HPO"
      padded={view !== "map"}
      askEmery={`I'm working in HPO ${view}. Help me with my field accounts and route.`}
    >
      <div
        className={
          view === "map"
            ? "relative h-full min-h-0 min-w-0 overflow-hidden"
            : "mx-auto max-w-5xl min-w-0 space-y-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        }
      >
        {view !== "map" ? (
          <nav
            aria-label="HPO field areas"
            className="sticky top-0 z-20 grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white/96 p-1 shadow-sm backdrop-blur-md"
          >
            {tabs.map(({ key, label, icon: Icon }) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                onClick={() => setView(key)}
                aria-current={view === key ? "page" : undefined}
                className={`h-11 min-w-0 flex-row gap-1 rounded-lg px-1 text-[10px] font-semibold ${view === key ? "bg-[#31486f] text-white hover:bg-[#31486f] hover:text-white" : "text-slate-500 hover:bg-[#d9f4e9] hover:text-[#31486f]"}`}
              >
                <Icon className="size-3.5" />
                <span className="truncate">{label}</span>
              </Button>
            ))}
          </nav>
        ) : null}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
          >
            {error}{" "}
            <Button variant="ghost" className="ml-2 min-h-11" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        )}
        {view === "today" && initialResolved ? (
          <HpoFieldToday key={`today-${revision}`} onOpenMap={() => setView("map")} />
        ) : null}
        {view === "map" && initialResolved ? (
          <HpoRoutePlanner
            key={`map-${revision}`}
            onNavigateHpo={(next) => setView(next)}
          />
        ) : null}
        {((view === "accounts" || view === "activity") && loading) ||
        ((view === "today" || view === "map") && !initialResolved) ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Opening HPO records…</p>
        ) : null}
        {view === "accounts" && data ? (
          <Accounts
            accounts={data.accounts}
            limited={data.accountLimitReached}
            onAdd={() =>
              openHpoEmery(
                "Add a new HPO account. Ask me only for the office name and physical street address if I haven't given them yet, then save it to HPO and plot it on the map.",
                "Accounts",
              )
            }
            onOpen={setSelected}
          />
        ) : null}
        {view === "activity" && data ? (
          <ActivityView
            data={data}
            onOpen={setSelected}
            onLog={(accountId, kind) => {
              const target = data.accounts.find((item) => item.id === accountId);
              openHpoEmery(
                kind === "visit"
                  ? `Log an HPO office visit${target ? ` for ${target.name}` : ""}. Ask me what happened and who I spoke with, then save it.`
                  : `Log an HPO relationship touch${target ? ` for ${target.name}` : ""}. Ask me for the missing details and save it.`,
                "Activity",
              );
            }}
            onFollowup={(accountId) => {
              const target = data.accounts.find((item) => item.id === accountId);
              openHpoEmery(
                `Update the next HPO follow-up${target ? ` for ${target.name}` : ""}. Ask me only for the missing action or date, then save it.`,
                "Follow-up",
              );
            }}
            onMore={() => void loadMore()}
            loading={moreLoading}
          />
        ) : null}
        {selected && (
          <HpoAccountFieldDetail
            accountId={selected}
            onClose={() => setSelected(null)}
            onChanged={() => void refresh()}
            onLog={() =>
              openHpoEmery(
                `Log a visit for ${account?.name || "this HPO account"}. Ask me what happened and who I spoke with, then save it.`,
                account?.name || "Account",
              )
            }
            onFollowup={() =>
              openHpoEmery(
                `Set or update the follow-up for ${account?.name || "this HPO account"}.`,
                account?.name || "Account",
              )
            }
          />
        )}
        {sheet === "add" && (
          <AccountSheet
            onClose={() => setSheet(null)}
            onSave={async (values) => {
              await createAccount({ data: values });
              setSheet(null);
              await refresh();
            }}
          />
        )}
        {sheet === "log" && (
          <TouchSheet
            accounts={data?.accounts ?? []}
            initialAccount={logAccount}
            initialKind={logKind}
            onClose={() => setSheet(null)}
            onSave={async (values) => {
              await logTouch({ data: values });
              setSheet(null);
              await refresh();
            }}
          />
        )}
        {sheet === "followup" && (
          <FollowupSheet
            account={data?.accounts.find((item) => item.id === logAccount)}
            onClose={() => setSheet(null)}
            onSave={async (values) => {
              await setFollowup({ data: values });
              setSheet(null);
              await refresh();
            }}
          />
        )}

        {view !== "map" ? (
          <button
            type="button"
            onClick={() => openHpoEmery(emeryContextPrompt, `HPO · ${view}`)}
            className="fixed bottom-[calc(4.9rem+env(safe-area-inset-bottom))] right-4 z-[55] flex min-h-12 items-center gap-2 rounded-full border border-primary/20 bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-[0_12px_32px_rgba(0,0,0,0.35)] md:bottom-6 md:right-6"
            aria-label="Ask Emery about HPO"
          >
            <MessageCircle className="size-4" />
            Emery
          </button>
        ) : null}
        <HpoEmerySheet onChanged={() => void refresh()} />

      </div>
    </AppShell>
  );
}

function Accounts({
  accounts,
  limited,
  onAdd,
  onOpen,
}: {
  accounts: Account[];
  limited: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [stage, setStage] = useState("all");
  const [city, setCity] = useState("all");
  const types = useMemo(
    () => [...new Set(accounts.map((a) => a.account_type).filter(Boolean))].sort() as string[],
    [accounts],
  );
  const stages = useMemo(
    () => [...new Set(accounts.map((a) => a.relationship_stage).filter(Boolean))].sort(),
    [accounts],
  );
  const cities = useMemo(
    () => [...new Set(accounts.map((a) => a.city).filter(Boolean))].sort() as string[],
    [accounts],
  );
  const shown = accounts.filter((a) => {
    const text = [a.name, a.account_type, a.specialty, a.city, a.territory, a.address]
      .join(" ")
      .toLowerCase();
    return (
      (!query || text.includes(query.toLowerCase())) &&
      (type === "all" || a.account_type === type) &&
      (stage === "all" || a.relationship_stage === stage) &&
      (city === "all" || a.city === city)
    );
  });
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Accounts</h1>
          <p className="text-xs text-muted-foreground">{shown.length} offices</p>
        </div>
        <Button onClick={onAdd} className="h-11 px-3">
          <Plus /> Add
        </Button>
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
        <span className="sr-only">Search accounts</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search office, city or address"
          className={`${field} pl-10`}
        />
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        <Filter value={type} onChange={setType} label="Type" options={types} />
        <Filter value={stage} onChange={setStage} label="Stage" options={stages} />
        <Filter value={city} onChange={setCity} label="City" options={cities} />
      </div>
      {limited && (
        <p className="text-xs text-muted-foreground">Showing the first 1,000 accounts.</p>
      )}
      <div className="divide-y divide-border/55 border-y border-border/55">
        {shown.map((a) => (
          <Button
            key={a.id}
            variant="ghost"
            onClick={() => onOpen(a.id)}
            className="h-auto min-h-[76px] w-full justify-between gap-2 rounded-none px-1.5 py-2 text-left hover:bg-card/60"
          >
            <span className="min-w-0 flex-1 whitespace-normal">
              <span className="block break-words text-sm font-semibold">{a.name}</span>
              <span className="mt-1 block break-words text-xs font-normal text-muted-foreground">
                {[a.account_type, a.city, a.relationship_stage].filter(Boolean).join(" · ") ||
                  "Account"}
              </span>
              <span className="mt-1 block break-words text-[11px] font-normal text-muted-foreground">
                {a.next_action
                  ? `Next: ${a.next_action}${a.next_action_due_at ? ` · ${date(a.next_action_due_at)}` : ""}`
                  : `Last touch: ${date(a.last_touch_at)}`}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
              P{a.priority}
              <ChevronRight className="size-4" />
            </span>
          </Button>
        ))}
        {!shown.length && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {accounts.length
              ? "No accounts match these filters."
              : "No accounts yet. Add your first office."}
          </p>
        )}
      </div>
    </section>
  );
}
function Filter({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: string[];
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full min-w-0 rounded-md border border-border/70 bg-card/60 px-1.5 text-xs text-foreground"
      >
        <option value="all">{label}: All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
function ActivityView({
  data,
  onOpen,
  onLog,
  onFollowup,
  onMore,
  loading,
}: {
  data: Workspace;
  onOpen: (id: string) => void;
  onLog: (id?: string, kind?: string) => void;
  onFollowup: (id: string) => void;
  onMore: () => void;
  loading: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const names = new Map(data.accounts.map((a) => [a.id, a.name]));
  const today = Date.now();
  const due = data.accounts
    .filter(
      (a) => a.next_action && a.next_action_due_at && Date.parse(a.next_action_due_at) <= today,
    )
    .sort(
      (a, b) => Date.parse(a.next_action_due_at || "") - Date.parse(b.next_action_due_at || ""),
    );
  const items = data.interactions.filter(
    (i) =>
      filter === "all" ||
      (filter === "visit" ? i.interaction_type === "visit" : i.interaction_type !== "visit"),
  );
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Activity</h1>
        <div className="grid grid-cols-2 gap-1.5">
          <Button className="h-11 px-2.5 text-xs" onClick={() => onLog("", "visit")}>
            <Plus /> Log Visit
          </Button>
          <Button
            variant="outline"
            className="h-11 px-2.5 text-xs"
            onClick={() => onLog("", "call")}
          >
            Log Touch
          </Button>
        </div>
      </div>
      {due.length > 0 && (
        <div className="border-y border-border/60 py-2">
          <h2 className="mb-1 text-xs font-semibold uppercase text-primary">
            Follow-ups due · {due.length}
          </h2>
          {due.slice(0, 8).map((a) => (
            <div
              key={a.id}
              className="flex min-h-14 items-center gap-2 border-b border-border/35 py-2 last:border-0"
            >
              <Button
                variant="ghost"
                onClick={() => onOpen(a.id)}
                className="h-auto min-h-11 min-w-0 flex-1 justify-start whitespace-normal text-left"
              >
                <span className="min-w-0 break-words">
                  <strong className="block text-xs">{a.name}</strong>
                  <span className="text-xs font-normal text-muted-foreground">{a.next_action}</span>
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-11 shrink-0 px-2 text-xs"
                onClick={() => onFollowup(a.id)}
              >
                Update
              </Button>
            </div>
          ))}
        </div>
      )}
      {data.meetings.length > 0 && (
        <div className="border-b border-border/60 pb-3">
          <h2 className="mb-2 text-xs font-semibold uppercase text-primary">Upcoming</h2>
          {data.meetings.slice(0, 5).map((meeting) => (
            <div key={meeting.id} className="flex gap-2 py-1.5 text-xs">
              <CalendarDays className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 break-words">{meeting.title || "HPO event"}</span>
              <time className="ml-auto shrink-0 text-muted-foreground">
                {date(meeting.meeting_at)}
              </time>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1 border-b border-border/60 pb-2">
        {(
          [
            ["all", "All"],
            ["visit", "Visits"],
            ["touch", "Other touches"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            className={`h-11 px-3 text-xs ${filter === key ? "bg-primary/12 text-primary" : "text-muted-foreground"}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="divide-y divide-border/50">
        {items.map((i: Touch) => (
          <Button
            key={i.id}
            variant="ghost"
            onClick={() => onOpen(i.account_id)}
            className="h-auto min-h-[76px] w-full justify-start rounded-none px-1 py-2.5 text-left hover:bg-card/50"
          >
            <span className="min-w-0 whitespace-normal">
              <span className="block text-sm font-semibold">
                {names.get(i.account_id) || "Account"}{" "}
                <span className="font-normal capitalize text-primary">· {i.interaction_type}</span>
              </span>
              <span className="block break-words text-xs font-normal leading-5 text-muted-foreground">
                {i.summary}
              </span>
              {i.metadata &&
              typeof i.metadata === "object" &&
              !Array.isArray(i.metadata) &&
              typeof i.metadata["spoken_with"] === "string" ? (
                <span className="block text-[11px] font-normal text-primary">
                  Spoke with {i.metadata["spoken_with"]}
                </span>
              ) : null}
              <span className="block text-[11px] font-normal text-muted-foreground">
                {date(i.occurred_at)}
                {i.next_action ? ` · Next: ${i.next_action}` : ""}
              </span>
            </span>
          </Button>
        ))}
        {!items.length && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No activity in this view yet.
          </p>
        )}
      </div>
      {data.hasMore && (
        <Button variant="outline" className="h-11 w-full" onClick={onMore} disabled={loading}>
          {loading ? "Loading…" : "Earlier activity"}
        </Button>
      )}
    </section>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[82] flex items-end justify-center bg-background/75 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(92dvh,calc(100dvh-1rem))] w-full max-w-lg flex-col rounded-t-lg border border-border bg-background sm:rounded-lg"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </section>
    </div>
  );
}
function AccountSheet({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (values: {
    name: string;
    accountType: string;
    address: string;
    city: string;
    notes: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [accountType, setType] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title="Add account" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave({ name, accountType, address, city, notes });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save account.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="block text-xs text-muted-foreground">
          Office name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Type
          <input
            value={accountType}
            onChange={(e) => setType(e.target.value)}
            placeholder="Attorney, provider…"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Address
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          City
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Relationship notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`mt-1 min-h-24 py-3 ${field}`}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button className="h-12 w-full" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save account"}
        </Button>
      </form>
    </Sheet>
  );
}
function TouchSheet({
  accounts,
  initialAccount,
  initialKind,
  onClose,
  onSave,
}: {
  accounts: Account[];
  initialAccount: string;
  initialKind: string;
  onClose: () => void;
  onSave: (values: {
    accountId: string;
    contactName: string;
    interactionType: string;
    summary: string;
    outcome: string;
    nextAction: string;
    nextActionDueAt: string | null;
  }) => Promise<void>;
}) {
  const [accountId, setAccount] = useState(initialAccount || accounts[0]?.id || "");
  const [kind, setKind] = useState(initialKind);
  const [contactName, setContactName] = useState("");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNext] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet
      title={kind === "visit" ? "Log office visit" : "Log relationship touch"}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave({
              accountId,
              contactName,
              interactionType: kind,
              summary,
              outcome,
              nextAction,
              nextActionDueAt: due ? new Date(`${due}T12:00:00`).toISOString() : null,
            });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not log activity.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="block text-xs text-muted-foreground">
          Account
          <select
            required
            value={accountId}
            onChange={(e) => setAccount(e.target.value)}
            className={`mt-1 ${field}`}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          Who did you speak with?
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Name or role (optional)"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Activity
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={`mt-1 ${field}`}
          >
            <option value="visit">Office visit</option>
            <option value="call">Call</option>
            <option value="text">Text</option>
            <option value="email">Email</option>
            <option value="lunch">Lunch</option>
            <option value="other">Other touch</option>
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          Notes
          <textarea
            required
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Who did you speak with? What happened?"
            className={`mt-1 min-h-32 py-3 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Result
          <input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Follow-up
          <input
            value={nextAction}
            onChange={(e) => setNext(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Follow-up date
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button className="h-12 w-full" disabled={saving || !accountId || !summary.trim()}>
          {saving ? "Saving…" : "Save activity"}
        </Button>
      </form>
    </Sheet>
  );
}
function FollowupSheet({
  account,
  onClose,
  onSave,
}: {
  account: Account | undefined;
  onClose: () => void;
  onSave: (values: {
    accountId: string;
    nextAction: string;
    dueAt: string | null;
  }) => Promise<void>;
}) {
  const [action, setAction] = useState(account?.next_action || "");
  const [due, setDue] = useState(account?.next_action_due_at?.slice(0, 10) || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title={`Follow-up · ${account?.name || "Account"}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!account) return;
          setSaving(true);
          setError("");
          try {
            await onSave({
              accountId: account.id,
              nextAction: action,
              dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : null,
            });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save follow-up.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="block text-xs text-muted-foreground">
          Next action
          <textarea
            required
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className={`mt-1 min-h-24 py-3 ${field}`}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Due date
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button className="h-12 w-full" disabled={saving || !action.trim()}>
          {saving ? "Saving…" : "Save follow-up"}
        </Button>
      </form>
    </Sheet>
  );
}
