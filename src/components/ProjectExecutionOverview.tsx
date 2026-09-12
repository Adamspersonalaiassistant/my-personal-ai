import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckSquare, FolderKanban } from "lucide-react";
import { getOperatingSystemSnapshot } from "@/lib/os.functions";

type ProjectContext = {
  id: string;
  name: string;
  priority: number;
  next_action: string | null;
  open_task_count: number;
  high_priority_task_count: number;
  next_meeting: { title: string | null; meeting_at: string | null } | null;
};

export function ProjectExecutionOverview() {
  const load = useServerFn(getOperatingSystemSnapshot);
  const [projects, setProjects] = useState<ProjectContext[]>([]);

  useEffect(() => {
    let cancelled = false;
    void load({})
      .then((result) => {
        if (!cancelled) setProjects((result.projects ?? []) as ProjectContext[]);
      })
      .catch((error) => console.error("Project execution context failed", error));
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (!projects.length) return null;
  const needingAction = projects.filter((project) => !project.next_action);

  return (
    <section className="emery-glass rounded-[1.55rem] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="emery-kicker">Connected execution</p>
          <h3 className="mt-1 text-sm font-semibold">Projects are tied to the work now</h3>
        </div>
        {needingAction.length ? (
          <span className="emery-chip text-primary">{needingAction.length} need next action</span>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {projects.slice(0, 4).map((project) => (
          <div key={project.id} className="rounded-2xl border border-border/45 bg-card/45 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-3.5 shrink-0 text-primary" />
                  <p className="truncate text-xs font-semibold">{project.name}</p>
                </div>
                <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                  {project.next_action || "No next action set yet"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Link to="/tasks" className="emery-chip">
                  <CheckSquare className="size-3" /> {project.open_task_count}
                </Link>
                {project.next_meeting ? (
                  <Link to="/meetings" className="emery-chip text-muted-foreground">
                    <CalendarDays className="size-3" /> 1
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
