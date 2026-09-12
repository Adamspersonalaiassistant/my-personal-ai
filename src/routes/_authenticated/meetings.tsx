import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Clock3, Plus, Sparkles, Users, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { createLinkedMeeting, listProjectOptions, listUnifiedMeetings } from "@/lib/os.functions";

export const Route = createFileRoute("/_authenticated/meetings")({ component: Meetings });

type Meeting = {
  id: string;
  title: string | null;
  meeting_at: string | null;
  participants: unknown;
  summary: string | null;
  project_id: string | null;
  project_name: string | null;
  created_at: string;
};

type ProjectOption = { id: string; name: string; priority: number; status: string };

function Meetings() {
  const loadMeetings = useServerFn(listUnifiedMeetings);
  const loadProjects = useServerFn(listProjectOptions);
  const addMeeting = useServerFn(createLinkedMeeting);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  async function refresh() {
    const result = await loadMeetings({});
    setMeetings((result?.meetings ?? []) as Meeting[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [result, projectResult] = await Promise.all([loadMeetings({}), loadProjects({})]);
        if (!cancelled) {
          setMeetings((result?.meetings ?? []) as Meeting[]);
          setProjects((projectResult?.projects ?? []) as ProjectOption[]);
        }
      } catch {
        if (!cancelled) setError("Couldn't load your meetings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMeetings, loadProjects]);

  const now = Date.now();
  const upcoming = meetings
    .filter((meeting) => meeting.meeting_at && new Date(meeting.meeting_at).getTime() >= now)
    .sort((a, b) => new Date(a.meeting_at ?? 0).getTime() - new Date(b.meeting_at ?? 0).getTime());
  const past = meetings
    .filter((meeting) => meeting.meeting_at && new Date(meeting.meeting_at).getTime() < now)
    .sort((a, b) => new Date(b.meeting_at ?? 0).getTime() - new Date(a.meeting_at ?? 0).getTime());
  const nextMeeting = upcoming[0] ?? null;

  return (
    <AppShell title="Meetings">
      <div className="space-y-5">
        <section className="emery-glass-strong rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="emery-kicker">Meeting intelligence</p>
              <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.03em] sm:text-[1.35rem]">
                Conversations Emery can prepare around.
              </h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                Keep important conversations visible so Emery can connect them to projects, priorities, and the work that should happen next.
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

          {nextMeeting ? (
            <div className="mt-4 rounded-2xl border border-primary/12 bg-primary/[0.035] p-3.5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/12 bg-primary/[0.055] text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">Next conversation</p>
                  <p className="mt-1 truncate text-sm font-semibold">{nextMeeting.title || "Untitled meeting"}</p>
                  {nextMeeting.meeting_at ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(nextMeeting.meeting_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      {nextMeeting.project_name ? ` · ${nextMeeting.project_name}` : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-border/40 bg-card/25 px-3.5 py-3 text-xs text-muted-foreground">
              <CalendarDays className="size-4 text-primary" /> No upcoming meetings saved in Emery.
            </div>
          )}
        </section>

        {error ? (
          <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="emery-glass h-24 animate-pulse rounded-[1.45rem] opacity-55" />
            ))}
          </div>
        ) : (
          <>
            <MeetingSection title={`Upcoming · ${upcoming.length}`} meetings={upcoming} />
            {past.length ? <MeetingSection title={`Past · ${past.length}`} meetings={past.slice(0, 20)} past /> : null}
          </>
        )}
      </div>

      {showAdd ? (
        <MeetingEditor
          projects={projects}
          onClose={() => setShowAdd(false)}
          onSave={async (values) => {
            await addMeeting({ data: values });
            setShowAdd(false);
            await refresh();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function MeetingSection({
  title,
  meetings,
  past = false,
}: {
  title: string;
  meetings: Meeting[];
  past?: boolean;
}) {
  return (
    <section>
      <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {meetings.length === 0 ? (
        <div className="emery-glass rounded-[1.55rem] p-6 text-center">
          <CalendarDays className="mx-auto size-7 text-primary" />
          <p className="mt-2 text-sm font-medium">Nothing scheduled here.</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Tell Emery about a meeting and she can save it into your internal meeting system.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {meetings.map((meeting, index) => {
            const participants = Array.isArray(meeting.participants)
              ? (meeting.participants.filter((item) => typeof item === "string") as string[])
              : [];
            const isNext = !past && index === 0;
            return (
              <article
                key={meeting.id}
                className={`emery-press rounded-[1.5rem] border p-4 ${
                  past
                    ? "border-border/40 bg-card/28 opacity-58"
                    : isNext
                      ? "border-primary/16 bg-primary/[0.035] shadow-[0_14px_36px_rgba(0,0,0,0.12)]"
                      : "border-border/45 bg-card/38"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div className={`flex size-11 shrink-0 items-center justify-center rounded-2xl border ${isNext ? "border-primary/15 bg-primary/[0.06] text-primary" : "border-border/45 bg-card/40 text-muted-foreground"}`}>
                    <CalendarDays className="size-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-sm font-semibold">{meeting.title || "Untitled meeting"}</h3>
                      {isNext ? <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-primary/80">Next</span> : null}
                      {meeting.project_name ? (
                        <span className="rounded-full border border-border/45 bg-card/35 px-2 py-0.5 text-[10px] text-muted-foreground">{meeting.project_name}</span>
                      ) : null}
                    </div>
                    {meeting.meeting_at ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" />
                        <span>{new Date(meeting.meeting_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                      </div>
                    ) : null}
                    {participants.length ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="size-3.5" />
                        <span className="truncate">{participants.join(", ")}</span>
                      </div>
                    ) : null}
                    {meeting.summary ? <p className="mt-2.5 text-xs leading-5 text-muted-foreground">{meeting.summary}</p> : null}
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

function MeetingEditor({
  projects,
  onClose,
  onSave,
}: {
  projects: ProjectOption[];
  onClose: () => void;
  onSave: (values: {
    title: string;
    meetingAt: string;
    participants?: string[];
    projectId?: string | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [meetingAt, setMeetingAt] = useState("");
  const [participants, setParticipants] = useState("");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !meetingAt || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title,
        meetingAt: new Date(meetingAt).toISOString(),
        participants: participants.split(",").map((item) => item.trim()).filter(Boolean),
        projectId: projectId || null,
      });
    } catch {
      setError("Couldn't save that meeting.");
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
            <p className="emery-kicker">New conversation</p>
            <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Add meeting</h3>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">This saves inside Emery so she can use it as context. External calendar sync is not enabled yet.</p>
          </div>
          <button type="button" onClick={onClose} className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:bg-white/5" aria-label="Close add meeting">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <Field label="Title">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Lunch with attorney team"
              className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
              autoFocus
            />
          </Field>
          <Field label="Date and time">
            <input
              type="datetime-local"
              value={meetingAt}
              onChange={(event) => setMeetingAt(event.target.value)}
              className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
            />
          </Field>
          <Field label="Project" optional>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none sm:text-sm"
            >
              <option value="">No linked project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Participants" optional>
            <input
              value={participants}
              onChange={(event) => setParticipants(event.target.value)}
              placeholder="Denice, John, Sarah"
              className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
            />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button
            type="submit"
            disabled={!title.trim() || !meetingAt || saving}
            className="emery-press min-h-12 w-full rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save meeting"}
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
