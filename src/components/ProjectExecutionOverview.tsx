import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckSquare } from "lucide-react";
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
  const openTasks = projects.reduce((sum, project) => sum + project.open_task_count, 0);
  const upcomingMeetings = projects.filter((project) => project.next_meeting).length;

  return (
    <section className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/35 bg-card/22 px-3.5 py-2.5 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/82">Execution</span>
      <Link to="/tasks" className="emery-press inline-flex items-center gap-1.5 hover:text-foreground">
        <CheckSquare className="size-3.5 text-primary/80" /> {openTasks} open tasks
      </Link>
      <Link to="/meetings" className="emery-press inline-flex items-center gap-1.5 hover:text-foreground">
        <CalendarDays className="size-3.5 text-primary/80" /> {upcomingMeetings} upcoming
      </Link>
      {needingAction.length ? (
        <span className="text-primary/85">{needingAction.length} need a next action</span>
      ) : (
        <span>All active projects have a next action</span>
      )}
    </section>
  );
}
