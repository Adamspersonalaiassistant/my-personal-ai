import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronRight,
  FileText,
  MessageCircle,
  Navigation,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { HpoRoutePlanner } from "@/components/HpoRoutePlanner";
import { HpoWeeklyPlanner } from "@/components/HpoWeeklyPlanner";
import { HpoFieldNav, type HpoFieldView } from "@/components/HpoFieldNav";
import { HpoAccountFieldDetail } from "@/components/HpoAccountFieldDetail";
import { HpoEmerySheet, openHpoEmery } from "@/components/HpoEmerySheet";
import { HpoActivityView } from "@/components/HpoActivityView";
import { createHpoAccount, logHpoInteraction } from "@/lib/hpo.functions";
import { getHpoWorkspace, setHpoFieldAccountFollowup } from "@/lib/hpo-workspace.functions";
import {
  updateVerifiedHpoAccountFacts,
  correctHpoAccountRelationship,
  upsertVerifiedHpoContact,
  importVerifiedHpoInteractionHistory,
} from "@/lib/hpo-crm-write.functions";
import type { HpoAttentionState } from "@/lib/hpo-account-intelligence";
import {
  createVerifiedHpoProspect,
  findHpoProspectDuplicates,
  linkHpoProspectLocationToAccount,
  mergeHpoProspects,
  promoteHpoProspectToAccount,
  rejectHpoProspect,
  updateHpoProspectVerification,
  updateVerifiedHpoProspectFacts,
} from "@/lib/hpo-prospect-write.functions";
import "@/components/hpo-accounts.css";

type View = HpoFieldView;
type Workspace = Awaited<ReturnType<typeof getHpoWorkspace>>;
type Account = Workspace["accounts"][number];
const CONTROLLED_PROSPECT_WRITE_FUNCTIONS = [
  updateVerifiedHpoAccountFacts,
  correctHpoAccountRelationship,
  upsertVerifiedHpoContact,
  importVerifiedHpoInteractionHistory,
  findHpoProspectDuplicates,
  createVerifiedHpoProspect,
  updateHpoProspectVerification,
  updateVerifiedHpoProspectFacts,
  rejectHpoProspect,
  mergeHpoProspects,
  linkHpoProspectLocationToAccount,
  promoteHpoProspectToAccount,
] as const;
const field =
  "min-h-12 w-full rounded-md border border-border/70 bg-card/60 px-3 text-base text-foreground outline-none focus:border-primary";
const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const attentionLabel = (value: HpoAttentionState) =>
  ({
    overdue: "Follow-up overdue",
    due_soon: "Follow-up due soon",
    never_visited: "Never visited",
    stale: "Needs attention",
    current: "Current",
  })[value];

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
  const createAccount = useServerFn(createHpoAccount);
  const logTouch = useServerFn(logHpoInteraction);
  const setFollowup = useServerFn(setHpoFieldAccountFollowup);
  const requestedRouteId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("routeId")
      : null;
  const [view, setView] = useState<View>("planner");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("activity") === "1") setView("activity");
  }, []);
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"add" | "log" | "followup" | "note" | null>(null);
  const [logAccount, setLogAccount] = useState("");
  const [noteSavedAccount, setNoteSavedAccount] = useState<string | null>(null);
  const [logKind, setLogKind] = useState("visit");
  const [page, setPage] = useState(0);
  const [moreLoading, setMoreLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [plannerContext, setPlannerContext] = useState<{ routeId: string | null; stopId: string | null }>({ routeId: null, stopId: null });
  const [mapRouteId, setMapRouteId] = useState<string | null>(requestedRouteId);
  const [mapContextRouteId, setMapContextRouteId] = useState<string | null>(requestedRouteId);
  const [mapRouteDate, setMapRouteDate] = useState<string | null>(null);
  const [mapOpenBuilder, setMapOpenBuilder] = useState(false);
  const [plannerFocusDate, setPlannerFocusDate] = useState<string | null>(null);
  const [plannerFocusRouteId, setPlannerFocusRouteId] = useState<string | null>(requestedRouteId);

  const handlePlannerRouteContextChange = useCallback(
    (routeId: string | null, stopId: string | null) => {
      setPlannerContext((current) =>
        current.routeId === routeId && current.stopId === stopId
          ? current
          : { routeId, stopId },
      );
    },
    [],
  );

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
    : view === "planner"
      ? "I'm in HPO Planner. Help me plan this week, resume the route I'm working on, review saved routes, and build or adjust the route for the day I'm viewing."
      : view === "map"
        ? "I'm on the HPO map. Help me add offices, build or change my route, or work with the accounts on this map."
        : view === "accounts"
          ? "I'm in HPO Accounts. Help me add, update, research, or plan follow-up for an account."
          : "I'm in HPO Activity. Help me log a visit or touch, update follow-ups, or review recent account activity.";
  return (
    <AppShell
      title="HPO"
      padded={false}
      askEmery={`I'm working in HPO ${view}. Help me with my field accounts and route.`}
    >
      <div
        className="hpo-crm flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"
        data-controlled-prospect-writes={CONTROLLED_PROSPECT_WRITE_FUNCTIONS.length}
      >
        <HpoFieldNav
          view={view}
          onChange={(next) => {
            if (next === "map") {
              setMapRouteId(null);
              setMapRouteDate(null);
              setMapOpenBuilder(false);
            }
            if (next !== "planner") {
              setPlannerFocusDate(null);
              setPlannerFocusRouteId(null);
            }
            setView(next);
          }}
        />
        <div
          className={
            view === "map"
              ? "relative min-h-0 min-w-0 flex-1 overflow-hidden"
              : "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
          }
        >
          <div
            className={
              view === "map"
                ? "h-full min-h-0"
                : "mx-auto max-w-5xl space-y-4 px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4"
            }
          >
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
            {view === "planner" ? (
              <HpoWeeklyPlanner
                key={`planner-${revision}-${plannerFocusDate ?? "none"}-${plannerFocusRouteId ?? "none"}`}
                focusDate={plannerFocusDate}
                focusRouteId={plannerFocusRouteId}
                onRouteContextChange={handlePlannerRouteContextChange}
                onOpenMap={({ routeDate, routeId, build }) => {
                  setMapRouteId(routeId ?? null);
                  setMapRouteDate(routeDate);
                  setMapOpenBuilder(Boolean(build));
                  setView("map");
                }}
              />
            ) : null}
            {view === "map" ? (
              <HpoRoutePlanner
                key={`map-${revision}-${mapRouteId ?? "none"}-${mapRouteDate ?? "none"}-${mapOpenBuilder ? "build" : "browse"}`}
                initialRouteId={mapRouteId}
                initialRouteDate={mapRouteDate}
                openBuilderOnMount={mapOpenBuilder}
                onRouteContextChange={setMapContextRouteId}
                onNavigateHpo={(next) => {
                  setMapOpenBuilder(false);
                  setView(next);
                }}
              />
            ) : null}
            {(view === "accounts" || view === "activity") && loading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Opening HPO records…
              </p>
            ) : null}
            {view === "accounts" && data ? (
              <Accounts
                accounts={data.accounts}
                limited={data.accountLimitReached}
                onNote={(id) => {
                  setLogAccount(id);
                  setSheet("note");
                }}
                onEmery={(a) =>
                  openHpoEmery(
                    `I'm working with HPO account ${a.name} (account ID ${a.id}). Use its live relationship history, contacts, visits, and follow-ups to advise me on this account.`,
                    a.name,
                  )
                }
                onAdd={() =>
                  openHpoEmery(
                    "Add a new HPO account. Ask me only for the office name and physical street address if I haven't given them yet, then save it to HPO and plot it on the map.",
                    "Accounts",
                  )
                }
                onOpen={(id) => {
                  setNoteSavedAccount(null);
                  setSelected(id);
                }}
              />
            ) : null}
            {view === "activity" && data ? (
              <HpoActivityView
                data={data as any}
                onOpenAccount={setSelected}
                onAskEmery={(prompt, title) => openHpoEmery(prompt, title)}
                onMore={() => void loadMore()}
                loading={moreLoading}
              />
            ) : null}
            {selected && (
              <HpoAccountFieldDetail
                accountId={selected}
                revision={revision}
                revealHistory={noteSavedAccount === selected}
                onClose={() => setSelected(null)}
                onChanged={() => void refresh()}
                onNote={() => {
                  setLogAccount(selected);
                  setSheet("note");
                }}
                onLog={() =>
                  openHpoEmery(
                    `Log a visit for ${account?.name || "this HPO account"}. Ask me what happened and who I spoke with, then save it.`,
                    account?.name || "Account",
                  )
                }
                onFollowup={() => {
                  setLogAccount(selected);
                  setSheet("followup");
                }}
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
            {sheet === "note" && (
              <QuickNoteSheet
                account={data?.accounts.find((item) => item.id === logAccount)}
                onClose={() => setSheet(null)}
                onSave={async (summary) => {
                  await logTouch({
                    data: { accountId: logAccount, interactionType: "note", summary },
                  });
                  setNoteSavedAccount(logAccount);
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

            {view !== "map" && view !== "accounts" ? (
              <Button
                type="button"
                onClick={() => openHpoEmery(emeryContextPrompt, `HPO · ${view}`)}
                className="fixed bottom-[calc(5.15rem+env(safe-area-inset-bottom))] right-3 z-[55] flex size-11 items-center justify-center rounded-full border border-primary/20 bg-primary text-xs font-semibold text-primary-foreground shadow-[0_10px_24px_rgba(0,0,0,0.3)] sm:h-12 sm:w-auto sm:gap-2 sm:px-4 md:bottom-6 md:right-6"
                aria-label="Ask Emery about HPO"
              >
                <MessageCircle className="size-4" />
                <span className="hidden sm:inline">Emery</span>
              </Button>
            ) : null}
            <HpoEmerySheet
              routeId={
                view === "planner"
                  ? plannerContext.routeId
                  : view === "map"
                    ? mapContextRouteId
                    : null
              }
              stopId={view === "planner" ? plannerContext.stopId : null}
              selectedAccountId={selected}
              surface={`hpo.${view}`}
              onRouteBuilt={(builtRouteId, builtRouteDate) => {
                setPlannerFocusDate(builtRouteDate);
                setPlannerFocusRouteId(builtRouteId);
                setPlannerContext({ routeId: builtRouteId, stopId: null });
                setMapRouteId(builtRouteId);
                setMapContextRouteId(builtRouteId);
                setMapRouteDate(builtRouteDate);
                setMapOpenBuilder(false);
                setView("planner");
                setRevision((current) => current + 1);
              }}
              onChanged={() => {
                void refresh();
              }}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Accounts({
  accounts,
  limited,
  onAdd,
  onOpen,
  onNote,
  onEmery,
}: {
  accounts: Account[];
  limited: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onNote: (id: string) => void;
  onEmery: (account: Account) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [stage, setStage] = useState("all");
  const [city, setCity] = useState("all");
  const [attention, setAttention] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      (city === "all" || a.city === city) &&
      (attention === "all" || a.attention_state === attention)
    );
  });
  const activeFilters = [type, stage, city, attention].filter((value) => value !== "all").length;
  return (
    <section className="min-w-0 space-y-3">
      <div className="sticky top-0 z-10 -mx-3 space-y-2 border-b border-border bg-background/95 px-3 pb-3 pt-1 backdrop-blur-md sm:-mx-4 sm:px-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Accounts</h1>
            <p className="text-xs text-muted-foreground">{shown.length} offices</p>
          </div>
          <Button onClick={onAdd} className="min-h-11 shrink-0 px-3">
            <Plus className="size-4" /> Add
          </Button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Search accounts</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Office, specialty, city…"
              className="min-h-11 w-full rounded-md border border-border bg-card pl-10 pr-2 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className="min-h-11 shrink-0 gap-1 px-2 text-xs"
          >
            <SlidersHorizontal className="size-4" /> Filters
            {activeFilters ? ` · ${activeFilters}` : ""}
          </Button>
        </div>
        {activeFilters > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto text-xs text-primary">
            <span className="truncate">
              {[
                type,
                stage,
                city,
                attention === "all" ? "all" : attentionLabel(attention as HpoAttentionState),
              ]
                .filter((v) => v !== "all")
                .join(" · ")}
            </span>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 shrink-0 px-2 text-xs"
              onClick={() => {
                setType("all");
                setStage("all");
                setCity("all");
                setAttention("all");
              }}
            >
              Clear
            </Button>
          </div>
        )}
        {filtersOpen && (
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-card p-2 sm:grid-cols-4">
            <Filter value={type} onChange={setType} label="Type" options={types} />
            <Filter value={stage} onChange={setStage} label="Stage" options={stages} />
            <Filter value={city} onChange={setCity} label="City" options={cities} />
            <Filter
              value={attention}
              onChange={setAttention}
              label="Attention"
              options={["overdue", "due_soon", "never_visited", "stale", "current"]}
              formatOption={(value) => attentionLabel(value as HpoAttentionState)}
            />
          </div>
        )}
      </div>
      {limited && (
        <p className="text-xs text-muted-foreground">Showing the first 1,000 accounts.</p>
      )}
      <div className="space-y-2">
        {shown.map((a) => {
          const due = a.attention_state === "overdue";
          const navigable = Boolean(a.address?.trim() && /\d/.test(a.address));
          return (
            <article
              key={a.id}
              className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpen(a.id)}
                className="h-auto min-h-24 w-full justify-between gap-2 rounded-none px-3 py-3 text-left text-foreground hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 whitespace-normal">
                  <span className="block break-words text-sm font-semibold leading-5">
                    {a.name}
                  </span>
                  <span className="mt-1 block break-words text-xs font-normal text-muted-foreground">
                    {[a.city, a.account_type, a.specialty].filter(Boolean).join(" · ") || "Account"}
                  </span>
                  <span className="mt-2 block break-words text-[11px] font-medium capitalize text-primary">
                    {a.relationship_stage || a.status || "Account"} · Priority {a.priority}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-normal text-muted-foreground">
                    <span>
                      Last visit:{" "}
                      {a.days_since_visit === null
                        ? "Never"
                        : a.days_since_visit === 0
                          ? "Today"
                          : `${a.days_since_visit}d`}
                    </span>
                    <span>Last touch: {date(a.last_touch_at)}</span>
                  </span>
                  <span
                    className={`mt-1 block text-[11px] font-semibold ${
                      due
                        ? "text-destructive"
                        : a.attention_state === "due_soon" || a.attention_state === "stale"
                          ? "text-primary"
                          : "text-muted-foreground"
                    }`}
                  >
                    {attentionLabel(a.attention_state)}
                  </span>
                  {a.next_action && (
                    <span
                      className={`mt-1 block break-words text-xs font-medium ${due ? "text-destructive" : "text-foreground"}`}
                    >
                      {due ? "Due · " : "Next · "}
                      {a.next_action}
                      {a.next_action_due_at ? ` · ${date(a.next_action_due_at)}` : ""}
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Button>
              <div className="flex min-w-0 items-center gap-1 border-t border-border px-1.5 py-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 flex-1 gap-1 px-1 text-xs"
                  onClick={() => onNote(a.id)}
                >
                  <FileText className="size-4" /> Note
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 flex-1 gap-1 px-1 text-xs"
                  onClick={() => onEmery(a)}
                >
                  <MessageCircle className="size-4" /> Emery
                </Button>
                {navigable && (
                  <a
                    href={`https://maps.apple.com/?daddr=${encodeURIComponent([a.address, a.city].filter(Boolean).join(", "))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md text-xs font-medium text-primary hover:bg-muted"
                  >
                    <Navigation className="size-4" /> Go
                  </a>
                )}
              </div>
            </article>
          );
        })}
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
  formatOption,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: string[];
  formatOption?: (value: string) => string;
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full min-w-0 rounded-md border border-border bg-card px-3 text-base text-foreground"
      >
        <option value="all">{label}: All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {formatOption ? formatOption(o) : o}
          </option>
        ))}
      </select>
    </label>
  );
}
function QuickNoteSheet({
  account,
  onClose,
  onSave,
}: {
  account: Account | undefined;
  onClose: () => void;
  onSave: (summary: string) => Promise<void>;
}) {
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <div
      className="hpo-crm fixed inset-0 z-[90] flex items-end justify-center bg-background/70 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Quick note for ${account?.name || "account"}`}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-t-lg border border-border bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-xl sm:rounded-lg"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Quick note</h2>
            <p className="truncate text-xs text-muted-foreground">{account?.name}</p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11"
            aria-label="Close note"
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </div>
        <form
          className="mt-3 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError("");
            try {
              await onSave(summary.trim());
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not save note.");
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="block text-xs font-medium">
            Note
            <textarea
              autoFocus
              required
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What should you remember about this office?"
              className="mt-1 min-h-32 w-full rounded-md border border-border bg-card p-3 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={saving || !summary.trim()} className="min-h-12 w-full">
            {saving ? "Saving…" : "Save note"}
          </Button>
        </form>
      </section>
    </div>
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
      className="fixed inset-0 z-[90] flex items-end justify-center bg-background/75 sm:items-center sm:p-4"
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
