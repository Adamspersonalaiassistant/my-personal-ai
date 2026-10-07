import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveHpoActivityLog } from "@/lib/hpo-activity-actions.functions";
import { CalendarDays, CheckCircle2, Clock3, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandPanel } from "@/components/ui/emery/CommandPanel";
import { SectionHeading } from "@/components/ui/emery/SectionHeading";
import { StatusChip } from "@/components/ui/emery/StatusChip";

type ActivityType = "office_visit" | "lunch" | "dinner" | "event";
type Account = { id: string; name: string };
type Interaction = {
  id: string;
  account_id: string | null;
  interaction_type: string;
  source_type?: string | null;
  activity_type?: string | null;
  activity_title?: string | null;
  meeting_id?: string | null;
  metadata?: unknown;
  occurred_at: string;
  summary: string;
  outcome?: string | null;
  relationship_signal?: string | null;
  next_action?: string | null;
};
type Meeting = {
  id: string;
  title: string | null;
  meeting_at: string;
  end_at?: string | null;
  metadata: unknown;
};
type Props = {
  data: {
    accounts: Account[];
    interactions: Interaction[];
    meetings: Meeting[];
    hasMore: boolean;
  };
  onOpenAccount: (id: string) => void;
  onAskEmery: (prompt: string, title: string) => void;
  onMore: () => void;
  onSaved: () => void;
  loading: boolean;
};

const options: Array<[ActivityType, string]> = [
  ["office_visit", "Office Visits"],
  ["lunch", "Lunches"],
  ["dinner", "Dinners"],
  ["event", "Events"],
];
const labels: Record<ActivityType, string> = {
  office_visit: "Office visit",
  lunch: "Lunch",
  dinner: "Dinner",
  event: "Event",
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const interactionType = (row: Interaction): ActivityType | null => {
  const value = String(row.activity_type || row.interaction_type || "").toLowerCase();
  if (value === "visit" || value === "office_visit") return "office_visit";
  if (value === "lunch" || value === "dinner" || value === "event") {
    return value as ActivityType;
  }
  return null;
};
const meetingType = (row: Meeting): ActivityType | null => {
  const meta = object(row.metadata);
  const explicit = String(meta["hpo_activity_type"] || "").toLowerCase();
  if (explicit === "visit" || explicit === "office_visit") return "office_visit";
  if (explicit === "lunch" || explicit === "dinner" || explicit === "event") return explicit;
  const base = String(meta["event_type"] || "").toLowerCase();
  // Calendar lunches/dinners are candidate relationship activities; exclude
  // other personal calendar items unless there is clear HPO context.
  if (base === "lunch" || base === "dinner") return base;
  const hpoContext = meta["hpo"] === true || meta["domain"] === "hpo" ||
    typeof meta["hpo_account_id"] === "string" ||
    typeof meta["account_id"] === "string" ||
    /\\b(orthop[a-z]*|hudson pro|attorney|law firm|esq\\.?|doctor|physician|clinic|grand opening|mri|medical|5k|booth|networking)\\b/i.test(row.title || "");
  if (!hpoContext) return null;
  if (base === "event" || /\\b(event|conference|networking|opening|5k|booth|oktoberfest)\\b/i.test(row.title || "")) return "event";
  return null;
};
const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function HpoActivityView({ data, onOpenAccount, onAskEmery, onMore, onSaved, loading }: Props) {
  const [filter, setFilter] = useState<ActivityType>("office_visit");
  const [editing, setEditing] = useState<{
    meetingId?: string; noteInteractionId?: string; activityType: ActivityType;
    title: string; accountId: string | null; summary: string;
  } | null>(null);
  const accountNames = new Map(data.accounts.map((account) => [account.id, account.name]));
  const loggedMeetingIds = new Set(
    data.interactions.map((row) => row.meeting_id).filter((id): id is string => Boolean(id)),
  );
  const history = data.interactions
    .map((row) => ({ row, type: interactionType(row) }))
    .filter((item): item is { row: Interaction; type: ActivityType } => Boolean(item.type))
    .filter((item) => item.type === filter);
  const scheduled = data.meetings
    .map((row) => ({ row, type: meetingType(row) }))
    .filter((item): item is { row: Meeting; type: ActivityType } => Boolean(item.type))
    .filter((item) => !loggedMeetingIds.has(item.row.id))
    .filter((item) => item.type === filter)
    .sort((a, b) => Date.parse(a.row.meeting_at) - Date.parse(b.row.meeting_at));
  const plannerNotes = data.interactions
    .filter((row) => row.interaction_type === "note" && row.source_type === "route" &&
      object(row.metadata)["field_note"] === true && !row.activity_type)
    .map((row) => {
      const linkedMeeting = data.meetings.find((meeting) => {
        const meta = object(meeting.metadata);
        const meetingAccount = meta["hpo_account_id"] || meta["account_id"];
        return row.account_id && meetingAccount === row.account_id &&
          Math.abs(Date.parse(meeting.meeting_at) - Date.parse(row.occurred_at)) < 12 * 60 * 60 * 1000 &&
          Boolean(meetingType(meeting));
      });
      return { row, type: linkedMeeting ? meetingType(linkedMeeting)! : "office_visit" as ActivityType };
    }).filter((item) => item.type === filter);
  const counts = Object.fromEntries(options.map(([key]) => [
    key,
    data.interactions.filter((row) => interactionType(row) === key).length +
    data.interactions.filter((row) => row.interaction_type === "note" &&
      object(row.metadata)["field_note"] === true && !row.activity_type &&
      (data.meetings.some((meeting) => {
        const meta = object(meeting.metadata);
        return (meta["hpo_account_id"] || meta["account_id"]) === row.account_id &&
          Math.abs(Date.parse(meeting.meeting_at) - Date.parse(row.occurred_at)) < 12*60*60*1000 &&
          meetingType(meeting) === key;
      }) || key === "office_visit" &&
        !data.meetings.some((meeting) => {
          const meta = object(meeting.metadata);
          return (meta["hpo_account_id"] || meta["account_id"]) === row.account_id &&
            Math.abs(Date.parse(meeting.meeting_at) - Date.parse(row.occurred_at)) < 12*60*60*1000 &&
            Boolean(meetingType(meeting));
        }))).length +
    data.meetings.filter((meeting) => meetingType(meeting) === key &&
      !loggedMeetingIds.has(meeting.id)).length,
  ])) as Record<ActivityType, number>;
  const now = Date.now();
  const recapNeeded = scheduled.filter(
    (item) => Date.parse(item.row.end_at || item.row.meeting_at) < now,
  );
  const upcoming = scheduled.filter(
    (item) => Date.parse(item.row.end_at || item.row.meeting_at) >= now,
  );
  const addPrompt =
    "Add an HPO activity. Use exactly one type: Office visit, Lunch, Dinner, or Event. Office visits are routine in-person office relationship visits. Lunches and dinners are business meals with doctors, attorneys, providers, referral partners, or offices. Events are networking or industry relationship events such as Paramus MRI Oktoberfest. If it is future, put it on my calendar and set the next-day recap workflow. If it already happened and you do not have the recap, ask me what happened before saving it.";

  return (
    <section className="space-y-4">
      <CommandPanel variant="glass" className="overflow-hidden border-live/15">
        <SectionHeading
          eyebrow="Relationship Intelligence"
          title="Activity"
          description="Office visits, meals, events and follow-up signals in one field history."
          action={
            <Button
              className="emery-press h-11 gap-2 rounded-xl px-3 text-xs"
              onClick={() => onAskEmery(addPrompt, "Add activity")}
            >
              <Plus className="size-4" />
              Add
            </Button>
          }
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip tone="live">{history.length} logged</StatusChip>
          {upcoming.length ? <StatusChip tone="neutral">{upcoming.length} upcoming</StatusChip> : null}
          {recapNeeded.length ? <StatusChip tone="warning">{recapNeeded.length} recap needed</StatusChip> : null}
        </div>
      </CommandPanel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="HPO activity categories">
        {options.map(([value, optionLabel]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`min-h-12 rounded-xl border px-2 py-2 text-center text-xs font-semibold transition sm:text-sm ${
              filter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}>
            {optionLabel} <span className="ml-1 opacity-75">({counts[value]})</span>
          </button>
        ))}
      </div>

      {recapNeeded.length > 0 && (
        <div className="space-y-2">
          <p className="emery-kicker px-1">Recap needed · {recapNeeded.length}</p>
          {recapNeeded.map(({ row, type }) => (
            <CommandPanel key={row.id} variant="elevated" active className="p-3.5">
              <div className="flex items-start gap-3">
                <div className="emery-icon-well flex size-9 shrink-0 rounded-xl">
                  <Clock3 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">{row.title || labels[type]}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {labels[type]} · {dateTime(row.meeting_at)}
                  </p>
                </div>
              </div>
              <Button variant="outline" className="emery-press mt-3 h-11 w-full gap-2 rounded-xl"
                onClick={() => setEditing({
                  meetingId: row.id, activityType: type,
                  title: row.title || labels[type],
                  accountId: String(object(row.metadata)["hpo_account_id"] || object(row.metadata)["account_id"] || "") || null,
                  summary: "",
                })}>
                <CheckCircle2 className="size-4" /> Log recap to HPO account
              </Button>
              <Button
                variant="outline"
                className="emery-press mt-2 h-11 w-full gap-2 rounded-xl border-primary/20 bg-primary/[0.045]"
                onClick={() =>
                  onAskEmery(
                    `I need to recap my HPO ${labels[type]} “${row.title || labels[type]}” (calendar event ID ${row.id}) from ${dateTime(row.meeting_at)}. Ask me what happened, who I spoke with, the outcome, and any follow-up. Link it to the correct HPO account, save the activity with meeting_id ${row.id}, and mark the recap complete.`,
                    `${labels[type]} recap`,
                  )
                }
              >
                <MessageCircle className="size-4" />
                Tell Emery what happened
              </Button>
            </CommandPanel>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <p className="emery-kicker px-1 text-muted-foreground">Upcoming</p>
          {upcoming.map(({ row, type }) => (
            <CommandPanel key={row.id} className="p-3.5">
              <div className="flex items-start gap-3">
                <div className="emery-icon-well flex size-9 shrink-0 rounded-xl">
                  <CalendarDays className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">{row.title || labels[type]}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {labels[type]} · {dateTime(row.meeting_at)}
                  </p>
                  <p className="mt-1 text-[11px] text-live">
                    Upcoming · Log a recap here or tell Emery after it happens.
                  </p>
                </div>
              </div>
            </CommandPanel>
          ))}
        </div>
      )}

      {plannerNotes.length > 0 && (
        <div className="space-y-2">
          <p className="emery-kicker px-1">Planner notes to review · {plannerNotes.length}</p>
          {plannerNotes.map(({ row, type }) => (
            <CommandPanel key={row.id} className="p-3.5">
              <p className="text-sm font-semibold">{accountNames.get(row.account_id || "") || "Account"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Planner note · {dateTime(row.occurred_at)} · Not yet classified as a completed {labels[type].toLowerCase()}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{row.summary}</p>
              <Button type="button" variant="outline" className="mt-3 h-11 w-full"
                onClick={() => setEditing({
                  noteInteractionId: row.id, activityType: type,
                  title: `${labels[type]} · ${accountNames.get(row.account_id || "") || "Account"}`,
                  accountId: row.account_id,
                  summary: row.summary,
                })}>
                Review and log {labels[type].toLowerCase()}
              </Button>
            </CommandPanel>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="emery-kicker px-1 text-muted-foreground">History</p>
        {history.map(({ row, type }) => {
          const accountName = row.account_id ? accountNames.get(row.account_id) : null;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => row.account_id && onOpenAccount(row.account_id)}
              disabled={!row.account_id}
               className="emery-press emery-panel-matte min-h-[84px] w-full rounded-lg border border-l-2 border-l-live/40 px-3.5 py-3 text-left enabled:hover:border-primary/25 enabled:hover:bg-elevated disabled:cursor-default"
            >
              <span className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
                  <CheckCircle2 className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold">
                    {row.activity_title || accountName || labels[type]}
                  </span>
                  <span className="mt-0.5 block text-xs font-medium text-live">
                    {labels[type]}
                    {accountName ? ` · ${accountName}` : ""}
                  </span>
                  <span className="mt-1 block break-words text-xs leading-5 text-muted-foreground">
                    {row.summary}
                  </span>
                  {(row.outcome || row.relationship_signal) && (
                    <span className="mt-1 block text-[11px] text-foreground/85">
                      {[
                        row.outcome ? `Outcome: ${row.outcome}` : null,
                        row.relationship_signal
                          ? `Signal: ${String(row.relationship_signal).replaceAll("_", " ")}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {dateTime(row.occurred_at)}
                    {row.next_action ? ` · Next: ${row.next_action}` : ""}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
        {!history.length && !recapNeeded.length && !upcoming.length && !plannerNotes.length && (
          <CommandPanel className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No activity in this category yet.</p>
          </CommandPanel>
        )}
      </div>

      {editing && (
        <ActivityLogDialog
          initial={editing} accounts={data.accounts}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onSaved(); }}
        />
      )}

      {data.hasMore && (
        <Button variant="outline" className="emery-press h-11 w-full rounded-xl" onClick={onMore} disabled={loading}>
          {loading ? "Loading…" : "Earlier activity"}
        </Button>
      )}
    </section>
  );
}

type LogDraft = {
  meetingId?: string;
  noteInteractionId?: string;
  activityType: ActivityType;
  title: string;
  accountId: string | null;
  summary: string;
};
function ActivityLogDialog({ initial, accounts, onClose, onSaved }: {
  initial: LogDraft; accounts: Account[]; onClose: () => void; onSaved: () => void;
}) {
  const save = useServerFn(saveHpoActivityLog);
  const [kind, setKind] = useState<ActivityType>(initial.activityType);
  const [accountId, setAccountId] = useState(initial.accountId || "");
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-background/75 p-2 sm:items-center" role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Log HPO activity"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-xl">
        <h2 className="text-base font-semibold">Log relationship activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Confirm what actually happened. Emery saves the activity and links it to the account history.
          Do not enter patient details.
        </p>
        <form className="mt-4 space-y-3" onSubmit={async (event) => {
          event.preventDefault(); setBusy(true); setError("");
          try {
            await save({ data: {
              activityType: kind, meetingId: initial.meetingId,
              noteInteractionId: initial.noteInteractionId,
              accountId: accountId || null, title, summary, outcome, nextAction,
            }});
            onSaved();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not save this activity.");
          } finally { setBusy(false); }
        }}>
          <label className="block text-xs font-semibold">Activity type
            <select value={kind} onChange={(e) => setKind(e.target.value as ActivityType)}
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base">
              {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold">Account {kind === "office_visit" ? "(required)" : "(choose when applicable)"}
            <select value={accountId} disabled={Boolean(initial.noteInteractionId)}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base">
              <option value="">Not linked / multiple accounts</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold">Activity name
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={250}
              required className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base"/>
          </label>
          <label className="block text-xs font-semibold">What happened? Who did you speak with?
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
              rows={4} maxLength={6000} required
              className="mt-1 w-full rounded-lg border border-border bg-card p-3 text-base"/>
          </label>
          <label className="block text-xs font-semibold">Outcome (optional)
            <input value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={1500}
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base"/>
          </label>
          <label className="block text-xs font-semibold">Next action (optional)
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} maxLength={500}
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base"/>
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">Cancel</Button>
            <Button type="submit" disabled={busy || !summary.trim() || (kind === "office_visit" && !accountId)}
              className="h-11 flex-1">{busy ? "Saving…" : "Save to Activity"}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
