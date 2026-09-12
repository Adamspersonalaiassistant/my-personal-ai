/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_CONFIG = {
  response_verbosity: "concise",
  agent_route_confidence: 0.88,
  memory_max_items: 16,
  memory_max_characters: 6500,
  proactive_focus_enabled: true,
  auto_apply_low_risk: true,
} as const;

type SafeConfigKey = keyof typeof DEFAULT_CONFIG;

const SAFE_CONFIG_KEYS = new Set<SafeConfigKey>(Object.keys(DEFAULT_CONFIG) as SafeConfigKey[]);

function validateConfigValue(key: SafeConfigKey, value: unknown) {
  if (key === "response_verbosity") {
    if (!["concise", "balanced", "detailed"].includes(String(value))) throw new Error("Unsupported verbosity setting");
    return String(value);
  }
  if (key === "agent_route_confidence") {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0.5 || number > 0.99) throw new Error("Invalid routing threshold");
    return number;
  }
  if (key === "memory_max_items") {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || number < 6 || number > 30) throw new Error("Invalid memory item budget");
    return number;
  }
  if (key === "memory_max_characters") {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || number < 2000 || number > 12000) throw new Error("Invalid memory character budget");
    return number;
  }
  if (key === "proactive_focus_enabled" || key === "auto_apply_low_risk") return Boolean(value);
  throw new Error("That setting is not allowlisted");
}

async function loadConfig(db: any, userId: string) {
  const { data, error } = await db.from("emery_config").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ?? { user_id: userId, ...DEFAULT_CONFIG, updated_at: null };
}

export const getImprovementDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    const [backlog, evaluations, changes, metrics, config] = await Promise.all([
      db
        .from("emery_improvement_backlog")
        .select("id, area, title, problem_statement, evidence, severity, expected_benefit, confidence, status, occurrence_count, last_observed_at, created_at, updated_at")
        .eq("user_id", userId)
        .order("severity", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(40),
      db
        .from("emery_self_evaluations")
        .select("id, target_type, target_ref, rubric_version, scores, findings, metadata, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("emery_improvement_changes")
        .select("id, backlog_id, change_type, scope, before_state, after_state, rationale, validation, status, created_at, applied_at, rolled_back_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("emery_agent_metrics")
        .select("agent_slug, delegated_count, web_used, succeeded, duration_ms, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      loadConfig(db, userId),
    ]);

    for (const result of [backlog, evaluations, changes, metrics]) if (result.error) throw result.error;

    const agentMap = new Map<string, { calls: number; successes: number; failures: number; web: number; delegates: number; durations: number[] }>();
    for (const row of metrics.data ?? []) {
      const current = agentMap.get(row.agent_slug) ?? { calls: 0, successes: 0, failures: 0, web: 0, delegates: 0, durations: [] };
      current.calls += 1;
      if (row.succeeded === true) current.successes += 1;
      if (row.succeeded === false) current.failures += 1;
      if (row.web_used) current.web += 1;
      current.delegates += Number(row.delegated_count ?? 0);
      if (Number.isFinite(row.duration_ms)) current.durations.push(Number(row.duration_ms));
      agentMap.set(row.agent_slug, current);
    }
    const agents = [...agentMap.entries()].map(([slug, value]) => ({
      slug,
      calls: value.calls,
      successRate: value.successes + value.failures ? value.successes / (value.successes + value.failures) : null,
      webCalls: value.web,
      delegatedCount: value.delegates,
      averageDurationMs: value.durations.length ? Math.round(value.durations.reduce((a, b) => a + b, 0) / value.durations.length) : null,
    }));

    return {
      backlog: backlog.data ?? [],
      evaluations: evaluations.data ?? [],
      changes: changes.data ?? [],
      config,
      agents,
      health: {
        openItems: (backlog.data ?? []).filter((item: any) => ["observed", "proposed", "testing"].includes(item.status)).length,
        highSeverity: (backlog.data ?? []).filter((item: any) => item.severity >= 4 && !["accepted", "rejected", "rolled_back"].includes(item.status)).length,
        acceptedChanges: (changes.data ?? []).filter((item: any) => item.status === "accepted").length,
        rolledBackChanges: (changes.data ?? []).filter((item: any) => item.status === "rolled_back").length,
      },
    };
  });

export const observeImprovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { area: string; title: string; problem: string; evidence?: unknown; severity?: number; confidence?: number; expectedBenefit?: string }) => {
    const area = String(input.area ?? "");
    if (!["response", "memory", "action", "agent", "ux", "system"].includes(area)) throw new Error("Unsupported improvement area");
    const title = String(input.title ?? "").trim().slice(0, 160);
    const problem = String(input.problem ?? "").trim().slice(0, 1200);
    if (!title || !problem) throw new Error("Improvement title and problem are required");
    return {
      area,
      title,
      problem,
      evidence: input.evidence ?? {},
      severity: Math.min(5, Math.max(1, Math.round(Number(input.severity ?? 2)))),
      confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 0.7))),
      expectedBenefit: String(input.expectedBenefit ?? "").trim().slice(0, 500) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const now = new Date().toISOString();
    const { data: existing, error } = await db
      .from("emery_improvement_backlog")
      .select("id, evidence, occurrence_count, severity, confidence")
      .eq("user_id", context.userId)
      .eq("area", data.area)
      .eq("title", data.title)
      .in("status", ["observed", "proposed", "testing"])
      .maybeSingle();
    if (error) throw error;
    if (existing) {
      const priorEvidence = Array.isArray(existing.evidence) ? existing.evidence : [];
      const nextEvidence = [...priorEvidence.slice(-9), { at: now, detail: data.evidence }];
      const { data: updated, error: updateError } = await db
        .from("emery_improvement_backlog")
        .update({
          problem_statement: data.problem,
          evidence: nextEvidence,
          occurrence_count: Number(existing.occurrence_count ?? 1) + 1,
          severity: Math.max(Number(existing.severity ?? 1), data.severity),
          confidence: Math.max(Number(existing.confidence ?? 0), data.confidence),
          expected_benefit: data.expectedBenefit,
          last_observed_at: now,
          updated_at: now,
        })
        .eq("id", existing.id)
        .eq("user_id", context.userId)
        .select("id")
        .single();
      if (updateError) throw updateError;
      return { id: updated.id, deduplicated: true };
    }
    const { data: created, error: createError } = await db
      .from("emery_improvement_backlog")
      .insert({
        user_id: context.userId,
        area: data.area,
        title: data.title,
        problem_statement: data.problem,
        evidence: [{ at: now, detail: data.evidence }],
        severity: data.severity,
        expected_benefit: data.expectedBenefit,
        confidence: data.confidence,
      })
      .select("id")
      .single();
    if (createError) throw createError;
    return { id: created.id, deduplicated: false };
  });

export const recordSelfEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetType: string; targetRef?: string | null; scores?: unknown; findings?: unknown; metadata?: unknown }) => {
    const targetType = String(input.targetType ?? "system");
    if (!["response", "memory", "action", "agent", "ux", "system"].includes(targetType)) throw new Error("Unsupported evaluation target");
    return { targetType, targetRef: input.targetRef ? String(input.targetRef).slice(0, 240) : null, scores: input.scores ?? {}, findings: input.findings ?? [], metadata: input.metadata ?? {} };
  })
  .handler(async ({ data, context }) => {
    const { data: created, error } = await (context.supabase as any)
      .from("emery_self_evaluations")
      .insert({ user_id: context.userId, target_type: data.targetType, target_ref: data.targetRef, scores: data.scores, findings: data.findings, metadata: data.metadata })
      .select("id")
      .single();
    if (error) throw error;
    return { id: created.id };
  });

export const applyValidatedConfigChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string; value: unknown; rationale: string; backlogId?: string | null; validation: { passed: boolean; criticalFailures?: number; summary?: string } }) => {
    const key = String(input.key ?? "") as SafeConfigKey;
    if (!SAFE_CONFIG_KEYS.has(key)) throw new Error("That setting is outside Emery's safe autonomy boundary");
    if (!input.validation?.passed || Number(input.validation?.criticalFailures ?? 0) > 0) throw new Error("A validated change with zero critical failures is required");
    const rationale = String(input.rationale ?? "").trim().slice(0, 1200);
    if (!rationale) throw new Error("Change rationale is required");
    return { key, value: validateConfigValue(key, input.value), rationale, backlogId: input.backlogId ? String(input.backlogId) : null, validation: input.validation };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const before = await loadConfig(db, context.userId);
    const after = { ...before, [data.key]: data.value, updated_at: new Date().toISOString() };
    const { error: configError } = await db.from("emery_config").upsert({ user_id: context.userId, [data.key]: data.value, updated_at: after.updated_at }, { onConflict: "user_id" });
    if (configError) throw configError;
    const { data: change, error: changeError } = await db
      .from("emery_improvement_changes")
      .insert({
        user_id: context.userId,
        backlog_id: data.backlogId,
        change_type: "safe_config",
        scope: data.key,
        before_state: { [data.key]: before[data.key] },
        after_state: { [data.key]: data.value },
        rollback_state: { [data.key]: before[data.key] },
        rationale: data.rationale,
        validation: data.validation,
        status: "accepted",
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (changeError) throw changeError;
    if (data.backlogId) {
      await db.from("emery_improvement_backlog").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", data.backlogId).eq("user_id", context.userId);
    }
    return { id: change.id, key: data.key, value: data.value };
  });

export const rollbackImprovementChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: String(input.id ?? "") }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: change, error } = await db
      .from("emery_improvement_changes")
      .select("id, change_type, scope, rollback_state, status, backlog_id")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!change) throw new Error("Improvement change not found");
    if (change.change_type !== "safe_config" || !SAFE_CONFIG_KEYS.has(change.scope as SafeConfigKey)) throw new Error("This change cannot be rolled back automatically");
    if (change.status !== "accepted") throw new Error("Only accepted changes can be rolled back");
    const key = change.scope as SafeConfigKey;
    const rollbackValue = validateConfigValue(key, change.rollback_state?.[key]);
    const now = new Date().toISOString();
    const { error: configError } = await db.from("emery_config").upsert({ user_id: context.userId, [key]: rollbackValue, updated_at: now }, { onConflict: "user_id" });
    if (configError) throw configError;
    const { error: changeError } = await db.from("emery_improvement_changes").update({ status: "rolled_back", rolled_back_at: now }).eq("id", change.id).eq("user_id", context.userId);
    if (changeError) throw changeError;
    if (change.backlog_id) await db.from("emery_improvement_backlog").update({ status: "rolled_back", updated_at: now }).eq("id", change.backlog_id).eq("user_id", context.userId);
    return { ok: true };
  });

export const recordAgentMetric = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentSlug: string; delegatedCount?: number; webUsed?: boolean; succeeded?: boolean | null; durationMs?: number | null; metadata?: unknown }) => ({
    agentSlug: String(input.agentSlug ?? "").trim().slice(0, 120),
    delegatedCount: Math.max(0, Math.min(20, Math.round(Number(input.delegatedCount ?? 0)))),
    webUsed: Boolean(input.webUsed),
    succeeded: typeof input.succeeded === "boolean" ? input.succeeded : null,
    durationMs: input.durationMs == null ? null : Math.max(0, Math.min(600000, Math.round(Number(input.durationMs)))),
    metadata: input.metadata ?? {},
  }))
  .handler(async ({ data, context }) => {
    if (!data.agentSlug) throw new Error("Agent slug is required");
    const { error } = await (context.supabase as any).from("emery_agent_metrics").insert({ user_id: context.userId, agent_slug: data.agentSlug, delegated_count: data.delegatedCount, web_used: data.webUsed, succeeded: data.succeeded, duration_ms: data.durationMs, metadata: data.metadata });
    if (error) throw error;
    return { ok: true };
  });
