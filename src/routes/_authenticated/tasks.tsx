import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Circle, Plus, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { createTask, listTasks, setTaskCompleted } from "@/lib/emery.functions";

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
  metadata: unknown;
  created_at: string;
};

function Tasks() {
  const loadTasks = useServerFn(listTasks);
  const addTask = useServerFn(createTask);
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

  async function refresh() {
    const result = await loadTasks({});
    setTasks((result?.tasks ?? []) as Task[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadTasks({});
        if (!cancelled) setTasks((result?.tasks ?? []) as Task[]);
      } catch {
        if (!cancelled) setError("Couldn't load your tasks.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTasks]);

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
        },
      });
      setTitle("");
      setDetails("");
      setDue("");
      setPriority(3);
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
      <section className="emery-glass rounded-3xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Action system</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Your next moves</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Emery can now create, remember and complete tasks with you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>
      </section>

      {error ? <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading tasks…</p>
      ) : (
        <>
          <TaskSection title={`Open · ${open.length}`} tasks={open} onToggle={handleToggle} />
          {completed.length ? (
            <TaskSection title={`Completed · ${completed.length}`} tasks={completed} onToggle={handleToggle} completed />
          ) : null}
        </>
      )}

      {showAdd ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center" onClick={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} onClick={(event) => event.stopPropagation()} className="emery-glass w-full max-w-md rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Add task</p>
                <p className="text-xs text-muted-foreground">Or just tell Emery in chat.</p>
              </div>
              <button type="button" onClick={() => setShowAdd(false)} className="flex size-11 items-center justify-center rounded-2xl text-muted-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40" autoFocus />
              <textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Details (optional)" rows={3} className="w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 py-3 text-sm outline-none focus:border-primary/40" />
              <label className="block text-xs text-muted-foreground">Due date/time (optional)</label>
              <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40" />
              <label className="block text-xs text-muted-foreground">Priority</label>
              <select value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none">
                <option value={5}>5 · Highest</option>
                <option value={4}>4 · High</option>
                <option value={3}>3 · Normal</option>
                <option value={2}>2 · Low</option>
                <option value={1}>1 · Someday</option>
              </select>
              <button type="submit" disabled={!title.trim() || saving} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40">
                <Check className="size-4" /> {saving ? "Adding…" : "Add task"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}

function TaskSection({ title, tasks, onToggle, completed = false }: { title: string; tasks: Task[]; onToggle: (task: Task) => void; completed?: boolean }) {
  return (
    <section>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">{title}</p>
      {tasks.length === 0 ? (
        <div className="emery-glass rounded-3xl p-5 text-center">
          <CheckCircle2 className="mx-auto size-7 text-primary" />
          <p className="mt-2 text-sm font-medium">Nothing waiting here.</p>
          <p className="mt-1 text-xs text-muted-foreground">Say “Emery, add a task…” whenever something comes up.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const dateOnly = Boolean((task.metadata as Record<string, unknown> | null)?.due_date_only);
            return (
              <article key={task.id} className={`emery-glass flex items-start gap-3 rounded-3xl p-3.5 ${completed ? "opacity-65" : ""}`}>
                <button type="button" onClick={() => void onToggle(task)} aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`} className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-card/60 text-primary">
                  {completed ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
                </button>
                <div className="min-w-0 flex-1 py-1">
                  <p className={`text-sm font-medium ${completed ? "line-through" : ""}`}>{task.title}</p>
                  {task.details ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{task.details}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span className="rounded-full border border-border/50 bg-card/50 px-2 py-1">Priority {task.priority}</span>
                    {task.due_at ? (
                      <span className="rounded-full border border-border/50 bg-card/50 px-2 py-1">
                        {dateOnly ? new Date(task.due_at).toLocaleDateString() : new Date(task.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
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
