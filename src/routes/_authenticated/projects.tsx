import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Edit3, FolderKanban, Plus, X } from "lucide-react";
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

type Tab = "active" | "other";

function Projects() {
  const loadProjects = useServerFn(listProjects);
  const save = useServerFn(saveProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [tab, setTab] = useState<Tab>("active");

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

  const active = useMemo(
    () => projects.filter((project) => project.status === "active").sort((a, b) => b.priority - a.priority),
    [projects],
  );
  const other = useMemo(
    () => projects.filter((project) => project.status !== "active"),
    [projects],
  );
  const visible = tab === "active" ? active : other;
  const focusProject = active[0] ?? null;

  function openEditor(project: Project | null) {
    setEditing(project);
    setShowEditor(true);
  }

  return (
    <AppShell title="Projects">
      <div className="mx-auto max-w-3xl pb-3">
        <div className="flex items-end justify-between gap-4 pb-4">
          <div>
            <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {focusProject ? `Current focus: ${focusProject.name}` : "Keep outcomes connected to the next move."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="emery-press flex min-h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>

        <div className="mb-4 inline-flex rounded-xl bg-card/45 p-1">
          <TabButton active={tab === "active"} onClick={() => setTab("active")}>
            Active {active.length}
          </TabButton>
          <TabButton active={tab === "other"} onClick={() => setTab("other")}>
            Paused / done {other.length}
          </TabButton>
        </div>

        {tab === "active" ? <ProjectExecutionOverview /> : null}

        {error ? (
          <p className="my-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/40 bg-card/30">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-[92px] animate-pulse border-b border-border/30 last:border-b-0">
                <div className="mx-4 mt-6 h-3 w-2/3 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : visible.length ? (
          <section className="mt-4 overflow-hidden rounded-2xl border border-border/40 bg-card/28">
            {visible.map((project, index) => (
              <ProjectRow
                key={project.id}
                project={project}
                onEdit={openEditor}
                divider={index < visible.length - 1}
              />
            ))}
          </section>
        ) : (
          <div className="py-14 text-center">
            <FolderKanban className="mx-auto size-7 text-primary/75" strokeWidth={1.7} />
            <p className="mt-3 text-sm font-medium">
              {tab === "active" ? "No active projects." : "Nothing paused or completed yet."}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
              Tell Emery the outcome you want and she can help turn it into a project with a next action.
            </p>
          </div>
        )}
      </div>

      {showEditor ? (
        <ProjectEditor
          project={editing}
          onClose={() => setShowEditor(false)}
          onSave={async (values) => {
            await save({ data: values });
            setShowEditor(false);
            setTab(values.status === "active" || !values.status ? "active" : "other");
            await refresh();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function ProjectRow({
  project,
  onEdit,
  divider,
}: {
  project: Project;
  onEdit: (project: Project) => void;
  divider: boolean;
}) {
  return (
    <article className={`group flex min-h-[90px] items-start gap-3 px-4 py-3.5 ${divider ? "border-b border-border/30" : ""}`}>
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.055] text-primary">
        <FolderKanban className="size-4" strokeWidth={1.8} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-[14px] font-semibold">{project.name}</h3>
              {project.priority >= 4 ? <span className="size-1.5 rounded-full bg-primary" title={`Priority ${project.priority}`} /> : null}
              {project.status !== "active" ? (
                <span className="text-[10px] capitalize text-muted-foreground">{project.status}</span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {project.goal || project.description || "No project context yet."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onEdit(project)}
            aria-label={`Edit ${project.name}`}
            className="emery-press flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/[0.035] hover:text-primary"
          >
            <Edit3 className="size-4" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className={project.next_action ? "text-foreground/82" : "text-muted-foreground"}>
            {project.next_action ? `Next: ${project.next_action}` : "Needs a next action"}
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
        </div>
      </div>
    </article>
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
    <div
      className="fixed inset-0 z-[80] flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="emery-sheet-in max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[1.6rem] border border-border/50 bg-[oklch(0.125_0.034_255/0.985)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-24px_70px_rgba(0,0,0,0.45)] sm:rounded-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/12 sm:hidden" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold">{project ? "Edit project" : "New project"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Outcome first. Next action second.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="emery-press flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/[0.04]"
            aria-label="Close project editor"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            className="min-h-12 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[16px] outline-none focus:border-primary/40"
            autoFocus
          />
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="What outcome should this create?"
            rows={2}
            className="w-full rounded-xl border border-border/55 bg-card/45 px-3.5 py-3 text-[16px] leading-6 outline-none focus:border-primary/40"
          />
          <input
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
            placeholder="Next action (optional)"
            className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[15px] outline-none focus:border-primary/40"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Context for Emery (optional)"
            rows={2}
            className="w-full rounded-xl border border-border/55 bg-card/45 px-3.5 py-3 text-[15px] leading-6 outline-none focus:border-primary/40"
          />

          <div className="grid grid-cols-2 gap-2">
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
            <label className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3 text-[14px] outline-none"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="emery-press min-h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
          >
            {saving ? "Saving…" : project ? "Save changes" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
