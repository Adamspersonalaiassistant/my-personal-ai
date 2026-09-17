import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, Check, CheckCircle2, Circle, FolderKanban, Plus, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { setTaskCompleted } from "@/lib/emery.functions";
import { createLinkedTask, listProjectOptions, listUnifiedTasks } from "@/lib/os.functions";

export const Route = createFileRoute("/_authenticated/tasks")({ component: Tasks });

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

type ProjectOption = { id: string; name: string; priority: number; status: string };
type Tab = "open" | "completed";

function Tasks() {
  const loadTasks = useServerFn(listUnifiedTasks);
  const loadProjects = useServerFn(listProjectOptions);
  const addTask = useServerFn(createLinkedTask);
  const toggleTask = useServerFn(setTaskCompleted);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState<Tab>("open");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState(3);
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  async function refresh() {
    const result = await loadTasks({});
    setTasks((result?.tasks ?? []) as Task[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [result, projectResult] = await Promise.all([loadTasks({}), loadProjects({})]);
        if (!cancelled) {
          setTasks((result?.tasks ?? []) as Task[]);
          setProjects((projectResult?.projects ?? []) as ProjectOption[]);
        }
      } catch {
        if (!cancelled) setError("Couldn't load your tasks.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProjects, loadTasks]);

  const open = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "completed")
        .sort((a, b) => {
          if (a.due_at && b.due_at) {
            const dueDifference = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
            if (dueDifference !== 0) return dueDifference;
          }
          if (a.due_at && !b.due_at) return -1;
          if (!a.due_at && b.due_at) return 1;
          return b.priority - a.priority;
        }),
    [tasks],
  );
  const completed = useMemo(
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
  const visible = tab === "open" ? open : completed;
  const focusTask = [...open].sort((a, b) => b.priority - a.priority)[0] ?? null;

  async function handleToggle(task: Task) {
    const completedNow = task.status !== "completed";
    setTasks((prev) =>
      prev.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: completedNow ? "completed" : "inbox",
              completed_at: completedNow ? new Date().toISOString() : null,
            }
          : item,
      ),
    );
    try {
      await toggleTask({ data: { id: task.id, completed: completedNow } });
    } catch {
      setError("Couldn't update that task.");
      await refresh();
    }
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addTask({
        data: {
          title,
          details,
          dueAt: due ? new Date(due).toISOString() : null,
          priority,
          projectId: projectId || null,
        },
      });
      setTitle("");
      setDetails("");
      setDue("");
      setPriority(3);
      setProjectId("");
      setShowAdd(false);
      setTab("open");
      await refresh();
    } catch {
      setError("Couldn't add that task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Tasks">
      <div className="mx-auto max-w-3xl pb-3">
        <div className="flex items-end justify-between gap-4 pb-4">
          <div>
            <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">Tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {open.length ? `${open.length} open${focusTask ? ` · focus: ${focusTask.title}` : ""}` : "You're clear."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="emery-press flex min-h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" />
            Add
          </button>
        </div>

        <div className="mb-4 inline-flex rounded-xl bg-card/45 p-1">
          <TabButton active={tab === "open"} onClick={() => setTab("open")}>
            Open {open.length}
          </TabButton>
          <TabButton active={tab === "completed"} onClick={() => setTab("completed")}>
            Completed {completed.length}
          </TabButton>
        </div>

        {error ? (
          <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/30">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-[68px] animate-pulse border-b border-border/30 last:border-b-0">
                <div className="mx-4 mt-5 h-3 w-2/3 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : visible.length ? (
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
            {visible.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                completed={task.status === "completed"}
                onToggle={handleToggle}
                divider={index < visible.length - 1}
              />
            ))}
          </div>
        ) : (
          <div className="py-14 text-center">
            <CheckCircle2 className="mx-auto size-7 text-primary/75" strokeWidth={1.7} />
            <p className="mt-3 text-sm font-medium">
              {tab === "open" ? "Nothing waiting on you." : "No completed tasks yet."}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
              {tab === "open"
                ? "Tell Emery what needs to get done or add it here."
                : "Completed work will collect here quietly."}
            </p>
          </div>
        )}
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
                <p className="text-base font-semibold">New task</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Capture it quickly. Refine only if needed.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="emery-press flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/[0.04]"
                aria-label="Close add task"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs to happen?"
                className="min-h-12 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[16px] outline-none focus:border-primary/40"
                autoFocus
              />
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="Notes (optional)"
                rows={2}
                className="w-full rounded-xl border border-border/55 bg-card/45 px-3.5 py-3 text-[16px] leading-6 outline-none focus:border-primary/40"
              />

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Due</span>
                  <input
                    type="datetime-local"
                    value={due}
                    onChange={(event) => setDue(event.target.value)}
                    className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none"
                  />
                </label>
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
              </div>

              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Project</span>
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none"
                >
                  <option value="">No linked project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={!title.trim() || saving}
                className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
              >
                <Check className="size-4" /> {saving ? "Adding…" : "Add task"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}

function TabButton({
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
      className={`emery-press min-h-9 rounded-lg px-3 text-xs font-semibold ${active ? "bg-primary/[0.1] text-primary" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function TaskRow({
  task,
  completed,
  onToggle,
  divider,
}: {
  task: Task;
  completed: boolean;
  onToggle: (task: Task) => void;
  divider: boolean;
}) {
  return (
    <article className={`group flex min-h-[68px] items-start gap-3 px-3 py-3 ${divider ? "border-b border-border/30" : ""}`}>
      <button
        type="button"
        onClick={() => void onToggle(task)}
        aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className={`emery-press mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full ${completed ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
      >
        {completed ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
      </button>

      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-start gap-2">
          <p className={`min-w-0 flex-1 text-[14px] font-medium leading-5 ${completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {task.title}
          </p>
          {!completed && task.priority >= 4 ? (
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" title={`Priority ${task.priority}`} />
          ) : null}
        </div>
        {(task.project_name || task.due_at || task.details) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {task.project_name ? (
              <span className="inline-flex items-center gap-1">
                <FolderKanban className="size-3" /> {task.project_name}
              </span>
            ) : null}
            {task.due_at ? (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" /> {formatDue(task)}
              </span>
            ) : null}
            {task.details ? <span className="line-clamp-1 max-w-full">{task.details}</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function formatDue(task: Task) {
  if (!task.due_at) return "";
  const date = new Date(task.due_at);
  if (Number.isNaN(date.getTime())) return "";
  const dateOnly = Boolean((task.metadata as Record<string, unknown> | null)?.["due_date_only"]);
  if (dateOnly) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
