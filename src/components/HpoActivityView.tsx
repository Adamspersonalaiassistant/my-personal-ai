import { useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type ActivityType = "office_visit" | "lunch" | "dinner" | "event";
type Account = { id: string; name: string };
type Interaction = {
  id: string;
  account_id: string | null;
  interaction_type: string;
  activity_type?: string | null;
  activity_title?: string | null;
  meeting_id?: string | null;
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
  loading: boolean;
};

const options: Array<["all" | ActivityType, string]> = [
  ["all", "All activity"],
  ["office_visit", "Office visits"],
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
  const value = String(meta["hpo_activity_type"] || meta["event_type"] || "").toLowerCase();
  if (value === "visit" || value === "office_visit") return "office_visit";
  if (value === "lunch" || value === "dinner" || value === "event") {
    return value as ActivityType;
  }
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

export function HpoActivityView({ data, onOpenAccount, onAskEmery, onMore, loading }: Props) {
  const [filter, setFilter] = useState<"all" | ActivityType>("all");
  const accountNames = new Map(data.accounts.map((account) => [account.id, account.name]));
  const loggedMeetingIds = new Set(
    data.interactions.map((row) => row.meeting_id).filter((id): id is string => Boolean(id)),
  );
  const history = data.interactions
    .map((row) => ({ row, type: interactionType(row) }))
    .filter((item): item is { row: Interaction; type: ActivityType } => Boolean(item.type))
    .filter((item) => filter === "all" || item.type === filter);
  const scheduled = data.meetings
    .map((row) => ({ row, type: meetingType(row) }))
    .filter((item): item is { row: Meeting; type: ActivityType } => Boolean(item.type))
    .filter((item) => !loggedMeetingIds.has(item.row.id))
    .filter((item) => filter === "all" || item.type === filter)
    .sort((a, b) => Date.parse(a.row.meeting_at) - Date.parse(b.row.meeting_at));
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
    <section className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Activity</h1>
          <p className="text-xs text-muted-foreground">Office visits, meals, and relationship events</p>
        </div>
        <Button className="h-11 px-3 text-xs" onClick={() => onAskEmery(addPrompt, "Add activity")}>
          <Plus className="size-4" /> Add
        </Button>
      </div>

      <label className="block">
        <span className="sr-only">Activity type</span>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as "all" | ActivityType)}
          className="h-12 w-full rounded-xl border border-border bg-card px-3 text-base text-foreground outline-none focus:border-primary"
        >
          {options.map(([value, optionLabel]) => (
            <option key={value} value={value}>
              {optionLabel}
            </option>
          ))}
        </select>
      </label>

      {recapNeeded.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
            Recap needed · {recapNeeded.length}
          </h2>
          {recapNeeded.map(({ row, type }) => (
            <article key={row.id} className="rounded-2xl border border-primary/30 bg-card p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">{row.title || labels[type]}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {labels[type]} · {dateTime(row.meeting_at)}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-3 h-11 w-full gap-2"
                onClick={() =>
                  onAskEmery(
                    `I need to recap my HPO ${labels[type]} “${row.title || labels[type]}” from ${dateTime(row.meeting_at)}. Ask me what happened, who I spoke with, the outcome, and any follow-up, then save it under HPO Activity → ${labels[type]}.`,
                    `${labels[type]} recap`,
                  )
                }
              >
                <MessageCircle className="size-4" /> Tell Emery what happened
              </Button>
            </article>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Upcoming
          </h2>
          {upcoming.map(({ row, type }) => (
            <article key={row.id} className="rounded-2xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">{row.title || labels[type]}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {labels[type]} · {dateTime(row.meeting_at)}
                  </p>
                  <p className="mt-1 text-[11px] text-primary">
                    Emery will ask for a recap the next morning.
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          History
        </h2>
        {history.map(({ row, type }) => {
          const accountName = row.account_id ? accountNames.get(row.account_id) : null;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => row.account_id && onOpenAccount(row.account_id)}
              disabled={!row.account_id}
              className="min-h-[84px] w-full rounded-2xl border border-border bg-card px-3 py-3 text-left shadow-sm enabled:hover:bg-muted/40 disabled:cursor-default"
            >
              <span className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold">
                    {row.activity_title || accountName || labels[type]}
                  </span>
                  <span className="mt-0.5 block text-xs font-medium text-primary">
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
        {!history.length && !recapNeeded.length && !upcoming.length && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No activity in this category yet.
          </p>
        )}
      </div>

      {data.hasMore && (
        <Button variant="outline" className="h-11 w-full" onClick={onMore} disabled={loading}>
          {loading ? "Loading…" : "Earlier activity"}
        </Button>
      )}
    </section>
  );
}
