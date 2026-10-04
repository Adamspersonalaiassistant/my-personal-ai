/* eslint-disable @typescript-eslint/no-explicit-any */
import { rankHpoRelationshipAccounts } from "@/lib/emery/hpo-smart-relevance";

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

/** Load bounded, user-owned, non-PHI HPO operating context. */
export async function loadHpoAgentContext(db: any, userId: string, assignment: string) {
  const now = new Date();
  const nowIso = now.toISOString();
  const requestTokens = tokens(assignment);

  const [
    accountsResult,
    contactsResult,
    prospectsResult,
    interactionsResult,
    metricsResult,
    routesResult,
    routeStopsResult,
    routeCandidatesResult,
    tasksResult,
    meetingsResult,
    documentsResult,
  ] = await Promise.all([
    db
      .from("hpo_accounts")
      .select(
        "id, name, account_type, specialty, territory, city, address, priority, owner_name, relationship_stage, relationship_health, status, notes, last_touch_at, next_action, next_action_due_at, opportunity, blockers, tags, metadata",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(100),
    db
      .from("hpo_contacts")
      .select("id, account_id, name, role_title, preferred_contact_method, relationship_notes")
      .eq("user_id", userId)
      .limit(160),
    db
      .from("hpo_prospects")
      .select(
        "id, name, prospect_type, specialty, territory, city, address, phone, website, fit_status, verification_status, source_type, source_ref, promoted_account_id, notes, metadata",
      )
      .eq("user_id", userId)
      .in("fit_status", ["qualified", "undecided", "promoted"])
      .order("updated_at", { ascending: false })
      .limit(120),
    db
      .from("hpo_interactions")
      .select(
        "id, account_id, contact_id, interaction_type, occurred_at, summary, outcome, relationship_signal, next_action, next_action_due_at, source_type, source_ref",
      )
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(120),
    db
      .from("hpo_sales_metrics")
      .select(
        "account_id, period_start, period_end, referral_count, entered_care_count, progressing_count, blocked_exception_count, relationship_impact_count, notes",
      )
      .eq("user_id", userId)
      .order("period_end", { ascending: false })
      .limit(80),
    db
      .from("hpo_route_plans")
      .select(
        "id, route_date, area, status, start_window, end_window, notes, source_type, source_ref, metadata",
      )
      .eq("user_id", userId)
      .gte("route_date", nowIso.slice(0, 10))
      .order("route_date", { ascending: true })
      .limit(12),
    db
      .from("hpo_route_stops")
      .select(
        "id, route_id, account_id, prospect_id, stop_order, visit_priority, status, visited_at, office_name, visit_summary, visit_outcome, next_action, next_action_due_at, metadata",
      )
      .eq("user_id", userId)
      .order("visited_at", { ascending: false, nullsFirst: false })
      .limit(120),
    db.rpc("get_hpo_route_candidates", { p_user_id: userId, p_territory: null, p_limit: 30 }),
    db
      .from("tasks")
      .select("id, title, details, status, priority, due_at, metadata")
      .eq("user_id", userId)
      .neq("status", "completed")
      .order("priority", { ascending: false })
      .limit(80),
    db
      .from("meetings")
      .select("id, title, meeting_at, end_at, participants, metadata")
      .eq("user_id", userId)
      .gte("meeting_at", nowIso)
      .order("meeting_at", { ascending: true })
      .limit(50),
    db
      .from("documents")
      .select("id, title, document_type, extracted_text, summary, source, metadata, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  for (const result of [
    accountsResult,
    contactsResult,
    prospectsResult,
    interactionsResult,
    metricsResult,
    routesResult,
    routeStopsResult,
    routeCandidatesResult,
    tasksResult,
    meetingsResult,
    documentsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const accounts = accountsResult.data ?? [];
  const contacts = contactsResult.data ?? [];
  const prospects = prospectsResult.data ?? [];
  const accountMap = new Map<string, any>(accounts.map((account: any) => [account.id, account]));
  const contactMap = new Map<string, any>(contacts.map((contact: any) => [contact.id, contact]));
  const activeRouteAccountIds = (routeStopsResult.data ?? [])
    .filter(
      (stop: any) =>
        stop.account_id &&
        !["completed", "visited", "skipped", "closed", "bad_address"].includes(
          String(stop.status ?? ""),
        ),
    )
    .map((stop: any) => String(stop.account_id));
  const smartAccountRanks = rankHpoRelationshipAccounts({
    query: assignment,
    accounts,
    contacts,
    interactions: interactionsResult.data ?? [],
    currentRouteAccountIds: activeRouteAccountIds,
    limit: 40,
  });
  const smartAccountScore = new Map(
    smartAccountRanks.map((rank, index) => [
      rank.accountId,
      rank.score + Math.max(0, 4 - index * 0.08),
    ]),
  );

  const rankedAccounts = accounts
    .map((account: any) => ({
      account,
      relevance:
        (smartAccountScore.get(String(account.id)) ??
          scoreText(
            [
              account.name,
              account.account_type,
              account.specialty,
              account.territory,
              account.city,
              account.owner_name,
              account.relationship_stage,
              account.relationship_health,
              account.next_action,
              account.opportunity,
              account.blockers,
              account.notes,
              ...(Array.isArray(account.tags) ? account.tags : []),
            ]
              .filter(Boolean)
              .join(" "),
            requestTokens,
          ) +
            Number(account.priority ?? 3) / 10) +
        Math.min(Number(account.metadata?.historical_referral_count ?? 0), 150) / 500,
    }))
    .sort((a: any, b: any) => b.relevance - a.relevance)
    .slice(0, 24)
    .map(({ account }: any) => account);

  const rankedProspects = prospects
    .filter((prospect: any) => prospect.fit_status !== "promoted" || prospect.promoted_account_id)
    .map((prospect: any) => ({
      prospect,
      relevance:
        scoreText(
          [
            prospect.name,
            prospect.prospect_type,
            prospect.specialty,
            prospect.territory,
            prospect.city,
            prospect.notes,
          ]
            .filter(Boolean)
            .join(" "),
          requestTokens,
        ) +
        Number(prospect.metadata?.internal_priority ?? 3) / 10 +
        Number(prospect.metadata?.prospect_score ?? 0) / 100,
    }))
    .sort((a: any, b: any) => b.relevance - a.relevance)
    .slice(0, 30)
    .map(({ prospect }: any) => prospect);

  const selectedAccountIds = new Set(rankedAccounts.map((account: any) => account.id));
  const interactions = (interactionsResult.data ?? [])
    .filter((interaction: any) => selectedAccountIds.has(interaction.account_id))
    .slice(0, 40)
    .map((interaction: any) => ({
      ...interaction,
      account_name: accountMap.get(interaction.account_id)?.name ?? "Unknown account",
      contact_name: interaction.contact_id
        ? (contactMap.get(interaction.contact_id)?.name ?? null)
        : null,
    }));

  const metrics = (metricsResult.data ?? [])
    .filter((metric: any) => !metric.account_id || selectedAccountIds.has(metric.account_id))
    .slice(0, 30)
    .map((metric: any) => ({
      ...metric,
      account_name: metric.account_id ? (accountMap.get(metric.account_id)?.name ?? null) : null,
    }));

  const hpoTasks = (tasksResult.data ?? [])
    .filter((task: any) => hpoTagged(task.metadata))
    .slice(0, 16);
  const hpoMeetings = (meetingsResult.data ?? [])
    .filter((meeting: any) => hpoTagged(meeting.metadata))
    .slice(0, 12);
  const overdue = rankedAccounts
    .filter(
      (account: any) =>
        account.next_action_due_at && Date.parse(account.next_action_due_at) < now.getTime(),
    )
    .slice(0, 10)
    .map((account: any) => ({
      id: account.id,
      name: account.name,
      next_action: account.next_action,
      due_at: account.next_action_due_at,
    }));

  const hpoKnowledge = (documentsResult.data ?? [])
    .filter((doc: any) => hpoTagged(doc.metadata) && object(doc.metadata)["contains_phi"] !== true)
    .map((doc: any) => ({
      ...doc,
      relevance: scoreText(
        [doc.title, doc.document_type, doc.summary, doc.extracted_text].filter(Boolean).join(" "),
        requestTokens,
      ),
    }))
    .sort((a: any, b: any) => b.relevance - a.relevance)
    .slice(0, 6)
    .map((doc: any) => ({
      id: doc.id,
      title: doc.title,
      document_type: doc.document_type,
      summary: doc.summary,
      source: doc.source,
      knowledge: String(doc.extracted_text ?? "").slice(0, 9000),
      metadata: doc.metadata,
    }));

  return {
    privacy_boundary:
      "Referral-source/account intelligence, professional relationship history, non-PHI HPO knowledge and aggregate workflow signals only. No patient names, DOBs, diagnoses, claims/case details, medical records, or other PHI should be present or requested.",
    mentor_instruction:
      "Act as Adam's advanced Hudson Pro mentor and VP Sales command partner. Think like a strong field-sales and relationship leader, not a generic route app. Before recommending offices, review the available account history, prior visit notes and outcomes, relationship stage, follow-up commitments, recency, opportunity, blockers, historical referral context, prospect quality, account ownership and exclusions. Prefer legitimate warm follow-ups, overdue commitments, reactivation opportunities and high-fit prospects over random cold stops. Explain why an office matters now and what Adam should try to accomplish there. Choose business-value stops first, then optimize road order so route efficiency never silently overrides sales value. Treat each new non-PHI visit note as evidence that should improve future recommendations. Distinguish historical from current facts, use verified addresses for route recommendations, give the highest-leverage action first, and never invent missing office or relationship facts.",
    sales_route_playbook: {
      objective:
        "Grow durable referral relationships by choosing the right offices before optimizing the driving order.",
      review_before_recommending: [
        "account priority and ownership/exclusion rules",
        "relationship stage and health",
        "latest visit notes, outcomes and relationship signals",
        "open or overdue next actions",
        "time since last meaningful touch",
        "documented opportunities and blockers",
        "historical referral context when available",
        "verified prospect fit and research quality",
      ],
      recommendation_rule:
        "Rank for business value first. Explain why-now and the visit objective. Then optimize the approved shortlist for road time.",
      learning_loop:
        "Completed visit notes and follow-ups become future relationship evidence; do not treat route planning as a static address list.",
    },
    retrieval_policy: {
      authority:
        "Structured HPO CRM truth outranks personal durable memory and model inference for account, contact, interaction, route, and referral facts.",
      ranking:
        "Current/active-route relationship evidence, matching structured interactions and contacts, explicit account fields, recency, and account priority are ranked before generic lexical account matches.",
    },
    data_health: {
      active_accounts: accounts.length,
      contacts: contacts.length,
      qualified_or_promoted_prospects: prospects.length,
      structured_interactions: interactionsResult.data?.length ?? 0,
      structured_route_stops: routeStopsResult.data?.length ?? 0,
    },
    hpo_knowledge_base: hpoKnowledge,
    accounts: rankedAccounts,
    contacts: contacts
      .filter((contact: any) => selectedAccountIds.has(contact.account_id))
      .slice(0, 40),
    prospects: rankedProspects,
    route_candidates: routeCandidatesResult.data ?? [],
    recent_route_history: (routeStopsResult.data ?? []).slice(0, 30),
    recent_relationship_interactions: interactions,
    aggregate_sales_referral_metrics: metrics,
    upcoming_routes: routesResult.data ?? [],
    hpo_tasks: hpoTasks,
    hpo_meetings_events: hpoMeetings,
    overdue_relationship_actions: overdue,
  };
}
