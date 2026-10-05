/* eslint-disable @typescript-eslint/no-explicit-any */
// JARVIS protected tool gateway (server-side only).
//
// 1. Look up the tool in the registry (unknown tools are refused).
// 2. Enforce risk/credit policy in code (policy.ts).
// 3. Execute against GitHub / Supabase (RLS-scoped, allowlisted writes) /
//    deployment observation / research / evaluations.
// 4. Record a jarvis_tool runtime event as the execution receipt.
// Credentials stay in process.env and are never placed in results.

import { runCanonicalEmeryEvaluations } from "../emery/evaluation-runner.ts";
import { describeCapability, searchCapabilities } from "./capability-catalog.ts";
import { GithubClient, GithubError, githubEnv } from "./github.ts";
import {
  extractKnowledgeCandidates,
  findSuperseded,
  formatKnowledgeForPrompt,
  isDuplicateKnowledge,
  KNOWLEDGE_CATEGORIES,
  rankKnowledge,
  sensitiveReason,
  type KnowledgeCategory,
} from "./knowledge.ts";
import { evaluateToolPolicy, PolicyError, redactSecrets, type TurnApprovals } from "./policy.ts";
import { githubResearch, licenseCheck, webResearch } from "./research.ts";
import * as state from "./state.ts";
import { getJarvisTool } from "./tool-registry.ts";

export type GatewayContext = {
  db: any;
  userId: string;
  agentId: string | null;
  approvals: TurnApprovals;
  openAiKey: string | null;
  researchModel: string;
  sourceRef?: string | null;
  fetcher?: typeof fetch;
  env?: Record<string, string | undefined>;
  github?: GithubClient;
};

export type ToolOutcome =
  | { ok: true; tool: string; result: unknown; durationMs: number }
  | { ok: false; tool: string; error: string; kind: "policy" | "not_configured" | "unknown_tool" | "failed"; durationMs: number };

function processEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/** Presence-only view of configuration: values are never copied. */
export function configurationPresence(env: Record<string, string | undefined> = processEnv()) {
  const has = (key: string) => (env[key] ? "configured" : undefined);
  return {
    JARVIS_GITHUB_TOKEN: has("JARVIS_GITHUB_TOKEN") ?? has("GITHUB_TOKEN"),
    JARVIS_SUPABASE_ACCESS_TOKEN: has("JARVIS_SUPABASE_ACCESS_TOKEN"),
    OPENAI_API_KEY: has("OPENAI_API_KEY"),
  } as Record<string, string | undefined>;
}

export function createGithubClient(ctx: Pick<GatewayContext, "env" | "fetcher" | "github">) {
  return ctx.github ?? new GithubClient(githubEnv(ctx.env ?? processEnv()), ctx.fetcher ?? fetch);
}

export async function executeJarvisTool(name: string, rawArgs: unknown, ctx: GatewayContext): Promise<ToolOutcome> {
  const started = Date.now();
  const definition = getJarvisTool(name);
  if (!definition) return { ok: false, tool: name, error: `Unknown tool ${name}. Use capability.search.`, kind: "unknown_tool", durationMs: 0 };
  const decision = evaluateToolPolicy(definition, ctx.approvals);
  if (!decision.allowed) {
    await recordToolEvent(ctx, name, "skipped", 0, { policy: decision.reason });
    return { ok: false, tool: name, error: decision.message, kind: "policy", durationMs: 0 };
  }
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, any>) : {};
  try {
    const result = await run(name, args, ctx);
    const durationMs = Date.now() - started;
    await recordToolEvent(ctx, name, "ok", durationMs, {});
    return { ok: true, tool: name, result, durationMs };
  } catch (error: any) {
    const durationMs = Date.now() - started;
    const notConfigured = error instanceof GithubError && (error.status === 412 || (error.status === 404 && !createGithubClient(ctx).configuredForWrites && definition.family === "github"));
    const kind = error instanceof PolicyError ? "policy" : notConfigured ? "not_configured" : "failed";
    let message = redactSecrets(String(error?.message ?? error)).slice(0, 600);
    if (kind === "not_configured" && !message.includes("JARVIS_GITHUB_TOKEN"))
      message += " — the repository is private, so GitHub tools need the JARVIS_GITHUB_TOKEN server secret.";
    await recordToolEvent(ctx, name, kind === "policy" ? "skipped" : "error", durationMs, { kind, error: message.slice(0, 240) });
    return { ok: false, tool: name, error: message, kind, durationMs };
  }
}

async function recordToolEvent(ctx: GatewayContext, action: string, status: "ok" | "error" | "skipped", durationMs: number, metadata: Record<string, unknown>) {
  try {
    await ctx.db.from("emery_runtime_events").insert({
      user_id: ctx.userId,
      channel: "system",
      event_type: "jarvis_tool",
      domain: "engineering",
      action,
      status,
      duration_ms: durationMs,
      model: null,
      metadata: { ...metadata, source_ref: ctx.sourceRef ?? null },
    });
  } catch {
    /* telemetry must never break a tool call */
  }
}

async function run(name: string, args: Record<string, any>, ctx: GatewayContext): Promise<unknown> {
  const { db, userId } = ctx;
  const env = ctx.env ?? processEnv();
  const presence = configurationPresence(env);
  const fetcher = ctx.fetcher ?? fetch;
  const gh = () => createGithubClient(ctx);

  switch (name) {
    // ------------------------------------------------------------ GitHub
    case "github.inspect_repo":
      return gh().inspectRepo();
    case "github.search_code":
      return gh().searchCode(String(args["query"] ?? ""), { pathPrefix: args["path_prefix"], ref: args["ref"] });
    case "github.read_file":
      return gh().readFile(String(args["path"] ?? ""), args["ref"] || "main", num(args["start_line"]), num(args["end_line"]));
    case "github.inspect_history":
      return gh().inspectHistory(args["ref"] || "main", args["path"], num(args["limit"]) ?? 10);
    case "github.compare":
      return gh().compare(String(args["base"]), String(args["head"]));
    case "github.create_branch":
      return gh().createBranch(String(args["name"] ?? ""), args["from_ref"] || "main");
    case "github.edit_candidate":
      return gh().editCandidate(String(args["branch"]), String(args["path"]), String(args["find"] ?? ""), String(args["replace"] ?? ""), String(args["message"] ?? ""));
    case "github.create_file":
      return gh().createFile(String(args["branch"]), String(args["path"]), String(args["content"] ?? ""), String(args["message"] ?? ""));
    case "github.commit_candidate":
      return gh().commitFiles(String(args["branch"]), String(args["message"] ?? ""), Array.isArray(args["files"]) ? args["files"] : []);
    case "github.inspect_ci":
      return gh().inspectCi(args["ref"] || "main");
    case "github.create_pr":
      return gh().createPr(String(args["head"]), String(args["title"] ?? ""), String(args["body"] ?? ""), args["base"] || "main", args["draft"] !== false);
    case "github.update_pr":
      return gh().updatePr(Number(args["number"]), { title: args["title"], body: args["body"] });

    // ---------------------------------------------------------- Supabase
    case "supabase.schema":
      return state.databaseDiagnostics(db);
    case "supabase.runtime_telemetry":
      return state.runtimeTelemetry(db, userId, num(args["days"]) ?? 7);
    case "supabase.execution_receipts":
      return state.executionReceipts(db, userId, num(args["days"]) ?? 7);
    case "supabase.evaluations":
      return state.evaluations(db, userId);
    case "supabase.improvement_backlog":
      return state.improvementBacklog(db, userId);
    case "supabase.capability_gaps":
      return state.capabilityGaps(db, userId);
    case "supabase.advisors":
    case "supabase.logs":
      return supabaseManagement(name, args, env, fetcher);

    // ------------------------------------------------------------ JARVIS
    case "jarvis.get_status":
      return state.getJarvisStatus(db, userId);
    case "jarvis.search_knowledge": {
      const items = await state.loadKnowledge(db, userId);
      const ranked = rankKnowledge(items, String(args["query"] ?? ""), Math.min(num(args["limit"]) ?? 8, 15));
      return { matched: ranked.length, total_items: items.length, knowledge: formatKnowledgeForPrompt(ranked) };
    }
    case "jarvis.create_task":
      return createTask(ctx, args);
    case "jarvis.update_task":
      return updateTask(ctx, args);
    case "jarvis.record_knowledge":
      return recordKnowledge(ctx, {
        category: args["category"],
        title: args["title"],
        content: args["content"],
        importance: num(args["importance"]) ?? 4,
        supersedesTitle: args["supersedes_title"] ?? null,
        sourceType: "jarvis_room",
      });

    // ----------------------------------------------------------- Lovable
    case "lovable.get_project_state": {
      const [served, releases] = await Promise.all([state.observeServedBuild("https://emery-personal-ai.lovable.app", fetcher), state.releaseLedger(db, userId, 1)]);
      return {
        published: served,
        last_recorded_observation: releases[0]
          ? { commit: releases[0].production_commit_sha, deployed_at: releases[0].deployed_at, verified: releases[0].deployment_verified, source: releases[0].metadata?.["observed_via"] ?? "release ledger" }
          : null,
        note: "GitHub is the source of truth. Published ≠ working: pair with runtime health before calling a release good.",
      };
    }
    case "lovable.get_preview_state":
      return state.lovablePreviewState(fetcher);
    case "lovable.get_production_commit": {
      const truth = await state.deploymentTruth(db, userId, null, fetcher);
      return {
        production_commit: truth.reconciliation.production_commit,
        source: truth.reconciliation.production_commit_source,
        served_build_id: truth.served.build_id,
        latest_release: truth.latest_release ? { name: truth.latest_release.release_name, commit: truth.latest_release.production_commit_sha, verified: truth.latest_release.deployment_verified } : null,
        caveats: truth.reconciliation.discrepancies.filter((d) => !d.includes("GitHub")),
      };
    }
    case "lovable.verify_build": {
      const ref = args["ref"] || "main";
      const [ci, preview] = await Promise.all([gh().inspectCi(ref).catch((e: any) => ({ error: redactSecrets(String(e.message)) })), state.lovablePreviewState(fetcher)]);
      return { ref, ci, preview };
    }
    case "lovable.verify_deployment":
    case "system.get_deployment": {
      const truth = await state.deploymentTruth(db, userId, presence["JARVIS_GITHUB_TOKEN"] ? gh() : null, fetcher);
      const health = await state.runtimeTelemetry(db, userId, 1);
      return { ...truth, runtime_last_24h: { events: health.total_events, problems: health.recent_problems.length } };
    }

    // ---------------------------------------------------------- Research
    case "research.web_search":
      if (!ctx.openAiKey) throw new Error("Web research is unavailable: OPENAI_API_KEY is not configured.");
      return webResearch(ctx.openAiKey, ctx.researchModel, String(args["question"] ?? ""), fetcher);
    case "research.github_search":
      return githubResearch(gh(), String(args["query"] ?? ""), args["language"]);
    case "research.license_check":
      return licenseCheck(gh(), String(args["repo"] ?? ""));
    case "research.record_finding":
      return recordFinding(ctx, args);

    // ------------------------------------------------------- Evaluations
    case "emery.run_evaluations": {
      const run = runCanonicalEmeryEvaluations();
      const failed = run.signals.filter((signal) => !signal.passed);
      return { corpus_version: run.corpusVersion, cases: run.cases, summary: run.summary, failing_signals: failed.slice(0, 15) };
    }

    // -------------------------------------------------------- Capability
    case "capability.search":
      return { results: searchCapabilities(String(args["query"] ?? ""), { limit: num(args["limit"]) ?? 8 }) };
    case "capability.describe": {
      const described = describeCapability(String(args["name"] ?? ""), presence);
      if (!described) throw new Error(`No capability named ${args["name"]}. Use capability.search.`);
      const { keywords: _k, evidenceActions: _e, ...rest } = described;
      return rest;
    }
    case "capability.health":
    case "system.get_capability_health":
      return state.capabilityHealth(db, userId, presence, args["name"]);

    // ------------------------------------------------------------ System
    case "system.get_version":
      return state.systemVersion(db, userId);
    case "system.get_recent_changes":
      return state.recentChanges(db, userId, presence["JARVIS_GITHUB_TOKEN"] ? gh() : null);
    case "system.get_capabilities":
      return { ...state.capabilitySummary(), configuration: state.jarvisToolConfiguration(presence) };
    case "system.get_known_issues":
      return state.knownIssues(db, userId);
    case "system.get_improvement_status":
      return state.improvementStatus(db, userId);
  }
  throw new Error(`Tool ${name} is registered but has no executor.`);
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && value !== null && value !== "" ? n : undefined;
}

async function supabaseManagement(name: string, args: Record<string, any>, env: Record<string, string | undefined>, fetcher: typeof fetch) {
  const token = env["JARVIS_SUPABASE_ACCESS_TOKEN"];
  const ref = env["SUPABASE_PROJECT_ID"] || env["VITE_SUPABASE_PROJECT_ID"];
  if (!token || !ref) {
    return {
      configured: false,
      message: "Management API access is not configured (JARVIS_SUPABASE_ACCESS_TOKEN). Use supabase.schema for the in-database security/performance lint and supabase.runtime_telemetry for app logs.",
    };
  }
  const path =
    name === "supabase.advisors"
      ? `/v1/projects/${ref}/advisors/${args["type"] === "performance" ? "performance" : "security"}`
      : `/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(logQuery(String(args["service"] ?? "postgres")))}`;
  const response = await fetcher(`https://api.supabase.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Supabase management API ${response.status}`);
  return redactDeep(await response.json());
}

function logQuery(service: string) {
  const table = { postgres: "postgres_logs", api: "edge_logs", auth: "auth_logs", "edge-function": "function_logs" }[service] ?? "postgres_logs";
  return `select timestamp, event_message from ${table} order by timestamp desc limit 50`;
}

function redactDeep(value: unknown): unknown {
  return JSON.parse(redactSecrets(JSON.stringify(value ?? null)));
}

// ------------------------------------------------- Allowlisted ledger writes

async function ensureTodaySession(ctx: GatewayContext) {
  const today = state.easternDate();
  const { data: existing } = await ctx.db
    .from("jarvis_engineering_sessions")
    .select("id,status,intake_limit")
    .eq("user_id", ctx.userId)
    .eq("session_date", today)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await ctx.db
    .from("jarvis_engineering_sessions")
    .insert({ user_id: ctx.userId, agent_id: ctx.agentId, session_date: today, status: "running", intake_limit: state.DAILY_TASK_CAPACITY, started_at: new Date().toISOString(), metadata: { opened_by: "jarvis_room" } })
    .select("id,status,intake_limit")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function createTask(ctx: GatewayContext, args: Record<string, any>) {
  const title = String(args["title"] ?? "").trim().slice(0, 200);
  if (title.length < 4) throw new PolicyError("A task needs a clear title.");
  if (sensitiveReason(`${title} ${args["objective"] ?? ""}`)) throw new PolicyError("Task text looks like it contains sensitive data; rephrase without it.");
  const session = await ensureTodaySession(ctx);
  const status = await state.getJarvisStatus(ctx.db, ctx.userId);
  if (status.accepted_today >= (session.intake_limit ?? state.DAILY_TASK_CAPACITY))
    throw new PolicyError(`Today's intake capacity (${session.intake_limit}) is full. Defer to tomorrow or merge with an existing task.`);
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const duplicate = status.open_tasks.find((t: any) => String(t.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalized);
  if (duplicate) return { created: false, duplicate_of: duplicate.id, status: duplicate.status, note: "Merged with an existing open task." };
  const risk = ["low", "medium", "high", "critical"].includes(args["risk_level"]) ? args["risk_level"] : "medium";
  const { data, error } = await ctx.db
    .from("jarvis_engineering_tasks")
    .insert({
      user_id: ctx.userId,
      session_id: session.id,
      source_type: String(args["source_type"] ?? "adam").slice(0, 40),
      source_ref: ctx.sourceRef ?? null,
      title,
      objective: args["objective"] ? String(args["objective"]).slice(0, 2000) : null,
      why_it_matters: args["why_it_matters"] ? String(args["why_it_matters"]).slice(0, 1000) : null,
      priority: Math.min(Math.max(Math.round(num(args["priority"]) ?? 3), 1), 5),
      risk_level: risk,
      status: "queued",
      scheduled_for: state.easternDate(),
    })
    .select("id,title,status,priority,risk_level,session_id")
    .single();
  if (error) throw new Error(error.message);
  await ctx.db.from("jarvis_engineering_sessions").update({ accepted_count: status.accepted_today + 1 }).eq("id", session.id).eq("user_id", ctx.userId);
  return { created: true, task: data, accepted_today: status.accepted_today + 1, capacity: session.intake_limit };
}

const TASK_UPDATE_FIELDS = ["status", "result_summary", "blocker", "branch_name", "commit_sha", "pr_url"] as const;

async function updateTask(ctx: GatewayContext, args: Record<string, any>) {
  const id = String(args["id"] ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PolicyError("Task id must be a UUID from jarvis.get_status.");
  const patch: Record<string, unknown> = {};
  for (const field of TASK_UPDATE_FIELDS) if (args[field] != null) patch[field] = String(args[field]).slice(0, 2000);
  if (patch["status"] && !(state.TASK_STATUSES as readonly string[]).includes(String(patch["status"]))) throw new PolicyError("Invalid task status.");
  if (patch["status"] === "completed" && !patch["result_summary"]) throw new PolicyError("Completing a task requires an evidence-based result_summary.");
  if (patch["status"] === "completed") patch["completed_at"] = new Date().toISOString();
  if (["building", "researching", "testing"].includes(String(patch["status"]))) patch["started_at"] = new Date().toISOString();
  if (!Object.keys(patch).length) throw new PolicyError("Nothing to update.");
  const { data, error } = await ctx.db.from("jarvis_engineering_tasks").update(patch).eq("id", id).eq("user_id", ctx.userId).select("id,title,status,blocker,branch_name,commit_sha,pr_url").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new PolicyError("Task not found.");
  return { updated: true, task: data };
}

async function recordFinding(ctx: GatewayContext, args: Record<string, any>) {
  const classification = ["ignore", "watch", "test", "adopt", "engineering_task"].includes(args["classification"]) ? args["classification"] : null;
  if (!classification) throw new PolicyError("classification must be ignore/watch/test/adopt/engineering_task.");
  const session = await ensureTodaySession(ctx).catch(() => null);
  const { data, error } = await ctx.db
    .from("jarvis_research_findings")
    .insert({
      user_id: ctx.userId,
      session_id: session?.id ?? null,
      topic: String(args["topic"] ?? "").slice(0, 200),
      finding: redactSecrets(String(args["finding"] ?? "")).slice(0, 4000),
      source_url: args["source_url"] ? String(args["source_url"]).slice(0, 500) : null,
      source_type: args["source_url"] && /github\.com/.test(String(args["source_url"])) ? "github" : "web",
      license_note: args["license_note"] ? String(args["license_note"]).slice(0, 500) : null,
      recommendation: args["recommendation"] ? String(args["recommendation"]).slice(0, 1000) : null,
      classification,
      metadata: { recorded_by: "jarvis_runtime", source_ref: ctx.sourceRef ?? null },
    })
    .select("id,topic,classification")
    .single();
  if (error) throw new Error(error.message);
  return { recorded: true, finding: data };
}

export async function recordKnowledge(
  ctx: Pick<GatewayContext, "db" | "userId" | "sourceRef">,
  input: { category: unknown; title: unknown; content: unknown; importance?: number; supersedesTitle?: string | null; sourceType: string; sourceTimestamp?: string | null },
) {
  const category = String(input.category) as KnowledgeCategory;
  if (!KNOWLEDGE_CATEGORIES.includes(category)) throw new PolicyError("Unknown knowledge category.");
  const title = String(input.title ?? "").trim().slice(0, 120);
  const content = String(input.content ?? "").trim().slice(0, 2000);
  if (title.length < 3 || content.length < 8) throw new PolicyError("Knowledge needs a title and content.");
  const sensitive = sensitiveReason(`${title} ${content}`);
  if (sensitive) throw new PolicyError(`Not stored: contains ${sensitive}. JARVIS knowledge never holds credentials, PHI or unrelated sensitive data.`);
  const existing = await state.loadKnowledge(ctx.db, ctx.userId);
  if (isDuplicateKnowledge(existing, { content })) return { stored: false, reason: "duplicate" };
  const superseded = findSuperseded(existing, { category, title, content }, input.supersedesTitle ?? null);
  const now = new Date().toISOString();
  const { data, error } = await ctx.db
    .from("jarvis_knowledge_items")
    .insert({
      user_id: ctx.userId,
      category,
      title,
      content,
      status: "current",
      importance: Math.min(Math.max(Math.round(input.importance ?? 4), 1), 5),
      source_type: input.sourceType,
      source_ref: ctx.sourceRef ?? null,
      source_timestamp: input.sourceTimestamp ?? now,
      supersedes_id: superseded?.id ?? null,
      metadata: { ingested_by: "jarvis_knowledge_ingestion", ingested_at: now },
    })
    .select("id,category,title")
    .single();
  if (error) throw new Error(error.message);
  if (superseded) {
    await ctx.db
      .from("jarvis_knowledge_items")
      .update({ status: "superseded", metadata: { ...(superseded.metadata ?? {}), superseded_by: data.id, superseded_at: now } })
      .eq("id", superseded.id)
      .eq("user_id", ctx.userId);
  }
  return { stored: true, item: data, superseded: superseded ? { id: superseded.id, title: superseded.title } : null };
}

/** Continuous ingestion hook: extract structured knowledge from one of Adam's messages. */
export async function ingestKnowledgeFromMessage(
  ctx: Pick<GatewayContext, "db" | "userId" | "sourceRef">,
  text: string,
  opts: { sourceType: "jarvis_room" | "emery_conversation"; requireEngineeringSubject: boolean },
) {
  const candidates = extractKnowledgeCandidates(text, { requireEngineeringSubject: opts.requireEngineeringSubject });
  const stored: unknown[] = [];
  for (const candidate of candidates.slice(0, 3)) {
    try {
      const result = await recordKnowledge(ctx, { ...candidate, sourceType: opts.sourceType });
      if ((result as any).stored) stored.push(result);
    } catch {
      /* sensitive/duplicate/invalid candidates are skipped silently */
    }
  }
  return { candidates: candidates.length, stored };
}
