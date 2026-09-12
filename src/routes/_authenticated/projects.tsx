import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Edit3, FolderKanban, Plus, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
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

  return (
    <AppShell title="Projects">
      <section className="emery-glass rounded-3xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Current context</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">The bigger picture</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Emery can now use your active projects and next actions while she talks with you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowEditor(true);
            }}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>
      </section>

      {error ? <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading projects…</p>
      ) : (
        <>
          <ProjectSection title={`Active · ${active.length}`} projects={active} onEdit={(project) => { setEditing(project); setShowEditor(true); }} />
          {other.length ? <ProjectSection title={`Paused / Completed · ${other.length}`} projects={other} onEdit={(project) => { setEditing(project); setShowEditor(true); }} /> : null}
        </>
      )}

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

function ProjectSection({ title, projects, onEdit }: { title: string; projects: Project[]; onEdit: (project: Project) => void }) {
  return (
    <section>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">{title}</p>
      {projects.length === 0 ? (
        <div className="emery-glass rounded-3xl p-5 text-center">
          <FolderKanban className="mx-auto size-7 text-primary" />
          <p className="mt-2 text-sm font-medium">No projects here yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">Say “Emery, create a project for…” and she can add it for you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <article key={project.id} className="emery-glass rounded-3xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{project.name}</h3>
                    <span className="rounded-full border border-primary/20 bg-primary/[0.07] px-2 py-0.5 text-[10px] font-medium text-primary">{project.status}</span>
                    <span className="rounded-full border border-border/50 bg-card/50 px-2 py-0.5 text-[10px] text-muted-foreground">Priority {project.priority}</span>
                  </div>
                  {project.goal ? <p className="mt-2 text-sm leading-6 text-foreground/90">{project.goal}</p> : null}
                  {!project.goal && project.description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{project.description}</p> : null}
                  {project.next_action ? (
                    <div className="mt-3 rounded-2xl border border-primary/15 bg-primary/[0.045] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">Next action</p>
                      <p className="mt-1 text-xs leading-5">{project.next_action}</p>
                    </div>
                  ) : null}
                </div>
                <button type="button" onClick={() => onEdit(project)} aria-label={`Edit ${project.name}`} className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-card/60 text-muted-foreground hover:text-primary">
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

function ProjectEditor({ project, onClose, onSave }: { project: Project | null; onClose: () => void; onSave: (values: { id?: string; name: string; description?: string; status?: string; priority?: number; goal?: string; nextAction?: string }) => Promise<void> }) {
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
      await onSave({ id: project?.id, name, goal, description, nextAction, priority, status });
    } catch {
      setError("Couldn't save that project.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center" onClick={onClose}>
      <form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="emery-glass max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{project ? "Edit project" : "New project"}</p>
            <p className="text-xs text-muted-foreground">Give Emery the outcome and next move.</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-2xl text-muted-foreground"><X className="size-4" /></button>
        </div>
        <div className="mt-4 space-y-3">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40" autoFocus />
          <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Goal" rows={2} className="w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 py-3 text-sm outline-none focus:border-primary/40" />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" rows={3} className="w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 py-3 text-sm outline-none focus:border-primary/40" />
          <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="Next action (optional)" className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40" />
          <div className="grid grid-cols-2 gap-2">
            <select value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="min-h-12 rounded-2xl border border-border/60 bg-card/70 px-3 text-sm outline-none">
              <option value={5}>Priority 5</option><option value={4}>Priority 4</option><option value={3}>Priority 3</option><option value={2}>Priority 2</option><option value={1}>Priority 1</option>
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-12 rounded-2xl border border-border/60 bg-card/70 px-3 text-sm outline-none">
              <option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option>
            </select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button type="submit" disabled={!name.trim() || saving} className="min-h-12 w-full rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40">{saving ? "Saving…" : "Save project"}</button>
        </div>
      </form>
    </div>
  );
}
