import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckSquare, FileText, FolderKanban, Sparkles } from "lucide-react";
import { getOperatingSystemSnapshot } from "@/lib/os.functions";

type Snapshot = {
  focus: {
    task: { id: string; title: string; priority: number; due_at: string | null } | null;
    project_needing_next_action: { id: string; name: string } | null;
    meeting: { id: string; title: string | null; meeting_at: string | null } | null;
  };
  tasks: Array<{ id: string }>;
  projects: Array<{ id: string }>;
  meetings: Array<{ id: string }>;
  attachments: Array<{ id: string; file_name: string; mime_type: string; url: string | null }>;
};

export function OperatingContextCard() {
  const load = useServerFn(getOperatingSystemSnapshot);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await load({});
        if (!cancelled) setSnapshot(result as Snapshot);
      } catch (error) {
        console.error("Operating context failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (!snapshot) return null;

  const focus = snapshot.focus.task
    ? {
        eyebrow: "Highest leverage now",
        title: snapshot.focus.task.title,
        meta: `Priority ${snapshot.focus.task.priority}${snapshot.focus.task.due_at ? ` · due ${new Date(snapshot.focus.task.due_at).toLocaleDateString()}` : ""}`,
        to: "/tasks" as const,
      }
    : snapshot.focus.project_needing_next_action
      ? {
          eyebrow: "Needs a next move",
          title: snapshot.focus.project_needing_next_action.name,
          meta: "This active project has no next action yet.",
          to: "/projects" as const,
        }
      : snapshot.focus.meeting
        ? {
            eyebrow: "Next conversation",
            title: snapshot.focus.meeting.title || "Upcoming meeting",
            meta: snapshot.focus.meeting.meeting_at
              ? new Date(snapshot.focus.meeting.meeting_at).toLocaleString([], {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : "Upcoming",
            to: "/meetings" as const,
          }
        : null;

  return (
    <section className="emery-glass rounded-[1.55rem] p-4">
      <div className="flex items-center gap-2 text-primary">
        <Sparkles className="size-4" />
        <p className="emery-kicker">Current context</p>
      </div>

      {focus ? (
        <Link
          to={focus.to}
          className="emery-press mt-3 block rounded-2xl border border-primary/15 bg-primary/[0.055] px-3.5 py-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">
            {focus.eyebrow}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{focus.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{focus.meta}</p>
        </Link>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Nothing urgent is competing for your attention right now.
        </p>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2">
        <ContextLink to="/tasks" icon={CheckSquare} value={snapshot.tasks.length} label="Tasks" />
        <ContextLink
          to="/projects"
          icon={FolderKanban}
          value={snapshot.projects.length}
          label="Projects"
        />
        <ContextLink
          to="/meetings"
          icon={CalendarDays}
          value={snapshot.meetings.length}
          label="Meetings"
        />
        <ContextLink
          to="/settings"
          icon={FileText}
          value={snapshot.attachments.length}
          label="Files"
        />
      </div>
    </section>
  );
}

function ContextLink({
  to,
  icon: Icon,
  value,
  label,
}: {
  to: "/tasks" | "/projects" | "/meetings" | "/settings";
  icon: typeof CheckSquare;
  value: number;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="emery-press flex min-w-0 flex-col items-center rounded-2xl border border-border/50 bg-card/45 px-1.5 py-2.5 text-center"
    >
      <Icon className="size-4 text-primary" />
      <span className="mt-1 text-sm font-semibold">{value}</span>
      <span className="truncate text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
    </Link>
  );
}
