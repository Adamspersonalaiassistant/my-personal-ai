import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Json = Record<string, unknown>;

type HpoAccountInput = {
  name: string;
  accountType?: string;
  specialty?: string;
  territory?: string;
  city?: string;
  address?: string;
  priority?: number;
  ownerName?: string;
  relationshipStage?: string;
  notes?: string;
};

type HpoInteractionInput = {
  accountId: string;
  interactionType?: string;
  occurredAt?: string;
  summary: string;
  outcome?: string;
  relationshipSignal?: string;
  nextAction?: string;
  nextActionDueAt?: string | null;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function isHpoMetadata(value: unknown) {
  const metadata = object(value);
  return metadata["domain"] === "hpo" || metadata["hpo"] === true || typeof metadata["hpo_account_id"] === "string";
}

function clampPriority(value: unknown) {
  return Math.min(5, Math.max(1, Number(value ?? 3)));
}

export const getHpoDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const db = supabase as any;
    const now = new Date();
    const nowIso = now.toISOString();
    const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const [accountsResult, interactionsResult, metricsResult, routesResult, tasksResult, meetingsResult, importsResult] =
      await Promise.all([
        db
          .from("hpo_accounts")
          .select("id, name, account_type, specialty, territory, city, address, priority, owner_name, relationship_stage, status, notes, last_touch_at, next_action, next_action_due_at, metadata, updated_at")
          .eq("user_id", userId)
          .eq("status", "active")
          .order("priority", { ascending: false })
          .order("next_action_due_at", { ascending: true, nullsFirst: false })
          .limit(100),
        db
          .from("hpo_interactions")
          .select("id, account_id, interaction_type, occurred_at, summary, outcome, relationship_signal, next_action, next_action_due_at, source_type")
          .eq("user_id", userId)
          .order("occurred_at", { ascending: false })
          .limit(30),
        db
          .from("hpo_sales_metrics")
          .select("id, account_id, period_start, period_end, referral_count, entered_care_count, progressing_count, blocked_exception_count, relationship_impact_count, notes")
          .eq("user_id", userId)
          .order("period_end", { ascending: false })
          .limit(24),
        db
          .from("hpo_route_plans")
          .select("id, route_date, area, status, start_window, end_window, notes, metadata")
          .eq("user_id", userId)
          .gte("route_date", nowIso.slice(0, 10))
          .order("route_date", { ascending: true })
          .limit(7),
        db
          .from("tasks")
          .select("id, title, details, status, priority, due_at, project_id, metadata")
          .eq("user_id", userId)
          .neq("status", "completed")
          .order("priority", { ascending: false })
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(100),
        db
          .from("meetings")
          .select("id, title, meeting_at, participants, metadata")
          .eq("user_id", userId)
          .gte("meeting_at", nowIso)
          .lte("meeting_at", inThirtyDays)
          .order("meeting_at", { ascending: true })
          .limit(50),
        db
          .from("hpo_data_imports")
          .select("id, source_type, source_name, status, row_count, imported_count, rejected_count, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

    for (const result of [accountsResult, interactionsResult, metricsResult, routesResult, tasksResult, meetingsResult, importsResult]) {
      if (result.error) throw result.error;
    }

    const accounts = accountsResult.data ?? [];
    const interactions = interactionsResult.data ?? [];
    const metrics = metricsResult.data ?? [];
    const hpoTasks = (tasksResult.data ?? []).filter((task: any) => isHpoMetadata(task.metadata));
    const hpoMeetings = (meetingsResult.data ?? []).filter((meeting: any) => isHpoMetadata(meeting.metadata));
    const accountNames = new Map(accounts.map((account: any) => [account.id, account.name]));

    const overdueFollowups = accounts.filter(
      (account: any) => account.next_action_due_at && Date.parse(account.next_action_due_at) < now.getTime(),
    );
    const coldThreshold = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const coldAccounts = accounts.filter(
      (account: any) => account.last_touch_at && Date.parse(account.last_touch_at) < coldThreshold,
    );
    const untappedAccounts = accounts.filter((account: any) => !account.last_touch_at);

    const latestPeriodEnd = metrics[0]?.period_end ?? null;
    const currentMetrics = latestPeriodEnd
      ? metrics.filter((metric: any) => metric.period_end === latestPeriodEnd)
      : [];
    const totals = currentMetrics.reduce(
      (sum: any, metric: any) => ({
        referrals: sum.referrals + Number(metric.referral_count ?? 0),
        enteredCare: sum.enteredCare + Number(metric.entered_care_count ?? 0),
        progressing: sum.progressing + Number(metric.progressing_count ?? 0),
        blocked: sum.blocked + Number(metric.blocked_exception_count ?? 0),
        relationshipImpact: sum.relationshipImpact + Number(metric.relationship_impact_count ?? 0),
      }),
      { referrals: 0, enteredCare: 0, progressing: 0, blocked: 0, relationshipImpact: 0 },
    );

    const workFocus = hpoTasks[0]
      ? { type: "task", title: hpoTasks[0].title, detail: hpoTasks[0].due_at ?? null }
      : overdueFollowups[0]
        ? {
            type: "followup",
            title: overdueFollowups[0].next_action || `Follow up with ${overdueFollowups[0].name}`,
            detail: overdueFollowups[0].name,
          }
        : accounts[0]
          ? {
              type: "relationship",
              title: accounts[0].next_action || `Strengthen ${accounts[0].name}`,
              detail: accounts[0].name,
            }
          : null;

    return {
      workFocus,
      accounts,
      accountNames: Object.fromEntries(accountNames),
      recentInteractions: interactions,
      hpoTasks,
      hpoMeetings,
      routes: routesResult.data ?? [],
      recentImports: importsResult.data ?? [],
      metrics: {
        periodEnd: latestPeriodEnd,
        ...totals,
        hasData: currentMetrics.length > 0,
      },
      signals: {
        overdueFollowups: overdueFollowups.length,
        coldAccounts: coldAccounts.length,
        untappedAccounts: untappedAccounts.length,
        activeAccounts: accounts.length,
      },
    };
  });

export const listHpoAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("hpo_accounts")
      .select("id, name, account_type, specialty, territory, city, address, priority, owner_name, relationship_stage, status, notes, last_touch_at, next_action, next_action_due_at, metadata, created_at, updated_at")
      .eq("user_id", context.userId)
      .order("priority", { ascending: false })
      .order("name", { ascending: true });
    if (error) throw error;
    return { accounts: data ?? [] };
  });

export const createHpoAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: HpoAccountInput) => {
    const name = input?.name?.trim();
    if (!name) throw new Error("Account name is required");
    return {
      name,
      accountType: input.accountType?.trim() || null,
      specialty: input.specialty?.trim() || null,
      territory: input.territory?.trim() || null,
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      priority: clampPriority(input.priority),
      ownerName: input.ownerName?.trim() || null,
      relationshipStage: input.relationshipStage?.trim() || "prospect",
      notes: input.notes?.trim() || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: account, error } = await context.supabase
      .from("hpo_accounts")
      .insert({
        user_id: context.userId,
        name: data.name,
        account_type: data.accountType,
        specialty: data.specialty,
        territory: data.territory,
        city: data.city,
        address: data.address,
        priority: data.priority,
        owner_name: data.ownerName,
        relationship_stage: data.relationshipStage,
        notes: data.notes,
        source_origin: "manual",
      })
      .select("id, name")
      .single();
    if (error) throw error;
    return account;
  });

export const logHpoInteraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: HpoInteractionInput) => {
    if (!input?.accountId) throw new Error("Account is required");
    const summary = input.summary?.trim();
    if (!summary) throw new Error("Interaction summary is required");
    return {
      accountId: String(input.accountId),
      interactionType: input.interactionType?.trim() || "visit",
      occurredAt: input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt)) ? input.occurredAt : new Date().toISOString(),
      summary,
      outcome: input.outcome?.trim() || null,
      relationshipSignal: input.relationshipSignal?.trim() || null,
      nextAction: input.nextAction?.trim() || null,
      nextActionDueAt:
        input.nextActionDueAt && !Number.isNaN(Date.parse(input.nextActionDueAt))
          ? input.nextActionDueAt
          : null,
    };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: ownedAccount, error: accountError } = await db
      .from("hpo_accounts")
      .select("id, name")
      .eq("id", data.accountId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!ownedAccount) throw new Error("Account not found");

    const { data: interaction, error } = await db
      .from("hpo_interactions")
      .insert({
        user_id: context.userId,
        account_id: data.accountId,
        interaction_type: data.interactionType,
        occurred_at: data.occurredAt,
        summary: data.summary,
        outcome: data.outcome,
        relationship_signal: data.relationshipSignal,
        next_action: data.nextAction,
        next_action_due_at: data.nextActionDueAt,
        source_type: "manual",
      })
      .select("id")
      .single();
    if (error) throw error;

    const updates: Record<string, unknown> = {
      last_touch_at: data.occurredAt,
      updated_at: new Date().toISOString(),
    };
    if (data.nextAction) updates["next_action"] = data.nextAction;
    if (data.nextActionDueAt) updates["next_action_due_at"] = data.nextActionDueAt;
    const { error: updateError } = await db
      .from("hpo_accounts")
      .update(updates)
      .eq("id", data.accountId)
      .eq("user_id", context.userId);
    if (updateError) throw updateError;

    return { id: interaction.id, accountName: ownedAccount.name };
  });

export const stageHpoImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceType: string; sourceName?: string; notes?: string }) => {
    const sourceType = input?.sourceType?.trim();
    if (!sourceType) throw new Error("Import source is required");
    return {
      sourceType,
      sourceName: input.sourceName?.trim() || null,
      notes: input.notes?.trim() || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("hpo_data_imports")
      .insert({
        user_id: context.userId,
        source_type: data.sourceType,
        source_name: data.sourceName,
        notes: data.notes,
        status: "staged",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id };
  });
