import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Circle, Plus, Sparkles, X } from "lucide-react";
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

  const open = tasks.filter((task) => task.status !== "completed");
  const completed = tasks.filter((task) => task.status === "completed");
  const focusTask =
    [...open].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return 0;
    })[0] ?? null;

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
      await refresh();
    } catch {
      setError("Couldn't add that task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Tasks">
      <div className="space-y-5">
        <section className="emery-glass-strong rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="emery-kicker">Action system</p>
              <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.03em] sm:text-[1.35rem]">
                Your next moves, without the noise.
              </h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Keep execution visible and simple. Emery can capture new work from conversation and
                connect it to the right project.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="size-4" /> Add
            </button>
          </div>

          {focusTask ? (
            <div className="mt-4 rounded-2xl border border-primary/12 bg-primary/[0.035] p-3.5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/12 bg-primary/[0.055] text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">
                    Highest-leverage open task
                  </p>
                  <p className="mt-1 text-sm font-semibold">{focusTask.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Priority {focusTask.priority}
                    {focusTask.project_name ? ` · ${focusTask.project_name}` : ""}
                    {focusTask.due_at ? ` · ${formatDue(focusTask)}` : ""}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-border/40 bg-card/25 px-3.5 py-3 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 text-primary" /> Nothing is waiting on you right now.
            </div>
          )}
        </section>

        {error ? (
          <p
            className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="emery-glass h-20 animate-pulse rounded-[1.45rem] opacity-55"
              />
            ))}
          </div>
        ) : (
          <>
            <TaskSection title={`Open · ${open.length}`} tasks={open} onToggle={handleToggle} />
            {completed.length ? (
              <TaskSection
                title={`Completed · ${completed.length}`}
                tasks={completed}
                onToggle={handleToggle}
                completed
              />
            ) : null}
          </>
        )}
      </div>

      {showAdd ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/65 p-2 backdrop-blur-md sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowAdd(false)}
        >
          <form
            onSubmit={handleAdd}
            onClick={(event) => event.stopPropagation()}
            className="emery-glass-strong max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[1.9rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="emery-kicker">New action</p>
                <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Add task</h3>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  You can also tell Emery in the main chat and she can capture it for you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:bg-white/5"
                aria-label="Close add task"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <Field label="Task">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Send follow-up to attorney"
                  className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
                  autoFocus
                />
              </Field>
              <Field label="Details" optional>
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder="Any context Emery should keep with the task"
                  rows={3}
                  className="w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 py-3 text-[16px] leading-6 outline-none transition focus:border-primary/40 sm:text-sm"
                />
              </Field>
              <Field label="Due" optional>
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project" optional>
                  <select
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none sm:text-sm"
                  >
                    <option value="">No linked project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select
                    value={priority}
                    onChange={(event) => setPriority(Number(event.target.value))}
                    className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none sm:text-sm"
                  >
                    <option value={5}>5 · Highest</option>
                    <option value={4}>4 · High</option>
                    <option value={3}>3 · Normal</option>
                    <option value={2}>2 · Low</option>
                    <option value={1}>1 · Someday</option>
                  </select>
                </Field>
              </div>
              <button
                type="submit"
                disabled={!title.trim() || saving}
                className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
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

function TaskSection({
  title,
  tasks,
  onToggle,
  completed = false,
}: {
  title: string;
  tasks: Task[];
  onToggle: (task: Task) => void;
  completed?: boolean;
}) {
  return (
    <section>
      <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      {tasks.length === 0 ? (
        <div className="emery-glass rounded-[1.55rem] p-6 text-center">
          <CheckCircle2 className="mx-auto size-7 text-primary" />
          <p className="mt-2 text-sm font-medium">Nothing waiting here.</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Say “Emery, add a task…” whenever something comes up.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((task) => (
            <article
              key={task.id}
              className={`flex items-start gap-3 rounded-[1.45rem] border p-3.5 ${completed ? "border-border/35 bg-card/24 opacity-58" : "border-border/45 bg-card/38"}`}
            >
              <button
                type="button"
                onClick={() => void onToggle(task)}
                aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
                className="emery-press mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/45 bg-card/35 text-muted-foreground hover:border-primary/20 hover:text-primary"
              >
                {completed ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
              </button>
              <div className="min-w-0 flex-1 py-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p
                    className={`text-sm font-semibold leading-5 ${completed ? "line-through" : ""}`}
                  >
                    {task.title}
                  </p>
                  {!completed ? (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-primary/75">
                      P{task.priority}
                    </span>
                  ) : null}
                </div>
                {task.details ? (
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{task.details}</p>
                ) : null}
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
                  {task.project_name ? (
                    <span className="font-medium text-foreground/75">{task.project_name}</span>
                  ) : null}
                  {task.due_at ? <span>{formatDue(task)}</span> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDue(task: Task) {
  if (!task.due_at) return "";
  const dateOnly = Boolean((task.metadata as Record<string, unknown> | null)?.["due_date_only"]);
  return dateOnly
    ? new Date(task.due_at).toLocaleDateString([], { dateStyle: "medium" })
    : new Date(task.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Field({
  label,
  optional = false,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-sm font-semibold">
        {label}
        {optional ? (
          <span className="text-[10px] font-normal text-muted-foreground">Optional</span>
        ) : null}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}
