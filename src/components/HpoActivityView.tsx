import { useState } from "react";
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

      <label className="block">
        <span className="sr-only">Activity type</span>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as "all" | ActivityType)}
          className="h-12 w-full rounded-xl border border-border/70 bg-elevated px-3 text-base text-foreground outline-none transition focus:border-primary"
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
              <Button
                variant="outline"
                className="emery-press mt-3 h-11 w-full gap-2 rounded-xl border-primary/20 bg-primary/[0.045]"
                onClick={() =>
                  onAskEmery(
                    `I need to recap my HPO ${labels[type]} “${row.title || labels[type]}” from ${dateTime(row.meeting_at)}. Ask me what happened, who I spoke with, the outcome, and any follow-up, then save it under HPO Activity → ${labels[type]}.`,
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
                    Emery will ask for a recap the next morning.
                  </p>
                </div>
              </div>
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
        {!history.length && !recapNeeded.length && !upcoming.length && (
          <CommandPanel className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No activity in this category yet.</p>
          </CommandPanel>
        )}
      </div>

      {data.hasMore && (
        <Button variant="outline" className="emery-press h-11 w-full rounded-xl" onClick={onMore} disabled={loading}>
          {loading ? "Loading…" : "Earlier activity"}
        </Button>
      )}
    </section>
  );
}
