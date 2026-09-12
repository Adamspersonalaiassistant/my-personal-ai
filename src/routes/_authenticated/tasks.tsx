import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Circle, Plus, X } from "lucide-react";
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
      <div className="space-y-4">
        <section className="emery-glass-strong rounded-[1.7rem] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="emery-kicker">Action system</p>
              <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">Your next moves</h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Keep the list small, clear and executable. Emery can capture the rest from chat.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="emery-chip">{open.length} open</span>
                <span className="emery-chip text-muted-foreground">{completed.length} done</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="size-4" /> Add
            </button>
          </div>
        </section>

        {error ? (
          <p
            className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
                className="emery-glass h-20 animate-pulse rounded-[1.45rem] opacity-60"
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
          className="fixed inset-0 z-50 flex items-end bg-black/65 p-3 backdrop-blur-md sm:items-center sm:justify-center"
          onClick={() => setShowAdd(false)}
        >
          <form
            onSubmit={handleAdd}
            onClick={(event) => event.stopPropagation()}
            className="emery-glass-strong w-full max-w-md rounded-[1.8rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="emery-kicker">New action</p>
                <h3 className="mt-1 text-lg font-semibold">Add task</h3>
                <p className="mt-1 text-xs text-muted-foreground">Or just tell Emery in chat.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="emery-press flex size-11 items-center justify-center rounded-2xl text-muted-foreground hover:bg-white/5"
                aria-label="Close add task"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Task title"
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none focus:border-primary/40"
                autoFocus
              />
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="Details (optional)"
                rows={3}
                className="w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 py-3 text-sm outline-none focus:border-primary/40"
              />
              <label className="block text-xs font-medium text-muted-foreground">
                Due date/time (optional)
              </label>
              <input
                type="datetime-local"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none focus:border-primary/40"
              />
              <label className="block text-xs font-medium text-muted-foreground">
                Project (optional)
              </label>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <label className="block text-xs font-medium text-muted-foreground">Priority</label>
              <select
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none"
              >
                <option value={5}>5 · Highest</option>
                <option value={4}>4 · High</option>
                <option value={3}>3 · Normal</option>
                <option value={2}>2 · Low</option>
                <option value={1}>1 · Someday</option>
              </select>
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
      <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </p>
      {tasks.length === 0 ? (
        <div className="emery-glass rounded-[1.55rem] p-6 text-center">
          <CheckCircle2 className="mx-auto size-7 text-primary" />
          <p className="mt-2 text-sm font-medium">Nothing waiting here.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Say “Emery, add a task…” whenever something comes up.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((task) => {
            const dateOnly = Boolean(
              (task.metadata as Record<string, unknown> | null)?.["due_date_only"],
            );
            return (
              <article
                key={task.id}
                className={`emery-press emery-glass flex items-start gap-3 rounded-[1.45rem] p-3.5 ${completed ? "opacity-60" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => void onToggle(task)}
                  aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
                  className="emery-press emery-icon-well mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl"
                >
                  {completed ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
                </button>
                <div className="min-w-0 flex-1 py-1">
                  <p
                    className={`text-sm font-semibold leading-5 ${completed ? "line-through" : ""}`}
                  >
                    {task.title}
                  </p>
                  {task.details ? (
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{task.details}</p>
                  ) : null}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <span className="emery-chip text-muted-foreground">
                      Priority {task.priority}
                    </span>
                    {task.project_name ? (
                      <span className="emery-chip">{task.project_name}</span>
                    ) : null}
                    {task.due_at ? (
                      <span className="emery-chip text-muted-foreground">
                        {dateOnly
                          ? new Date(task.due_at).toLocaleDateString()
                          : new Date(task.due_at).toLocaleString([], {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
