const DAY_MS = 86_400_000;

export type HpoAttentionState = "overdue" | "due_soon" | "never_visited" | "stale" | "current";

type AccountSignalSource = {
  last_touch_at?: string | null;
  next_action?: string | null;
  next_action_due_at?: string | null;
};

export function latestHpoTimestamp(values: Array<string | null | undefined>) {
  let latest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (latest === null || parsed > latest) latest = parsed;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

export function daysSinceHpoTimestamp(value: string | null | undefined, now = Date.now()) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / DAY_MS));
}

export function deriveHpoAccountIntelligence(
  account: AccountSignalSource,
  lastVisitAt: string | null,
  now = Date.now(),
) {
  const hasFollowUp = Boolean(account.next_action?.trim());
  const dueAt = account.next_action_due_at ? Date.parse(account.next_action_due_at) : Number.NaN;
  const followUpDueInDays =
    hasFollowUp && Number.isFinite(dueAt) ? Math.ceil((dueAt - now) / DAY_MS) : null;
  const lastRelationshipTouch = latestHpoTimestamp([account.last_touch_at, lastVisitAt]);
  const daysSinceRelationshipTouch = daysSinceHpoTimestamp(lastRelationshipTouch, now);
  let attentionState: HpoAttentionState;

  if (followUpDueInDays !== null && followUpDueInDays < 0) attentionState = "overdue";
  else if (followUpDueInDays !== null && followUpDueInDays <= 7) attentionState = "due_soon";
  else if (!lastVisitAt) attentionState = "never_visited";
  else if (daysSinceRelationshipTouch !== null && daysSinceRelationshipTouch >= 45)
    attentionState = "stale";
  else attentionState = "current";

  return {
    last_visit_at: lastVisitAt,
    days_since_visit: daysSinceHpoTimestamp(lastVisitAt, now),
    attention_state: attentionState,
    follow_up_due_in_days: followUpDueInDays,
  };
}
