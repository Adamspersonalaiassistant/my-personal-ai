import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckSquare, ChevronDown, FileText, FolderKanban, Sparkles } from "lucide-react";
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
  const [open, setOpen] = useState(false);

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
        eyebrow: "Focus now",
        title: snapshot.focus.task.title,
        meta: `Priority ${snapshot.focus.task.priority}${snapshot.focus.task.due_at ? ` · due ${new Date(snapshot.focus.task.due_at).toLocaleDateString()}` : ""}`,
        to: "/tasks" as const,
      }
    : snapshot.focus.project_needing_next_action
      ? {
          eyebrow: "Needs a next move",
          title: snapshot.focus.project_needing_next_action.name,
          meta: "Active project without a next action",
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
    <section className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="emery-press flex min-h-[54px] w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-white/[0.025]"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.06] text-primary">
          <Sparkles className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/80">
              {focus?.eyebrow ?? "Context"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {snapshot.tasks.length} tasks · {snapshot.projects.length} projects
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-medium text-foreground/92">
            {focus?.title ?? "Nothing urgent is competing for your attention."}
          </p>
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="border-t border-border/35 px-3.5 pb-3.5 pt-3">
          {focus ? (
            <Link
              to={focus.to}
              className="block rounded-xl bg-primary/[0.045] px-3 py-2.5 hover:bg-primary/[0.07]"
            >
              <p className="text-[11px] font-medium text-foreground">{focus.title}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{focus.meta}</p>
            </Link>
          ) : null}

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <ContextLink to="/tasks" icon={CheckSquare} value={snapshot.tasks.length} label="Tasks" />
            <ContextLink to="/projects" icon={FolderKanban} value={snapshot.projects.length} label="Projects" />
            <ContextLink to="/meetings" icon={CalendarDays} value={snapshot.meetings.length} label="Meetings" />
            <ContextLink to="/settings" icon={FileText} value={snapshot.attachments.length} label="Files" />
          </div>
        </div>
      ) : null}
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
      className="emery-press flex min-w-0 flex-col items-center rounded-xl px-1.5 py-2 text-center hover:bg-white/[0.025]"
    >
      <Icon className="size-3.5 text-primary/85" />
      <span className="mt-1 text-xs font-semibold">{value}</span>
      <span className="truncate text-[8px] uppercase tracking-[0.09em] text-muted-foreground">{label}</span>
    </Link>
  );
}
