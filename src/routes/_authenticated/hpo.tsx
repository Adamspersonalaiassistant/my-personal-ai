import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardPlus,
  Compass,
  FileUp,
  Handshake,
  ListTodo,
  MapPinned,
  MessageCircle,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  Target,
  UsersRound,
} from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import {
  createHpoAccount,
  getHpoDashboard,
  logHpoInteraction,
  stageHpoImport,
} from "@/lib/hpo.functions";

export const Route = createFileRoute("/_authenticated/hpo")({ component: HpoWorkspace });

type DashboardData = Awaited<ReturnType<ReturnType<typeof useServerFn<typeof getHpoDashboard>>>>;
type ViewKey = "dashboard" | "accounts" | "relationships" | "routes" | "performance" | "events" | "notes" | "tasks";

const views: Array<{ key: ViewKey; label: string; icon: typeof BriefcaseBusiness }> = [
  { key: "dashboard", label: "Dashboard", icon: BriefcaseBusiness },
  { key: "accounts", label: "Accounts", icon: UsersRound },
  { key: "relationships", label: "Relationships", icon: Handshake },
  { key: "routes", label: "Routes", icon: RouteIcon },
  { key: "performance", label: "Performance", icon: BarChart3 },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "notes", label: "Activity", icon: Activity },
  { key: "tasks", label: "HPO Tasks", icon: ListTodo },
];

function dateLabel(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "No time set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No time set";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HpoWorkspace() {
  const loadDashboard = useServerFn(getHpoDashboard);
  const addAccount = useServerFn(createHpoAccount);
  const addInteraction = useServerFn(logHpoInteraction);
  const stageImport = useServerFn(stageHpoImport);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [modal, setModal] = useState<"account" | "interaction" | "import" | null>(null);

  async function refresh(quiet = false) {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await loadDashboard({}));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't load HPO right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const accountsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of data?.accounts ?? []) map.set(account.id, account.name);
    return map;
  }, [data]);

  const askEmeryContext =
    view === "dashboard"
      ? "I’m in my HPO dashboard. Help me decide the highest-leverage Hudson Pro sales/relationship action next."
      : `I’m in HPO ${view}. Help me work through what matters here and decide the next action.`;

  return (
    <AppShell title="HPO" askEmery={askEmeryContext}>
      <div className="space-y-5 pb-2">
        <section className="emery-fade-up overflow-hidden rounded-[1.75rem] border border-primary/15 bg-[linear-gradient(150deg,oklch(0.18_0.04_158/0.92),oklch(0.115_0.022_160/0.96))] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-primary">
                <BriefcaseBusiness className="size-4" />
                <span className="emery-kicker">Hudson Pro · Work OS</span>
              </div>
              <h1 className="mt-2 text-[1.45rem] font-semibold tracking-[-0.035em] sm:text-[1.65rem]">
                Run the relationship, not the spreadsheet.
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Accounts, field activity, follow-ups and sales signals in one place. Tell Emery what happened — she should handle where it belongs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh(true)}
              aria-label="Refresh HPO dashboard"
              disabled={refreshing}
              className="emery-press emery-surface flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:text-primary disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <QuickAction
              icon={MessageCircle}
              label="Capture update"
              href="/chat?prefill=I%20need%20to%20log%20an%20HPO%20update%3A%20"
            />
            <QuickAction
              icon={Sparkles}
              label="What’s next?"
              href="/chat?prefill=What%20is%20the%20highest-leverage%20HPO%20action%20I%20should%20do%20next%3F"
            />
            <QuickAction icon={Plus} label="Add account" onClick={() => setModal("account")} />
            <QuickAction icon={ClipboardPlus} label="Log touch" onClick={() => setModal("interaction")} />
          </div>
        </section>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {views.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-2xl border px-3 text-xs font-semibold transition ${
                view === key
                  ? "border-primary/25 bg-primary/[0.085] text-primary"
                  : "border-border/55 bg-card/45 text-muted-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="emery-glass flex min-h-52 items-center justify-center rounded-[1.6rem] text-sm text-muted-foreground">
            Opening your HPO command center…
          </div>
        ) : (
          <>
            {view === "dashboard" ? <Dashboard data={data} accountsById={accountsById} /> : null}
            {view === "accounts" ? <AccountsView data={data} onAdd={() => setModal("account")} /> : null}
            {view === "relationships" ? <RelationshipsView data={data} accountsById={accountsById} onLog={() => setModal("interaction")} /> : null}
            {view === "routes" ? <RoutesView data={data} /> : null}
            {view === "performance" ? <PerformanceView data={data} /> : null}
            {view === "events" ? <EventsView data={data} /> : null}
            {view === "notes" ? <ActivityView data={data} accountsById={accountsById} /> : null}
            {view === "tasks" ? <TasksView data={data} /> : null}
          </>
        )}

        <section className="emery-glass rounded-[1.55rem] p-4">
          <div className="flex items-start gap-3">
            <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-2xl text-primary">
              <FileUp className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Ready for your real HPO history</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The data layer is prepared for accounts, contacts, visits, lunches, route history and aggregate referral metrics. Import provenance stays attached so we can correct or replace bad data later.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setModal("import")}
                  className="emery-press min-h-11 rounded-2xl border border-primary/20 bg-primary/[0.055] px-3.5 text-xs font-semibold text-primary"
                >
                  Stage an import source
                </button>
                <a
                  href="/chat?prefill=Help%20me%20prepare%20my%20HPO%20data%20for%20import%20into%20Emery.%20"
                  className="emery-press flex min-h-11 items-center rounded-2xl border border-border/60 px-3.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Ask Emery to prep data
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>

      {modal === "account" ? (
        <AccountModal
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            await addAccount({ data: payload });
            setModal(null);
            await refresh(true);
          }}
        />
      ) : null}
      {modal === "interaction" ? (
        <InteractionModal
          accounts={data?.accounts ?? []}
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            await addInteraction({ data: payload });
            setModal(null);
            await refresh(true);
          }}
        />
      ) : null}
      {modal === "import" ? (
        <ImportModal
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            await stageImport({ data: payload });
            setModal(null);
            await refresh(true);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function QuickAction({ icon: Icon, label, href, onClick }: { icon: typeof BriefcaseBusiness; label: string; href?: string; onClick?: () => void }) {
  const content = (
    <>
      <Icon className="size-4" />
      <span>{label}</span>
    </>
  );
  const className = "emery-press flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/8 bg-white/[0.035] px-3 text-center text-xs font-semibold text-muted-foreground hover:border-primary/20 hover:bg-primary/[0.055] hover:text-foreground";
  return href ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function Dashboard({ data, accountsById }: { data: any; accountsById: Map<string, string> }) {
  const signalCards = [
    { label: "Active accounts", value: data?.signals?.activeAccounts ?? 0, hint: "loaded into HPO" },
    { label: "Follow-ups due", value: data?.signals?.overdueFollowups ?? 0, hint: "need attention" },
    { label: "Cold accounts", value: data?.signals?.coldAccounts ?? 0, hint: "30+ days since touch" },
    { label: "Untapped", value: data?.signals?.untappedAccounts ?? 0, hint: "no touch recorded" },
  ];

  return (
    <div className="space-y-4">
      <section className="emery-glass rounded-[1.6rem] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="emery-kicker">Highest-leverage move</p>
            <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
              {data?.workFocus?.title ?? "Load your first HPO account"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {data?.workFocus?.detail ?? "Once your real work data is in, Emery will prioritize the next relationship action here."}
            </p>
          </div>
          <Target className="size-5 shrink-0 text-primary" />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {signalCards.map((card) => (
          <div key={card.label} className="emery-surface rounded-2xl p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{card.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <DashboardList
          title="Follow-ups & tasks"
          icon={ListTodo}
          empty="No HPO follow-ups are due yet."
          rows={(data?.hpoTasks ?? []).slice(0, 5).map((task: any) => ({
            title: task.title,
            meta: task.due_at ? `Due ${dateLabel(task.due_at)}` : "No due date",
          }))}
        />
        <DashboardList
          title="Upcoming HPO events"
          icon={CalendarDays}
          empty="No HPO meetings or lunches linked yet."
          rows={(data?.hpoMeetings ?? []).slice(0, 5).map((meeting: any) => ({
            title: meeting.title || "Untitled event",
            meta: dateTimeLabel(meeting.meeting_at),
          }))}
        />
        <DashboardList
          title="Recent relationship touches"
          icon={Handshake}
          empty="No visits or relationship touches logged yet."
          rows={(data?.recentInteractions ?? []).slice(0, 5).map((touch: any) => ({
            title: accountsById.get(touch.account_id) ?? "HPO account",
            meta: `${touch.interaction_type} · ${dateLabel(touch.occurred_at)}`,
            detail: touch.summary,
          }))}
        />
        <DashboardList
          title="Route prep"
          icon={MapPinned}
          empty="No upcoming route is loaded yet."
          rows={(data?.routes ?? []).slice(0, 5).map((route: any) => ({
            title: route.area || "HPO route",
            meta: `${dateLabel(route.route_date)} · ${route.status}`,
          }))}
        />
      </section>

      <PerformanceSnapshot data={data} />
    </div>
  );
}

function DashboardList({ title, icon: Icon, rows, empty }: { title: string; icon: typeof BriefcaseBusiness; rows: Array<{ title: string; meta: string; detail?: string }>; empty: string }) {
  return (
    <section className="emery-glass rounded-[1.55rem] p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {rows.length ? (
        <div className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <div key={`${row.title}-${index}`} className="emery-surface rounded-2xl px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{row.title}</p>
                <span className="shrink-0 text-[10px] text-muted-foreground">{row.meta}</span>
              </div>
              {row.detail ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.detail}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function PerformanceSnapshot({ data }: { data: any }) {
  const metrics = data?.metrics;
  const items = [
    ["Referrals", metrics?.referrals ?? 0],
    ["Entered care", metrics?.enteredCare ?? 0],
    ["Progressing", metrics?.progressing ?? 0],
    ["Blocked / exception", metrics?.blocked ?? 0],
    ["Relationship impact", metrics?.relationshipImpact ?? 0],
  ];
  return (
    <section className="emery-glass rounded-[1.55rem] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Sales & referral signals</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {metrics?.hasData ? `Latest period ending ${dateLabel(metrics.periodEnd)}` : "Ready for aggregate sales/referral data — no patient-level PHI."}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={String(label)} className="emery-surface rounded-2xl p-3">
            <p className="text-[10px] leading-4 text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AccountsView({ data, onAdd }: { data: any; onAdd: () => void }) {
  const accounts = data?.accounts ?? [];
  if (!accounts.length)
    return (
      <div className="emery-glass rounded-[1.6rem]">
        <EmptyState icon={UsersRound} title="Ready for your account list" description="Add the first account now, or stage your existing NJ account data for import later." />
        <div className="flex justify-center pb-6">
          <button type="button" onClick={onAdd} className="emery-press min-h-11 rounded-2xl bg-primary px-4 text-xs font-semibold text-primary-foreground">Add first account</button>
        </div>
      </div>
    );
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-sm font-semibold">Accounts</p>
          <p className="text-xs text-muted-foreground">{accounts.length} active relationship records</p>
        </div>
        <button type="button" onClick={onAdd} className="emery-press flex min-h-11 items-center gap-2 rounded-2xl border border-primary/20 bg-primary/[0.055] px-3 text-xs font-semibold text-primary"><Plus className="size-3.5" /> Add</button>
      </div>
      {accounts.map((account: any) => (
        <div key={account.id} className="emery-glass rounded-[1.45rem] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{account.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{[account.account_type, account.specialty, account.city].filter(Boolean).join(" · ") || "Relationship account"}</p>
            </div>
            <span className="emery-chip shrink-0">P{account.priority}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="emery-surface rounded-xl p-2.5"><span className="text-muted-foreground">Stage</span><p className="mt-1 font-medium capitalize">{account.relationship_stage}</p></div>
            <div className="emery-surface rounded-xl p-2.5"><span className="text-muted-foreground">Last touch</span><p className="mt-1 font-medium">{account.last_touch_at ? dateLabel(account.last_touch_at) : "Not yet"}</p></div>
          </div>
          <div className="mt-3 rounded-xl border border-border/45 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next relationship action</p>
            <p className="mt-1 text-sm">{account.next_action || "Not set yet"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RelationshipsView({ data, accountsById, onLog }: { data: any; accountsById: Map<string, string>; onLog: () => void }) {
  const interactions = data?.recentInteractions ?? [];
  return (
    <section className="emery-glass rounded-[1.6rem] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Relationship timeline</p>
          <p className="mt-1 text-xs text-muted-foreground">Visits, calls, lunches and meaningful touches feed the next relationship action.</p>
        </div>
        <button type="button" onClick={onLog} className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-2xl border border-primary/20 bg-primary/[0.055] px-3 text-xs font-semibold text-primary"><Plus className="size-3.5" /> Log</button>
      </div>
      {interactions.length ? (
        <div className="mt-4 space-y-2">
          {interactions.map((item: any) => (
            <div key={item.id} className="emery-surface rounded-2xl p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-semibold">{accountsById.get(item.account_id) ?? "HPO account"}</p><p className="mt-0.5 text-[11px] capitalize text-primary">{item.interaction_type}</p></div>
                <span className="text-[10px] text-muted-foreground">{dateLabel(item.occurred_at)}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.summary}</p>
              {item.next_action ? <p className="mt-2 text-xs"><span className="text-muted-foreground">Next:</span> {item.next_action}</p> : null}
            </div>
          ))}
        </div>
      ) : <p className="mt-4 text-sm leading-6 text-muted-foreground">No relationship touches have been logged yet. Once your marketing history is imported, this becomes the relationship timeline.</p>}
    </section>
  );
}

function RoutesView({ data }: { data: any }) {
  const routes = data?.routes ?? [];
  return routes.length ? (
    <div className="space-y-2">{routes.map((route: any) => <div key={route.id} className="emery-glass rounded-[1.45rem] p-4"><div className="flex items-center gap-3"><div className="emery-icon-well flex size-10 items-center justify-center rounded-2xl text-primary"><Compass className="size-4" /></div><div><p className="text-sm font-semibold">{route.area || "HPO field route"}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(route.route_date)} · {route.status}</p></div></div></div>)}</div>
  ) : <EmptyState icon={MapPinned} title="Routes are ready" description="Your existing route history can be imported here, then Route Agent can work from verified account addresses and priorities." />;
}

function PerformanceView({ data }: { data: any }) { return <PerformanceSnapshot data={data} />; }

function EventsView({ data }: { data: any }) {
  const events = data?.hpoMeetings ?? [];
  return events.length ? <div className="space-y-2">{events.map((event: any) => <div key={event.id} className="emery-glass rounded-[1.45rem] p-4"><p className="text-sm font-semibold">{event.title || "HPO event"}</p><p className="mt-1 text-xs text-muted-foreground">{dateTimeLabel(event.meeting_at)}</p></div>)}</div> : <EmptyState icon={CalendarDays} title="No HPO events linked yet" description="Work lunches, dinners and meetings stay in Emery’s meeting system and appear here when tagged to HPO." />;
}

function ActivityView({ data, accountsById }: { data: any; accountsById: Map<string, string> }) {
  return <RelationshipsView data={data} accountsById={accountsById} onLog={() => { window.location.href = "/chat?prefill=I%20need%20to%20log%20an%20HPO%20relationship%20update%3A%20"; }} />;
}

function TasksView({ data }: { data: any }) {
  const tasks = data?.hpoTasks ?? [];
  return tasks.length ? <div className="space-y-2">{tasks.map((task: any) => <Link key={task.id} to="/tasks" className="emery-glass emery-press block rounded-[1.45rem] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{task.title}</p>{task.details ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.details}</p> : null}</div><ArrowRight className="size-4 shrink-0 text-muted-foreground" /></div><p className="mt-2 text-[11px] text-muted-foreground">Priority {task.priority} · {task.due_at ? `due ${dateLabel(task.due_at)}` : "no due date"}</p></Link>)}</div> : <EmptyState icon={CheckCircle2} title="No HPO tasks yet" description="HPO does not create a second task system. Work tasks stay in your global Tasks and surface here when linked to HPO." />;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"><div className="emery-glass-strong max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-[2rem] sm:p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold tracking-tight">{title}</h2><button type="button" onClick={onClose} className="emery-press min-h-11 rounded-2xl px-3 text-xs font-semibold text-muted-foreground">Cancel</button></div><div className="mt-4">{children}</div></div></div>;
}

const fieldClass = "min-h-12 w-full rounded-2xl border border-border/60 bg-card/65 px-3.5 text-[16px] outline-none transition focus:border-primary/35 sm:text-sm";
const textareaClass = "min-h-24 w-full rounded-2xl border border-border/60 bg-card/65 px-3.5 py-3 text-[16px] outline-none transition focus:border-primary/35 sm:text-sm";

function AccountModal({ onClose, onSave }: { onClose: () => void; onSave: (payload: any) => Promise<void> }) {
  const [name, setName] = useState(""); const [type, setType] = useState(""); const [city, setCity] = useState(""); const [notes, setNotes] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  return <ModalShell title="Add HPO account" onClose={onClose}><form onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; setSaving(true); setError(null); try { await onSave({ name, accountType: type, city, notes }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't save account."); setSaving(false); } }} className="space-y-3"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account / office name" className={fieldClass} autoFocus /><input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type — PCP, attorney, OB/GYN…" className={fieldClass} /><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={fieldClass} /><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Relationship context or notes" className={textareaClass} />{error ? <p className="text-sm text-destructive">{error}</p> : null}<button disabled={saving || !name.trim()} className="emery-press min-h-12 w-full rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">{saving ? "Saving…" : "Save account"}</button></form></ModalShell>;
}

function InteractionModal({ accounts, onClose, onSave }: { accounts: any[]; onClose: () => void; onSave: (payload: any) => Promise<void> }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? ""); const [type, setType] = useState("visit"); const [summary, setSummary] = useState(""); const [outcome, setOutcome] = useState(""); const [nextAction, setNextAction] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  return <ModalShell title="Log HPO relationship touch" onClose={onClose}>{accounts.length ? <form onSubmit={async (e) => { e.preventDefault(); if (!accountId || !summary.trim()) return; setSaving(true); setError(null); try { await onSave({ accountId, interactionType: type, summary, outcome, nextAction }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't log touch."); setSaving(false); } }} className="space-y-3"><select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={fieldClass}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><select value={type} onChange={(e) => setType(e.target.value)} className={fieldClass}><option value="visit">Office visit</option><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="event">Event</option><option value="other">Other</option></select><textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened?" className={textareaClass} /><input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Outcome / opportunity" className={fieldClass} /><input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Next relationship action" className={fieldClass} />{error ? <p className="text-sm text-destructive">{error}</p> : null}<button disabled={saving || !summary.trim()} className="emery-press min-h-12 w-full rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">{saving ? "Saving…" : "Log relationship touch"}</button></form> : <div><p className="text-sm leading-6 text-muted-foreground">Add or import an account before logging a relationship touch.</p><button type="button" onClick={onClose} className="mt-4 min-h-11 rounded-2xl border border-border/60 px-4 text-sm">Close</button></div>}</ModalShell>;
}

function ImportModal({ onClose, onSave }: { onClose: () => void; onSave: (payload: any) => Promise<void> }) {
  const [sourceType, setSourceType] = useState("spreadsheet"); const [sourceName, setSourceName] = useState(""); const [notes, setNotes] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  return <ModalShell title="Stage HPO data source" onClose={onClose}><form onSubmit={async (e) => { e.preventDefault(); setSaving(true); setError(null); try { await onSave({ sourceType, sourceName, notes }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't stage import."); setSaving(false); } }} className="space-y-3"><select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={fieldClass}><option value="spreadsheet">Spreadsheet / CSV</option><option value="chatgpt_history">ChatGPT marketing history</option><option value="marketing_notes">Marketing notes</option><option value="route_history">Route history</option><option value="manual">Manual source</option></select><input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="Source name or file name" className={fieldClass} /><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What data will this source contain?" className={textareaClass} />{error ? <p className="text-sm text-destructive">{error}</p> : null}<button disabled={saving} className="emery-press min-h-12 w-full rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">{saving ? "Staging…" : "Stage source"}</button></form></ModalShell>;
}
