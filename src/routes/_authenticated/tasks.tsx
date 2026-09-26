import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FolderKanban,
  ListTodo,
  Plus,
  Sparkles,
  Users,
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
} from "@/lib/os.functions";

export const Route = createFileRoute("/_authenticated/tasks")({ component: CalendarWorkspace });

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
type View = "today" | "week" | "inbox" | "completed";
type AddKind = "task" | "event";

function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function CalendarWorkspace() {
  const loadTasks = useServerFn(listUnifiedTasks);
  const loadMeetings = useServerFn(listUnifiedMeetings);
  const loadProjects = useServerFn(listProjectOptions);
  const addTask = useServerFn(createLinkedTask);
  const addMeeting = useServerFn(createLinkedMeeting);
  const toggleTask = useServerFn(setTaskCompleted);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("today");
  const [showAdd, setShowAdd] = useState(false);
  const [addKind, setAddKind] = useState<AddKind>("task");

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [when, setWhen] = useState("");
  const [priority, setPriority] = useState(3);
  const [projectId, setProjectId] = useState("");
  const [participants, setParticipants] = useState("");

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
    return () => {
      cancelled = true;
    };
  }, [loadMeetings, loadProjects, loadTasks]);

  const openTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "completed")
        .sort((a, b) => {
          if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
          if (a.due_at) return -1;
          if (b.due_at) return 1;
          return b.priority - a.priority;
        }),
    [tasks],
  );

  const completedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status === "completed")
        .sort(
          (a, b) =>
            new Date(b.completed_at ?? b.created_at).getTime() -
            new Date(a.completed_at ?? a.created_at).getTime(),
        ),
    [tasks],
  );

  const unscheduled = openTasks.filter((task) => !task.due_at);
  const today = startOfToday();
  const todayKey = localDateKey(today);
  const weekEnd = endOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6));

  const todayTasks = openTasks.filter((task) => task.due_at && localDateKey(task.due_at) === todayKey);
  const todayMeetings = meetings
    .filter((meeting) => meeting.meeting_at && localDateKey(meeting.meeting_at) === todayKey)
    .sort((a, b) => new Date(a.meeting_at ?? 0).getTime() - new Date(b.meeting_at ?? 0).getTime());

  const weekItems = useMemo(() => {
    const byDay = new Map<string, { tasks: Task[]; meetings: Meeting[] }>();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      byDay.set(localDateKey(date), { tasks: [], meetings: [] });
    }
    for (const task of openTasks) {
      if (!task.due_at) continue;
      const time = new Date(task.due_at).getTime();
      if (time < today.getTime() || time > weekEnd.getTime()) continue;
      byDay.get(localDateKey(task.due_at))?.tasks.push(task);
    }
    for (const meeting of meetings) {
      if (!meeting.meeting_at) continue;
      const time = new Date(meeting.meeting_at).getTime();
      if (time < today.getTime() || time > weekEnd.getTime()) continue;
      byDay.get(localDateKey(meeting.meeting_at))?.meetings.push(meeting);
    }
    return [...byDay.entries()];
  }, [meetings, openTasks, today, weekEnd]);

  const nextCommitment = [...todayMeetings, ...todayTasks]
    .map((item) => ({
      title: "meeting_at" in item ? item.title || "Untitled event" : item.title,
      at: "meeting_at" in item ? item.meeting_at : item.due_at,
    }))
    .filter((item) => item.at && new Date(item.at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime())[0];

  async function handleToggle(task: Task) {
    const completing = task.status !== "completed";
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: completing ? "completed" : "inbox",
              completed_at: completing ? new Date().toISOString() : null,
            }
          : item,
      ),
    );
    try {
      await toggleTask({ data: { id: task.id, completed: completing } });
    } catch {
      setError("Couldn't update that task.");
      await refresh();
    }
  }

  function resetForm() {
    setTitle("");
    setDetails("");
    setWhen("");
    setPriority(3);
    setProjectId("");
    setParticipants("");
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    if (addKind === "event" && !when) {
      setError("Events need a date and time.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (addKind === "task") {
        await addTask({
          data: {
            title,
            details,
            dueAt: when ? new Date(when).toISOString() : null,
            priority,
            projectId: projectId || null,
          },
        });
      } else {
        await addMeeting({
          data: {
            title,
            meetingAt: new Date(when).toISOString(),
            participants: participants
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            projectId: projectId || null,
          },
        });
      }
      resetForm();
      setShowAdd(false);
      setView("today");
      await refresh();
    } catch {
      setError(addKind === "task" ? "Couldn't add that task." : "Couldn't add that calendar item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Calendar"
      askEmery="I'm looking at my Calendar. Help me plan when to do my open tasks around my scheduled commitments. Keep it realistic, protect high-value work, and help me choose what should happen today."
    >
      <div className="mx-auto max-w-3xl space-y-4 pb-3">
        <section className="rounded-[1.65rem] border border-primary/15 bg-primary/[0.035] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="emery-kicker">Plan the time, not just the list</p>
              <h1 className="mt-1.5 text-[1.6rem] font-semibold tracking-[-0.035em]">Calendar</h1>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
                Tasks and commitments live together so Emery can help you decide when the work actually gets done.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="size-4" />
              Add
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Today" value={todayTasks.length + todayMeetings.length} />
            <Stat label="Unscheduled" value={unscheduled.length} />
            <Stat label="Open tasks" value={openTasks.length} />
            <Stat label="Done" value={completedTasks.length} />
          </div>

          {nextCommitment ? (
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-primary/12 bg-black/10 p-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/80">Next</p>
                <p className="mt-1 truncate text-sm font-semibold">{nextCommitment.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatTime(nextCommitment.at)}</p>
              </div>
            </div>
          ) : null}
        </section>

        <div className="flex gap-1 overflow-x-auto rounded-xl bg-card/45 p-1 [scrollbar-width:none]">
          <ViewButton active={view === "today"} onClick={() => setView("today")}>Today</ViewButton>
          <ViewButton active={view === "week"} onClick={() => setView("week")}>Week</ViewButton>
          <ViewButton active={view === "inbox"} onClick={() => setView("inbox")}>Unscheduled {unscheduled.length}</ViewButton>
          <ViewButton active={view === "completed"} onClick={() => setView("completed")}>Completed</ViewButton>
        </div>

        {error ? (
          <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/30">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-[70px] animate-pulse border-b border-border/30 last:border-b-0">
                <div className="mx-4 mt-5 h-3 w-2/3 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && view === "today" ? (
          <DaySection
            title="Today"
            subtitle={new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
            tasks={todayTasks}
            meetings={todayMeetings}
            onToggle={handleToggle}
            empty="Nothing is scheduled for today yet."
          />
        ) : null}

        {!loading && view === "today" && unscheduled.length ? (
          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <p className="text-sm font-semibold">Unscheduled tasks</p>
                <p className="text-[11px] text-muted-foreground">Decide when these deserve time.</p>
              </div>
              <button type="button" onClick={() => setView("inbox")} className="text-xs font-semibold text-primary">
                View all
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
              {unscheduled.slice(0, 4).map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  divider={index < Math.min(unscheduled.length, 4) - 1}
                />
              ))}
            </div>
          </section>
        ) : null}

        {!loading && view === "week" ? (
          <div className="space-y-4">
            {weekItems.map(([key, items]) => {
              const date = new Date(`${key}T12:00:00`);
              return (
                <DaySection
                  key={key}
                  title={date.toLocaleDateString([], { weekday: "long" })}
                  subtitle={date.toLocaleDateString([], { month: "short", day: "numeric" })}
                  tasks={items.tasks}
                  meetings={items.meetings}
                  onToggle={handleToggle}
                  empty="Nothing scheduled."
                  compact
                />
              );
            })}
          </div>
        ) : null}

        {!loading && view === "inbox" ? (
          unscheduled.length ? (
            <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
              {unscheduled.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  divider={index < unscheduled.length - 1}
                />
              ))}
            </div>
          ) : (
            <Empty message="No unscheduled tasks. Everything has a place." />
          )
        ) : null}

        {!loading && view === "completed" ? (
          completedTasks.length ? (
            <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
              {completedTasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  divider={index < completedTasks.length - 1}
                  completed
                />
              ))}
            </div>
          ) : (
            <Empty message="Completed tasks will collect here." />
          )
        ) : null}
      </div>

      {showAdd ? (
        <div
          className="fixed inset-0 z-[80] flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowAdd(false)}
        >
          <form
            onSubmit={handleAdd}
            onClick={(event) => event.stopPropagation()}
            className="emery-sheet-in w-full max-w-md rounded-t-[1.6rem] border border-border/50 bg-[oklch(0.125_0.034_255/0.985)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-24px_70px_rgba(0,0,0,0.45)] sm:rounded-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/12 sm:hidden" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold">Add to Calendar</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Add work to do or a fixed commitment.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="emery-press flex size-10 items-center justify-center rounded-xl text-muted-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-card/45 p-1">
              <button
                type="button"
                onClick={() => setAddKind("task")}
                className={`min-h-10 rounded-lg text-xs font-semibold ${addKind === "task" ? "bg-primary/[0.11] text-primary" : "text-muted-foreground"}`}
              >
                Task
              </button>
              <button
                type="button"
                onClick={() => setAddKind("event")}
                className={`min-h-10 rounded-lg text-xs font-semibold ${addKind === "event" ? "bg-primary/[0.11] text-primary" : "text-muted-foreground"}`}
              >
                Event / Meeting
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={addKind === "task" ? "What needs to happen?" : "What is the commitment?"}
                className="min-h-12 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[16px] outline-none focus:border-primary/40"
                autoFocus
              />

              {addKind === "task" ? (
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                  className="w-full rounded-xl border border-border/55 bg-card/45 px-3.5 py-3 text-[16px] leading-6 outline-none focus:border-primary/40"
                />
              ) : (
                <input
                  value={participants}
                  onChange={(event) => setParticipants(event.target.value)}
                  placeholder="People, separated by commas (optional)"
                  className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[16px] outline-none focus:border-primary/40"
                />
              )}

              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
                  {addKind === "task" ? "When will you do it? (optional)" : "Date and time"}
                </span>
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none"
                />
              </label>

              {addKind === "task" ? (
                <label className="space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Priority</span>
                  <select
                    value={priority}
                    onChange={(event) => setPriority(Number(event.target.value))}
                    className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none"
                  >
                    <option value={5}>Highest</option>
                    <option value={4}>High</option>
                    <option value={3}>Normal</option>
                    <option value={2}>Low</option>
                    <option value={1}>Someday</option>
                  </select>
                </label>
              ) : null}

              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Project</span>
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none"
                >
                  <option value="">No linked project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={!title.trim() || saving || (addKind === "event" && !when)}
                className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
              >
                <Check className="size-4" />
                {saving ? "Saving…" : addKind === "task" ? "Add task" : "Add event"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/35 bg-black/10 px-3 py-2.5">
      <p className="text-lg font-semibold tracking-[-0.03em]">{value}</p>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`emery-press min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold ${active ? "bg-primary/[0.1] text-primary" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function DaySection({
  title,
  subtitle,
  tasks,
  meetings,
  onToggle,
  empty,
  compact = false,
}: {
  title: string;
  subtitle: string;
  tasks: Task[];
  meetings: Meeting[];
  onToggle: (task: Task) => void;
  empty: string;
  compact?: boolean;
}) {
  const items = [
    ...tasks.map((task) => ({ type: "task" as const, at: task.due_at, task })),
    ...meetings.map((meeting) => ({ type: "meeting" as const, at: meeting.meeting_at, meeting })),
  ].sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime());

  return (
    <section>
      <div className="mb-2 flex items-end justify-between px-1">
        <div>
          <p className={compact ? "text-sm font-semibold" : "text-base font-semibold"}>{title}</p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {items.length ? (
        <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
          {items.map((item, index) =>
            item.type === "task" ? (
              <TaskRow
                key={`task-${item.task.id}`}
                task={item.task}
                onToggle={onToggle}
                divider={index < items.length - 1}
              />
            ) : (
              <MeetingRow
                key={`meeting-${item.meeting.id}`}
                meeting={item.meeting}
                divider={index < items.length - 1}
              />
            ),
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border/35 bg-card/20 px-4 py-6 text-center text-xs text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  );
}

function TaskRow({
  task,
  onToggle,
  divider,
  completed = false,
}: {
  task: Task;
  onToggle: (task: Task) => void;
  divider: boolean;
  completed?: boolean;
}) {
  const isCompleted = completed || task.status === "completed";
  return (
    <article className={`flex min-h-[68px] items-start gap-3 px-3 py-3 ${divider ? "border-b border-border/30" : ""}`}>
      <button
        type="button"
        onClick={() => void onToggle(task)}
        aria-label={isCompleted ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className={`emery-press mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full ${isCompleted ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
      >
        {isCompleted ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
      </button>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-start gap-2">
          <p className={`min-w-0 flex-1 text-[14px] font-medium leading-5 ${isCompleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {task.title}
          </p>
          {!isCompleted && task.priority >= 4 ? <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" /> : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><ListTodo className="size-3" /> Task</span>
          {task.due_at ? <span className="inline-flex items-center gap-1"><Clock3 className="size-3" /> {formatTime(task.due_at)}</span> : null}
          {task.project_name ? <span className="inline-flex items-center gap-1"><FolderKanban className="size-3" /> {task.project_name}</span> : null}
          {task.details ? <span className="line-clamp-1 max-w-full">{task.details}</span> : null}
        </div>
      </div>
    </article>
  );
}

function MeetingRow({ meeting, divider }: { meeting: Meeting; divider: boolean }) {
  const people = Array.isArray(meeting.participants)
    ? meeting.participants.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  return (
    <article className={`flex min-h-[68px] items-start gap-3 px-3 py-3 ${divider ? "border-b border-border/30" : ""}`}>
      <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/[0.06] text-primary">
        <CalendarDays className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-[14px] font-medium leading-5">{meeting.title || "Untitled event"}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {meeting.meeting_at ? <span className="inline-flex items-center gap-1"><Clock3 className="size-3" /> {formatTime(meeting.meeting_at)}</span> : null}
          {people.length ? <span className="inline-flex items-center gap-1"><Users className="size-3" /> {people.join(", ")}</span> : null}
          {meeting.project_name ? <span className="inline-flex items-center gap-1"><FolderKanban className="size-3" /> {meeting.project_name}</span> : null}
        </div>
      </div>
    </article>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="py-14 text-center">
      <CheckCircle2 className="mx-auto size-7 text-primary/75" strokeWidth={1.7} />
      <p className="mt-3 text-sm font-medium">{message}</p>
    </div>
  );
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
