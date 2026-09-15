/* eslint-disable @typescript-eslint/no-explicit-any */
type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function hpoTagged(value: unknown) {
  const metadata = object(value);
  return (
    metadata["domain"] === "hpo" ||
    metadata["hpo"] === true ||
    typeof metadata["hpo_account_id"] === "string"
  );
}

function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function scoreText(text: string, requestTokens: Set<string>) {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of requestTokens) if (haystack.includes(token)) score += 1;
  return score;
}

/**
 * Load a bounded, non-PHI HPO operating context for HPO Agent only.
 * The HPO schema intentionally stores referral-source relationship intelligence
 * and aggregate workflow signals, not patient/case records.
 */
export async function loadHpoAgentContext(db: any, userId: string, assignment: string) {
  const now = new Date();
  const nowIso = now.toISOString();
  const requestTokens = tokens(assignment);

  const [accountsResult, interactionsResult, metricsResult, routesResult, tasksResult, meetingsResult] =
    await Promise.all([
      db
        .from("hpo_accounts")
        .select(
          "id, name, account_type, specialty, territory, city, address, priority, owner_name, relationship_stage, status, notes, last_touch_at, next_action, next_action_due_at, metadata",
        )
        .eq("user_id", userId)
        .eq("status", "active")
        .order("priority", { ascending: false })
        .limit(80),
      db
        .from("hpo_interactions")
        .select(
          "id, account_id, interaction_type, occurred_at, summary, outcome, relationship_signal, next_action, next_action_due_at, source_type",
        )
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(100),
      db
        .from("hpo_sales_metrics")
        .select(
          "account_id, period_start, period_end, referral_count, entered_care_count, progressing_count, blocked_exception_count, relationship_impact_count, notes",
        )
        .eq("user_id", userId)
        .order("period_end", { ascending: false })
        .limit(60),
      db
        .from("hpo_route_plans")
        .select("id, route_date, area, status, start_window, end_window, notes, metadata")
        .eq("user_id", userId)
        .gte("route_date", nowIso.slice(0, 10))
        .order("route_date", { ascending: true })
        .limit(10),
      db
        .from("tasks")
        .select("id, title, details, status, priority, due_at, metadata")
        .eq("user_id", userId)
        .neq("status", "completed")
        .order("priority", { ascending: false })
        .limit(80),
      db
        .from("meetings")
        .select("id, title, meeting_at, participants, metadata")
        .eq("user_id", userId)
        .gte("meeting_at", nowIso)
        .order("meeting_at", { ascending: true })
        .limit(50),
    ]);

  for (const result of [
    accountsResult,
    interactionsResult,
    metricsResult,
    routesResult,
    tasksResult,
    meetingsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const accounts = accountsResult.data ?? [];
  const accountMap = new Map<string, any>(accounts.map((account: any) => [account.id, account]));

  const rankedAccounts = accounts
    .map((account: any) => ({
      account,
      relevance:
        scoreText(
          [
            account.name,
            account.account_type,
            account.specialty,
            account.territory,
            account.city,
            account.owner_name,
            account.relationship_stage,
            account.next_action,
            account.notes,
          ]
            .filter(Boolean)
            .join(" "),
          requestTokens,
        ) + Number(account.priority ?? 3) / 10,
    }))
    .sort((a: any, b: any) => b.relevance - a.relevance)
    .slice(0, 20)
    .map(({ account }: any) => account);

  const selectedAccountIds = new Set(rankedAccounts.map((account: any) => account.id));
  const interactions = (interactionsResult.data ?? [])
    .filter((interaction: any) => selectedAccountIds.has(interaction.account_id))
    .slice(0, 30)
    .map((interaction: any) => ({
      ...interaction,
      account_name: accountMap.get(interaction.account_id)?.name ?? "Unknown account",
    }));

  const metrics = (metricsResult.data ?? [])
    .filter(
      (metric: any) => !metric.account_id || selectedAccountIds.has(metric.account_id),
    )
    .slice(0, 24)
    .map((metric: any) => ({
      ...metric,
      account_name: metric.account_id ? accountMap.get(metric.account_id)?.name ?? null : null,
    }));

  const hpoTasks = (tasksResult.data ?? [])
    .filter((task: any) => hpoTagged(task.metadata))
    .slice(0, 12);
  const hpoMeetings = (meetingsResult.data ?? [])
    .filter((meeting: any) => hpoTagged(meeting.metadata))
    .slice(0, 10);

  const overdue = rankedAccounts
    .filter(
      (account: any) =>
        account.next_action_due_at && Date.parse(account.next_action_due_at) < now.getTime(),
    )
    .slice(0, 8)
    .map((account: any) => ({
      id: account.id,
      name: account.name,
      next_action: account.next_action,
      due_at: account.next_action_due_at,
    }));

  return {
    privacy_boundary:
      "Referral-source/account intelligence and aggregate workflow signals only. No patient names, DOBs, diagnoses, claims/case details, medical records, or other PHI should be present or requested.",
    accounts: rankedAccounts,
    recent_relationship_interactions: interactions,
    aggregate_sales_referral_metrics: metrics,
    upcoming_routes: routesResult.data ?? [],
    hpo_tasks: hpoTasks,
    hpo_meetings_events: hpoMeetings,
    overdue_relationship_actions: overdue,
  };
}
