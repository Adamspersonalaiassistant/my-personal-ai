import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  List,
  Plus,
  Rows3,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { setTaskCompleted } from "@/lib/emery.functions";
import {
  createLinkedMeeting,
  createLinkedTask,
  listProjectOptions,
  listUnifiedMeetings,
  listUnifiedTasks,
  rescheduleMeeting,
  scheduleTask,
} from "@/lib/os.functions";

export const Route = createFileRoute("/_authenticated/calendar")({ component: CalendarPage });

type CalendarView = "agenda" | "day" | "3day" | "month";
type AddKind = "task" | "event";

type Task = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  priority: number;
  due_at: string | null;
  completed_at: string | null;
  project_id: string | null;
  project_name: string | null;
  metadata: unknown;
  created_at: string;
};

type Meeting = {
  id: string;
  title: string | null;
  meeting_at: string | null;
  participants: unknown;
  summary: string | null;
  project_id: string | null;
  project_name: string | null;
  created_at: string;
};

type ProjectOption = { id: string; name: string; priority: number; status: string };
type CalendarItem =
  | { kind: "task"; id: string; title: string; at: string; task: Task }
  | { kind: "event"; id: string; title: string; at: string; meeting: Meeting };

const DAY_START = 7;
const DAY_END = 23;
const HOUR_HEIGHT = 76;

function dayStart(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(date: Date, amount: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}
function dateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function sameDay(a: Date | string, b: Date | string) {
  return dateKey(a) === dateKey(b);
}
function startOfWeek(date: Date) {
  const copy = dayStart(date);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}
function isDateOnlyTask(task: Task) {
  const metadata = task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
    ? task.metadata as Record<string, unknown>
    : {};
  return Boolean(metadata["due_date_only"]);
}
function formatClock(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function inputLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CalendarPage() {
  const loadTasks = useServerFn(listUnifiedTasks);
  const loadMeetings = useServerFn(listUnifiedMeetings);
  const loadProjects = useServerFn(listProjectOptions);
  const addTask = useServerFn(createLinkedTask);
  const addMeeting = useServerFn(createLinkedMeeting);
  const toggleTask = useServerFn(setTaskCompleted);
  const moveTask = useServerFn(scheduleTask);
  const moveMeeting = useServerFn(rescheduleMeeting);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [view, setView] = useState<CalendarView>("day");
  const [selectedDate, setSelectedDate] = useState(() => dayStart(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addKind, setAddKind] = useState<AddKind>("task");
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [when, setWhen] = useState("");
  const [priority, setPriority] = useState(3);
  const [projectId, setProjectId] = useState("");
  const [participants, setParticipants] = useState("");

  const gridRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    const [taskResult, meetingResult] = await Promise.all([loadTasks({}), loadMeetings({})]);
    setTasks((taskResult?.tasks ?? []) as Task[]);
    setMeetings((meetingResult?.meetings ?? []) as Meeting[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [taskResult, meetingResult, projectResult] = await Promise.all([
          loadTasks({}),
          loadMeetings({}),
          loadProjects({}),
        ]);
        if (cancelled) return;
        setTasks((taskResult?.tasks ?? []) as Task[]);
        setMeetings((meetingResult?.meetings ?? []) as Meeting[]);
        setProjects((projectResult?.projects ?? []) as ProjectOption[]);
      } catch {
        if (!cancelled) setError("Couldn't load your calendar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadMeetings, loadProjects, loadTasks]);

  useEffect(() => {
    if (view !== "day" || !gridRef.current || !sameDay(selectedDate, new Date())) return;
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    if (hour < DAY_START || hour > DAY_END) return;
    const top = (hour - DAY_START) * HOUR_HEIGHT;
    gridRef.current.scrollTo({ top: Math.max(0, top - 170), behavior: "smooth" });
  }, [selectedDate, view]);

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== "completed"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.status === "completed"), [tasks]);
  const unscheduled = openTasks.filter((task) => !task.due_at);

  const items = useMemo<CalendarItem[]>(() => {
    const taskItems: CalendarItem[] = openTasks
      .filter((task) => Boolean(task.due_at))
      .map((task) => ({ kind: "task", id: task.id, title: task.title, at: task.due_at!, task }));
    const meetingItems: CalendarItem[] = meetings
      .filter((meeting) => Boolean(meeting.meeting_at))
      .map((meeting) => ({ kind: "event", id: meeting.id, title: meeting.title || "Untitled event", at: meeting.meeting_at!, meeting }));
    return [...taskItems, ...meetingItems].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [meetings, openTasks]);

  const weekStart = startOfWeek(selectedDate);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  function moveSelection(delta: number) {
    if (view === "month") {
      const next = new Date(selectedDate);
      next.setMonth(next.getMonth() + delta);
      setSelectedDate(dayStart(next));
      return;
    }
    setSelectedDate(addDays(selectedDate, view === "3day" ? delta * 3 : delta));
  }

  async function handleToggle(task: Task) {
    const completed = task.status !== "completed";
    setTasks((current) => current.map((item) => item.id === task.id
      ? { ...item, status: completed ? "completed" : "inbox", completed_at: completed ? new Date().toISOString() : null }
      : item));
    try {
      await toggleTask({ data: { id: task.id, completed } });
    } catch {
      setError("Couldn't update that task.");
      await refresh();
    }
  }

  function openEditor(item: CalendarItem) {
    setEditing(item);
    setRescheduleValue(inputLocal(new Date(item.at)));
  }

  async function saveReschedule() {
    if (!editing || !rescheduleValue || saving) return;
    setSaving(true);
    setError(null);
    try {
      const iso = new Date(rescheduleValue).toISOString();
      if (editing.kind === "task") await moveTask({ data: { id: editing.id, dueAt: iso } });
      else await moveMeeting({ data: { id: editing.id, meetingAt: iso } });
      setEditing(null);
      await refresh();
    } catch {
      setError("Couldn't move that calendar item.");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setTitle(""); setDetails(""); setWhen(""); setPriority(3); setProjectId(""); setParticipants("");
  }

  function openAddFor(date = selectedDate) {
    const defaultTime = new Date(date);
    if (sameDay(date, new Date())) {
      const now = new Date();
      defaultTime.setHours(Math.min(DAY_END - 1, Math.max(DAY_START, now.getHours() + 1)), 0, 0, 0);
    } else {
      defaultTime.setHours(9, 0, 0, 0);
    }
    setWhen(inputLocal(defaultTime));
    setShowAdd(true);
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    if (addKind === "event" && !when) return;
    setSaving(true);
    setError(null);
    try {
      if (addKind === "task") {
        await addTask({ data: {
          title,
          details,
          dueAt: when ? new Date(when).toISOString() : null,
          priority,
          projectId: projectId || null,
        }});
      } else {
        await addMeeting({ data: {
          title,
          meetingAt: new Date(when).toISOString(),
          participants: participants.split(",").map((value) => value.trim()).filter(Boolean),
          projectId: projectId || null,
        }});
      }
      resetForm();
      setShowAdd(false);
      await refresh();
    } catch {
      setError("Couldn't add that calendar item.");
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = selectedDate.toLocaleDateString([], { month: "long", year: "numeric" });
  const viewLabel = view === "3day" ? "3-Day" : view.charAt(0).toUpperCase() + view.slice(1);

  return (
    <AppShell
      title="Calendar"
      padded={false}
      askEmery="I'm in Calendar. Help me plan realistic time blocks around my meetings, priorities, and open tasks. If something is unscheduled, help me decide when it should happen."
    >
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="shrink-0 border-b border-border/35 bg-background/96">
          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
            <button
              type="button"
              onClick={() => setShowViewMenu(true)}
              className="emery-press flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-1 text-left"
            >
              <CalendarDays className="size-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="truncate text-[20px] font-semibold tracking-[-0.03em]">{monthLabel}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{viewLabel} view</p>
              </div>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSelectedDate(dayStart(new Date()))} className="emery-press min-h-10 rounded-xl px-3 text-xs font-semibold text-primary">Today</button>
              <button type="button" onClick={() => openAddFor()} className="emery-press flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Add calendar item">
                <Plus className="size-5" />
              </button>
            </div>
          </div>

          {view !== "month" ? (
            <div className="flex items-center border-t border-border/20 px-1">
              <button type="button" onClick={() => moveSelection(-1)} className="flex size-10 shrink-0 items-center justify-center text-muted-foreground"><ChevronLeft className="size-4" /></button>
              <div className="grid min-w-0 flex-1 grid-cols-7">
                {weekDates.map((date) => {
                  const selected = sameDay(date, selectedDate);
                  const today = sameDay(date, new Date());
                  return (
                    <button
                      type="button"
                      key={dateKey(date)}
                      onClick={() => setSelectedDate(dayStart(date))}
                      className="emery-press flex min-h-[58px] flex-col items-center justify-center gap-1"
                    >
                      <span className="text-[9px] font-semibold uppercase text-muted-foreground">{date.toLocaleDateString([], { weekday: "narrow" })}</span>
                      <span className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold ${selected ? "bg-primary text-primary-foreground" : today ? "text-primary" : "text-foreground"}`}>{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => moveSelection(1)} className="flex size-10 shrink-0 items-center justify-center text-muted-foreground"><ChevronRight className="size-4" /></button>
            </div>
          ) : null}

          {unscheduled.length ? (
            <div className="flex items-center justify-between border-t border-border/25 px-4 py-2">
              <button type="button" onClick={() => setView("agenda")} className="text-left">
                <p className="text-[11px] font-semibold">Needs scheduling · {unscheduled.length}</p>
                <p className="text-[10px] text-muted-foreground">Ask Emery when these should happen.</p>
              </button>
              <List className="size-4 text-primary" />
            </div>
          ) : null}
        </header>

        {error ? <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div> : null}

        <div className="min-h-0 flex-1">
          {loading ? <CalendarSkeleton /> : null}
          {!loading && view === "agenda" ? (
            <AgendaView items={items} unscheduled={unscheduled} completed={completedTasks} onToggle={handleToggle} onOpen={openEditor} />
          ) : null}
          {!loading && view === "day" ? (
            <DayGrid ref={gridRef} dates={[selectedDate]} items={items} onOpen={openEditor} onToggle={handleToggle} />
          ) : null}
          {!loading && view === "3day" ? (
            <DayGrid dates={[selectedDate, addDays(selectedDate, 1), addDays(selectedDate, 2)]} items={items} onOpen={openEditor} onToggle={handleToggle} />
          ) : null}
          {!loading && view === "month" ? (
            <MonthView selectedDate={selectedDate} items={items} onSelect={(date) => { setSelectedDate(date); setView("day"); }} onPrev={() => moveSelection(-1)} onNext={() => moveSelection(1)} />
          ) : null}
        </div>

        {showViewMenu ? (
          <div className="fixed inset-0 z-[90] flex items-end bg-black/55 backdrop-blur-sm" onClick={() => setShowViewMenu(false)}>
            <div className="emery-sheet-in w-full rounded-t-[1.6rem] border-t border-border/50 bg-[oklch(0.125_0.034_255/0.99)] p-3 pb-[max(0.8rem,env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/12" />
              <p className="px-2 py-2 text-sm font-semibold">Calendar view</p>
              {([
                ["agenda", "Agenda", List],
                ["day", "Day", CalendarDays],
                ["3day", "3-Day", Rows3],
                ["month", "Month", CalendarDays],
              ] as const).map(([value, label, Icon]) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => { setView(value); setShowViewMenu(false); }}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left ${view === value ? "bg-primary/[0.09] text-primary" : "text-foreground"}`}
                >
                  <Icon className="size-5" />
                  <span className="text-sm font-medium">{label}</span>
                  {view === value ? <Check className="ml-auto size-4" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showAdd ? (
          <div className="fixed inset-0 z-[90] flex items-end bg-black/60 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
            <form onSubmit={handleAdd} onClick={(event) => event.stopPropagation()} className="emery-sheet-in w-full rounded-t-[1.6rem] border-t border-border/50 bg-[oklch(0.125_0.034_255/0.99)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/12" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold">Add to Calendar</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Tasks and commitments live together.</p>
                </div>
                <button type="button" onClick={() => setShowAdd(false)} className="flex size-10 items-center justify-center rounded-xl text-muted-foreground"><X className="size-4" /></button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-card/45 p-1">
                <button type="button" onClick={() => setAddKind("task")} className={`min-h-10 rounded-lg text-xs font-semibold ${addKind === "task" ? "bg-primary/[0.12] text-primary" : "text-muted-foreground"}`}>Task</button>
                <button type="button" onClick={() => setAddKind("event")} className={`min-h-10 rounded-lg text-xs font-semibold ${addKind === "event" ? "bg-primary/[0.12] text-primary" : "text-muted-foreground"}`}>Event / Meeting</button>
              </div>

              <div className="mt-3 space-y-3">
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={addKind === "task" ? "What needs to happen?" : "What's happening?"} className="min-h-12 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[16px] outline-none focus:border-primary/40" autoFocus />
                {addKind === "task" ? (
                  <textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={2} placeholder="Notes (optional)" className="w-full rounded-xl border border-border/55 bg-card/45 px-3.5 py-3 text-[16px] outline-none" />
                ) : (
                  <input value={participants} onChange={(event) => setParticipants(event.target.value)} placeholder="People, separated by commas" className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[16px] outline-none" />
                )}
                <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none" />
                {addKind === "task" ? (
                  <select value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none">
                    <option value={5}>Highest priority</option><option value={4}>High priority</option><option value={3}>Normal priority</option><option value={2}>Low priority</option><option value={1}>Someday</option>
                  </select>
                ) : null}
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none">
                  <option value="">No linked project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <button type="submit" disabled={!title.trim() || saving || (addKind === "event" && !when)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-40">
                  <Check className="size-4" /> {saving ? "Saving…" : "Add to Calendar"}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {editing ? (
          <div className="fixed inset-0 z-[90] flex items-end bg-black/60 backdrop-blur-sm" onClick={() => setEditing(null)}>
            <div className="emery-sheet-in w-full rounded-t-[1.6rem] border-t border-border/50 bg-[oklch(0.125_0.034_255/0.99)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/12" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold">{editing.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{editing.kind === "task" ? "Task" : "Event"} · {new Date(editing.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                <button type="button" onClick={() => setEditing(null)} className="flex size-10 items-center justify-center rounded-xl text-muted-foreground"><X className="size-4" /></button>
              </div>
              <label className="mt-4 block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Move to</span>
                <input type="datetime-local" value={rescheduleValue} onChange={(event) => setRescheduleValue(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[15px] outline-none" />
              </label>
              <button type="button" onClick={() => void saveReschedule()} disabled={saving || !rescheduleValue} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-40">{saving ? "Moving…" : "Move item"}</button>
              {editing.kind === "task" ? (
                <button type="button" onClick={() => { void handleToggle(editing.task); setEditing(null); }} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border/50 text-sm font-semibold">
                  <CheckCircle2 className="size-4" /> Mark complete
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function CalendarSkeleton() {
  return <div className="h-full animate-pulse bg-[linear-gradient(to_bottom,transparent_0,transparent_75px,rgba(255,255,255,.03)_76px)] bg-[length:100%_76px]" />;
}

function AgendaView({
  items,
  unscheduled,
  completed,
  onToggle,
  onOpen,
}: {
  items: CalendarItem[];
  unscheduled: Task[];
  completed: Task[];
  onToggle: (task: Task) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  const future = items.filter((item) => new Date(item.at).getTime() >= dayStart(new Date()).getTime());
  const groups = new Map<string, CalendarItem[]>();
  for (const item of future) {
    const key = dateKey(item.at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div className="emery-scrollbar h-full overflow-y-auto overscroll-contain px-4 py-4">
      {unscheduled.length ? (
        <section className="mb-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Needs scheduling</p>
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/30">
            {unscheduled.map((task, index) => (
              <div key={task.id} className={`flex min-h-14 items-center gap-2 px-3 ${index ? "border-t border-border/30" : ""}`}>
                <button type="button" onClick={() => void onToggle(task)} className="flex size-10 items-center justify-center text-muted-foreground"><Circle className="size-5" /></button>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p><p className="text-[10px] text-muted-foreground">Ask Emery to schedule this</p></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {[...groups.entries()].map(([key, dayItems]) => {
        const date = new Date(`${key}T12:00:00`);
        return (
          <section key={key} className="mb-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</p>
            <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/25">
              {dayItems.map((item, index) => (
                <button type="button" key={item.kind + item.id} onClick={() => onOpen(item)} className={`flex min-h-16 w-full items-center gap-3 px-3 text-left ${index ? "border-t border-border/30" : ""}`}>
                  <span className="w-14 shrink-0 text-xs font-semibold text-primary">{formatClock(item.at)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span><span className="text-[10px] text-muted-foreground">{item.kind === "task" ? "Task" : "Event"}</span></span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {completed.length ? <p className="pb-4 text-center text-[10px] text-muted-foreground">{completed.length} completed task{completed.length === 1 ? "" : "s"}</p> : null}
    </div>
  );
}

const DayGrid = ({
  dates,
  items,
  onOpen,
  onToggle,
}: {
  dates: Date[];
  items: CalendarItem[];
  onOpen: (item: CalendarItem) => void;
  onToggle: (task: Task) => void;
}, ref: React.ForwardedRef<HTMLDivElement>) => {
  const hours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, index) => DAY_START + index);
  const dateOnlyTasks = items.filter((item) => item.kind === "task" && isDateOnlyTask(item.task) && dates.some((date) => sameDay(date, item.at)));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/30 bg-background/96">
        <div className="grid" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))` }}>
          <div className="px-2 py-2 text-[9px] font-semibold uppercase text-muted-foreground">All day</div>
          {dates.map((date) => (
            <div key={dateKey(date)} className="min-h-11 border-l border-border/25 p-1">
              {dateOnlyTasks.filter((item) => sameDay(date, item.at)).map((item) => (
                <button key={item.id} type="button" onClick={() => onOpen(item)} className="w-full truncate rounded-md bg-primary/15 px-2 py-1 text-left text-[10px] font-semibold text-primary">{item.title}</button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div ref={ref} className="emery-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative" style={{ height: `${(DAY_END - DAY_START + 1) * HOUR_HEIGHT}px` }}>
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))` }}>
            <div>
              {hours.map((hour) => <div key={hour} className="relative border-b border-border/25 pr-2 text-right text-[10px] text-muted-foreground" style={{ height: HOUR_HEIGHT }}><span className="-translate-y-1/2 inline-block">{new Date(2000,0,1,hour).toLocaleTimeString([], { hour: "numeric" })}</span></div>)}
            </div>
            {dates.map((date) => (
              <div key={dateKey(date)} className="relative border-l border-border/30">
                {hours.map((hour) => <div key={hour} className="border-b border-border/25" style={{ height: HOUR_HEIGHT }}><div className="h-1/2 border-b border-dashed border-border/15" /></div>)}
                {itemsForDate(items, date).filter((item) => !(item.kind === "task" && isDateOnlyTask(item.task))).map((item) => {
                  const time = new Date(item.at);
                  const hour = time.getHours() + time.getMinutes() / 60;
                  if (hour < DAY_START || hour > DAY_END) return null;
                  const top = (hour - DAY_START) * HOUR_HEIGHT + 2;
                  const height = item.kind === "event" ? 54 : 42;
                  return (
                    <button
                      type="button"
                      key={item.kind + item.id}
                      onClick={() => onOpen(item)}
                      className={`absolute left-1 right-1 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm ${item.kind === "event" ? "border-primary/30 bg-primary/20" : "border-border/50 bg-card/95"}`}
                      style={{ top, minHeight: height }}
                    >
                      <span className="block truncate text-[11px] font-semibold">{item.title}</span>
                      <span className="mt-0.5 block text-[9px] text-muted-foreground">{formatClock(item.at)} · {item.kind === "task" ? "Task" : "Event"}</span>
                    </button>
                  );
                })}
                {sameDay(date, new Date()) ? <CurrentTimeLine /> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      {dates.length === 1 ? (
        <div className="shrink-0 border-t border-border/30 bg-background/96 px-3 py-2">
          <button type="button" onClick={() => { const firstTask = itemsForDate(items, dates[0]).find((item) => item.kind === "task"); if (firstTask?.kind === "task") void onToggle(firstTask.task); }} className="text-[10px] font-medium text-muted-foreground">Tap any block to move it. Tasks can also be completed from their detail sheet.</button>
        </div>
      ) : null}
    </div>
  );
};

const ForwardDayGrid = ReactForward(DayGrid);

function ReactForward<T, P>(render: (props: P, ref: React.ForwardedRef<T>) => React.ReactNode) {
  return (requireForwardRef(render) as unknown) as React.ForwardRefExoticComponent<P & React.RefAttributes<T>>;
}
function requireForwardRef<T, P>(render: (props: P, ref: React.ForwardedRef<T>) => React.ReactNode) {
  // isolated helper so the component stays readable while using React's forwardRef
  return (awaitForwardRef as any)(render);
}
const awaitForwardRef = (globalThis as any).__REACT_FORWARD_REF__;

function CurrentTimeLine() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < DAY_START || hour > DAY_END) return null;
  const top = (hour - DAY_START) * HOUR_HEIGHT;
  return <div className="pointer-events-none absolute left-0 right-0 z-20 border-t border-primary" style={{ top }}><span className="absolute -left-1 -top-1 size-2 rounded-full bg-primary" /></div>;
}

function itemsForDate(items: CalendarItem[], date: Date) {
  return items.filter((item) => sameDay(item.at, date));
}

function MonthView({
  selectedDate,
  items,
  onSelect,
  onPrev,
  onNext,
}: {
  selectedDate: Date;
  items: CalendarItem[];
  onSelect: (date: Date) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  return (
    <div className="emery-scrollbar h-full overflow-y-auto px-3 py-3">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={onPrev} className="flex size-10 items-center justify-center rounded-xl text-muted-foreground"><ChevronLeft className="size-5" /></button>
        <p className="text-base font-semibold">{selectedDate.toLocaleDateString([], { month: "long", year: "numeric" })}</p>
        <button type="button" onClick={onNext} className="flex size-10 items-center justify-center rounded-xl text-muted-foreground"><ChevronRight className="size-5" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[9px] font-semibold uppercase text-muted-foreground">
        {["S","M","T","W","T","F","S"].map((day, index) => <div key={day + index} className="py-2">{day}</div>)}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-border/35">
        {days.map((date) => {
          const dayItems = itemsForDate(items, date);
          const inMonth = date.getMonth() === selectedDate.getMonth();
          const today = sameDay(date, new Date());
          return (
            <button type="button" key={dateKey(date)} onClick={() => onSelect(dayStart(date))} className={`relative min-h-[72px] border-b border-r border-border/25 p-1.5 text-left ${inMonth ? "bg-card/18" : "bg-black/10 text-muted-foreground"}`}>
              <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ${today ? "bg-primary text-primary-foreground" : ""}`}>{date.getDate()}</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dayItems.slice(0, 3).map((item) => <span key={item.kind + item.id} className={`size-1.5 rounded-full ${item.kind === "event" ? "bg-primary" : "bg-muted-foreground"}`} />)}
                {dayItems.length > 3 ? <span className="text-[8px] text-muted-foreground">+{dayItems.length - 3}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { ForwardDayGrid as __unusedForwardDayGrid };
