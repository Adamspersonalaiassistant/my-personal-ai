import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Clock3, Plus, Users, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { createMeeting, listMeetings } from "@/lib/emery.functions";

export const Route = createFileRoute("/_authenticated/meetings")({ component: Meetings });

type Meeting = {
  id: string;
  title: string | null;
  meeting_at: string | null;
  participants: unknown;
  summary: string | null;
  created_at: string;
};

function Meetings() {
  const loadMeetings = useServerFn(listMeetings);
  const addMeeting = useServerFn(createMeeting);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    const result = await loadMeetings({});
    setMeetings((result?.meetings ?? []) as Meeting[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadMeetings({});
        if (!cancelled) setMeetings((result?.meetings ?? []) as Meeting[]);
      } catch {
        if (!cancelled) setError("Couldn't load your meetings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMeetings]);

  const now = Date.now();
  const upcoming = meetings.filter(
    (meeting) => meeting.meeting_at && new Date(meeting.meeting_at).getTime() >= now,
  );
  const past = meetings
    .filter((meeting) => meeting.meeting_at && new Date(meeting.meeting_at).getTime() < now)
    .sort((a, b) => new Date(b.meeting_at ?? 0).getTime() - new Date(a.meeting_at ?? 0).getTime());

  return (
    <AppShell title="Meetings">
      <section className="emery-glass rounded-3xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Meeting intelligence
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Your upcoming conversations
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Emery can save meetings here and use them as current context. External calendar sync
              comes later.
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

      {error ? (
        <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading meetings…</p>
      ) : (
        <>
          <MeetingSection title={`Upcoming · ${upcoming.length}`} meetings={upcoming} />
          {past.length ? (
            <MeetingSection title={`Past · ${past.length}`} meetings={past.slice(0, 20)} past />
          ) : null}
        </>
      )}

      {showAdd ? (
        <MeetingEditor
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
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {title}
      </p>
      {meetings.length === 0 ? (
        <div className="emery-glass rounded-3xl p-5 text-center">
          <CalendarDays className="mx-auto size-7 text-primary" />
          <p className="mt-2 text-sm font-medium">Nothing scheduled here.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tell Emery about a meeting and she can ask whether you want it saved.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map((meeting) => {
            const participants = Array.isArray(meeting.participants)
              ? (meeting.participants.filter((item) => typeof item === "string") as string[])
              : [];
            return (
              <article
                key={meeting.id}
                className={`emery-glass rounded-3xl p-4 ${past ? "opacity-70" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.06] text-primary">
                    <CalendarDays className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{meeting.title || "Untitled meeting"}</h3>
                    {meeting.meeting_at ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" />
                        <span>
                          {new Date(meeting.meeting_at).toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                    ) : null}
                    {participants.length ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="size-3.5" />
                        <span className="truncate">{participants.join(", ")}</span>
                      </div>
                    ) : null}
                    {meeting.summary ? (
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {meeting.summary}
                      </p>
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

function MeetingEditor({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (values: { title: string; meetingAt: string; participants?: string[] }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [meetingAt, setMeetingAt] = useState("");
  const [participants, setParticipants] = useState("");
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
        participants: participants
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
    } catch {
      setError("Couldn't save that meeting.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="emery-glass w-full max-w-md rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Add meeting</p>
            <p className="text-xs text-muted-foreground">
              This saves to Emery, not an external calendar yet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-2xl text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Meeting title"
            className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40"
            autoFocus
          />
          <label className="block text-xs text-muted-foreground">Date and time</label>
          <input
            type="datetime-local"
            value={meetingAt}
            onChange={(event) => setMeetingAt(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40"
          />
          <input
            value={participants}
            onChange={(event) => setParticipants(event.target.value)}
            placeholder="Participants, separated by commas (optional)"
            className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button
            type="submit"
            disabled={!title.trim() || !meetingAt || saving}
            className="min-h-12 w-full rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save meeting"}
          </button>
        </div>
      </form>
    </div>
  );
}
