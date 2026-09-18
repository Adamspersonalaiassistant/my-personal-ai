/* eslint-disable @typescript-eslint/no-explicit-any */
type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
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
    text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 2),
  );
}

function scoreText(text: string, requestTokens: Set<string>) {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of requestTokens) if (haystack.includes(token)) score += 1;
  return score;
}

/** Load bounded, user-owned, non-PHI HPO operating context. */
export async function loadHpoAgentContext(db: any, userId: string, assignment: string) {
  const now = new Date();
  const nowIso = now.toISOString();
  const requestTokens = tokens(assignment);

  const [accountsResult, interactionsResult, metricsResult, routesResult, tasksResult, meetingsResult, documentsResult] = await Promise.all([
    db.from("hpo_accounts").select("id, name, account_type, specialty, territory, city, address, priority, owner_name, relationship_stage, status, notes, last_touch_at, next_action, next_action_due_at, metadata").eq("user_id", userId).eq("status", "active").order("priority", { ascending: false }).limit(80),
    db.from("hpo_interactions").select("id, account_id, interaction_type, occurred_at, summary, outcome, relationship_signal, next_action, next_action_due_at, source_type").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(100),
    db.from("hpo_sales_metrics").select("account_id, period_start, period_end, referral_count, entered_care_count, progressing_count, blocked_exception_count, relationship_impact_count, notes").eq("user_id", userId).order("period_end", { ascending: false }).limit(60),
    db.from("hpo_route_plans").select("id, route_date, area, status, start_window, end_window, notes, metadata").eq("user_id", userId).gte("route_date", nowIso.slice(0, 10)).order("route_date", { ascending: true }).limit(10),
    db.from("tasks").select("id, title, details, status, priority, due_at, metadata").eq("user_id", userId).neq("status", "completed").order("priority", { ascending: false }).limit(80),
    db.from("meetings").select("id, title, meeting_at, participants, metadata").eq("user_id", userId).gte("meeting_at", nowIso).order("meeting_at", { ascending: true }).limit(50),
    db.from("documents").select("id, title, document_type, extracted_text, summary, source, metadata, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(60),
  ]);

  for (const result of [accountsResult, interactionsResult, metricsResult, routesResult, tasksResult, meetingsResult, documentsResult]) {
    if (result.error) throw result.error;
  }

  const accounts = accountsResult.data ?? [];
  const accountMap = new Map<string, any>(accounts.map((account: any) => [account.id, account]));
  const rankedAccounts = accounts.map((account: any) => ({ account, relevance: scoreText([account.name, account.account_type, account.specialty, account.territory, account.city, account.owner_name, account.relationship_stage, account.next_action, account.notes].filter(Boolean).join(" "), requestTokens) + Number(account.priority ?? 3) / 10 })).sort((a: any, b: any) => b.relevance - a.relevance).slice(0, 20).map(({ account }: any) => account);
  const selectedAccountIds = new Set(rankedAccounts.map((account: any) => account.id));
  const interactions = (interactionsResult.data ?? []).filter((interaction: any) => selectedAccountIds.has(interaction.account_id)).slice(0, 30).map((interaction: any) => ({ ...interaction, account_name: accountMap.get(interaction.account_id)?.name ?? "Unknown account" }));
  const metrics = (metricsResult.data ?? []).filter((metric: any) => !metric.account_id || selectedAccountIds.has(metric.account_id)).slice(0, 24).map((metric: any) => ({ ...metric, account_name: metric.account_id ? (accountMap.get(metric.account_id)?.name ?? null) : null }));
  const hpoTasks = (tasksResult.data ?? []).filter((task: any) => hpoTagged(task.metadata)).slice(0, 12);
  const hpoMeetings = (meetingsResult.data ?? []).filter((meeting: any) => hpoTagged(meeting.metadata)).slice(0, 10);
  const overdue = rankedAccounts.filter((account: any) => account.next_action_due_at && Date.parse(account.next_action_due_at) < now.getTime()).slice(0, 8).map((account: any) => ({ id: account.id, name: account.name, next_action: account.next_action, due_at: account.next_action_due_at }));

  // Knowledge documents are user-owned via RLS. Only HPO-tagged, explicitly non-PHI documents are eligible.
  const hpoKnowledge = (documentsResult.data ?? [])
    .filter((doc: any) => hpoTagged(doc.metadata) && object(doc.metadata)["contains_phi"] !== true)
    .map((doc: any) => ({ ...doc, relevance: scoreText([doc.title, doc.document_type, doc.summary, doc.extracted_text].filter(Boolean).join(" "), requestTokens) }))
    .sort((a: any, b: any) => b.relevance - a.relevance)
    .slice(0, 6)
    .map((doc: any) => ({ id: doc.id, title: doc.title, document_type: doc.document_type, summary: doc.summary, source: doc.source, knowledge: String(doc.extracted_text ?? "").slice(0, 9000), metadata: doc.metadata }));

  return {
    privacy_boundary: "Referral-source/account intelligence, professional relationship history, non-PHI HPO knowledge and aggregate workflow signals only. No patient names, DOBs, diagnoses, claims/case details, medical records, or other PHI should be present or requested.",
    mentor_instruction: "Act as Adam's advanced Hudson Pro mentor and VP Sales command partner. Use his historical field knowledge and provenance, distinguish historical from current facts, verify fresh facts when material, challenge weak assumptions, surface reactivation opportunities, give the highest-leverage action first, and teach reusable principles rather than repeating Sales 101.",
    hpo_knowledge_base: hpoKnowledge,
    accounts: rankedAccounts,
    recent_relationship_interactions: interactions,
    aggregate_sales_referral_metrics: metrics,
    upcoming_routes: routesResult.data ?? [],
    hpo_tasks: hpoTasks,
    hpo_meetings_events: hpoMeetings,
    overdue_relationship_actions: overdue,
  };
}
