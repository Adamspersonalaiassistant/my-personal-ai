import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Edit3, FolderKanban, Plus, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ProjectExecutionOverview } from "@/components/ProjectExecutionOverview";
import { listProjects, saveProject } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/projects")({ component: Projects });

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: number;
  goal: string | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
};

function Projects() {
  const loadProjects = useServerFn(listProjects);
  const save = useServerFn(saveProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  async function refresh() {
    const result = await loadProjects({});
    setProjects((result?.projects ?? []) as Project[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadProjects({});
        if (!cancelled) setProjects((result?.projects ?? []) as Project[]);
      } catch {
        if (!cancelled) setError("Couldn't load your projects.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  const active = projects.filter((project) => project.status === "active");
  const other = projects.filter((project) => project.status !== "active");
  const focusProject = [...active].sort((a, b) => b.priority - a.priority)[0] ?? null;
  const openEditor = (project: Project | null) => {
    setEditing(project);
    setShowEditor(true);
  };

  return (
    <AppShell title="Projects">
      <div className="space-y-5">
        <section className="emery-glass-strong rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="emery-kicker">Outcomes & direction</p>
              <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.03em] sm:text-[1.35rem]">
                Keep the daily work connected to the bigger result.
              </h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Projects give Emery the goal behind your tasks and meetings so she can help protect the next move that matters most.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openEditor(null)}
              className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="size-4" /> Add
            </button>
          </div>

          {focusProject ? (
            <div className="mt-4 rounded-2xl border border-primary/12 bg-primary/[0.035] p-3.5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/12 bg-primary/[0.055] text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">Current focus project</p>
                  <p className="mt-1 truncate text-sm font-semibold">{focusProject.name}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {focusProject.next_action ? `Next: ${focusProject.next_action}` : "This project still needs a clear next action."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-border/40 bg-card/25 px-3.5 py-3 text-xs text-muted-foreground">
              <FolderKanban className="size-4 text-primary" /> No active projects are competing for your attention.
            </div>
          )}
        </section>

        <ProjectExecutionOverview />

        {error ? (
          <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="emery-glass h-36 animate-pulse rounded-[1.5rem] opacity-55" />
            ))}
          </div>
        ) : (
          <>
            <ProjectSection title={`Active · ${active.length}`} projects={active} onEdit={openEditor} />
            {other.length ? (
              <ProjectSection title={`Paused / Completed · ${other.length}`} projects={other} onEdit={openEditor} muted />
            ) : null}
          </>
        )}
      </div>

      {showEditor ? (
        <ProjectEditor
          project={editing}
          onClose={() => setShowEditor(false)}
          onSave={async (values) => {
            await save({ data: values });
            setShowEditor(false);
            await refresh();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function ProjectSection({
  title,
  projects,
  onEdit,
  muted = false,
}: {
  title: string;
  projects: Project[];
  onEdit: (project: Project) => void;
  muted?: boolean;
}) {
  return (
    <section>
      <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {projects.length === 0 ? (
        <div className="emery-glass rounded-[1.55rem] p-6 text-center">
          <FolderKanban className="mx-auto size-7 text-primary" />
          <p className="mt-2 text-sm font-medium">No projects here yet.</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Say “Emery, create a project for…” and she can add it for you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className={`rounded-[1.5rem] border p-4 ${muted ? "border-border/35 bg-card/24 opacity-62" : "border-border/45 bg-card/38"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-sm font-semibold">{project.name}</h3>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-primary/75">P{project.priority}</span>
                    {project.status !== "active" ? (
                      <span className="text-[10px] capitalize text-muted-foreground">{project.status}</span>
                    ) : null}
                  </div>

                  {project.goal ? (
                    <div className="mt-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Goal</p>
                      <p className="mt-1 text-sm leading-6 text-foreground/90">{project.goal}</p>
                    </div>
                  ) : project.description ? (
                    <p className="mt-2.5 text-sm leading-6 text-muted-foreground">{project.description}</p>
                  ) : null}

                  {project.next_action ? (
                    <div className="mt-3.5 rounded-2xl border border-primary/10 bg-primary/[0.025] px-3.5 py-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-primary/75">Next action</p>
                      <p className="mt-1.5 text-xs leading-5 text-foreground/90">{project.next_action}</p>
                    </div>
                  ) : !muted ? (
                    <div className="mt-3 rounded-xl border border-dashed border-border/45 px-3 py-2 text-[11px] text-muted-foreground">
                      No next action yet. Emery can help define one.
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(project)}
                  aria-label={`Edit ${project.name}`}
                  className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/45 bg-card/35 text-muted-foreground hover:border-primary/20 hover:text-primary"
                >
                  <Edit3 className="size-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectEditor({
  project,
  onClose,
  onSave,
}: {
  project: Project | null;
  onClose: () => void;
  onSave: (values: {
    id?: string;
    name: string;
    description?: string;
    status?: string;
    priority?: number;
    goal?: string;
    nextAction?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [goal, setGoal] = useState(project?.goal ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [nextAction, setNextAction] = useState(project?.next_action ?? "");
  const [priority, setPriority] = useState(project?.priority ?? 3);
  const [status, setStatus] = useState(project?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...(project?.id ? { id: project.id } : {}),
        name,
        goal,
        description,
        nextAction,
        priority,
        status,
      });
    } catch {
      setError("Couldn't save that project.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/65 p-2 backdrop-blur-md sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="emery-glass-strong max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[1.9rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="emery-kicker">Project context</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em]">{project ? "Edit project" : "New project"}</h3>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Give Emery the outcome, why it matters, and the next concrete move.</p>
          </div>
          <button type="button" onClick={onClose} className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:bg-white/5" aria-label="Close project editor">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <Field label="Project name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Build Emery Voice"
              className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
              autoFocus
            />
          </Field>
          <Field label="Goal">
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="What outcome should this project create?"
              rows={2}
              className="w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 py-3 text-[16px] leading-6 outline-none transition focus:border-primary/40 sm:text-sm"
            />
          </Field>
          <Field label="Context" optional>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Anything Emery should understand about this project"
              rows={3}
              className="w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 py-3 text-[16px] leading-6 outline-none transition focus:border-primary/40 sm:text-sm"
            />
          </Field>
          <Field label="Next action" optional>
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="The next concrete move"
              className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3 text-[16px] outline-none sm:text-sm"
              >
                <option value={5}>5 · Highest</option>
                <option value={4}>4 · High</option>
                <option value={3}>3 · Normal</option>
                <option value={2}>2 · Low</option>
                <option value={1}>1 · Someday</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3 text-[16px] outline-none sm:text-sm"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button type="submit" disabled={!name.trim() || saving} className="emery-press min-h-12 w-full rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40">
            {saving ? "Saving…" : "Save project"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, optional = false, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-sm font-semibold">
        {label}
        {optional ? <span className="text-[10px] font-normal text-muted-foreground">Optional</span> : null}
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}
