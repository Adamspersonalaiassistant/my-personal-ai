/* eslint-disable @typescript-eslint/no-explicit-any */
// JARVIS protected tool gateway (server-side only).
//
// 1. Look up the tool in the registry (unknown tools are refused).
// 2. Enforce risk/credit policy in code (policy.ts).
// 3. Execute against GitHub / Supabase (RLS-scoped, allowlisted writes) /
//    deployment observation / research / evaluations.
// 4. Record a jarvis_tool runtime event as the execution receipt.
// Credentials stay in process.env and are never placed in results.

import { EMERY_PUBLISHED_URL } from "./build-info.ts";
import { runCanonicalEmeryEvaluations } from "../emery/evaluation-runner.ts";
import { describeCapability, searchCapabilities } from "./capability-catalog.ts";
import { createEdgeGithubFetcher, edgeGithubStatus } from "./edge-transport.ts";
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
  /** The signed-in owner's session JWT, forwarded to the jarvis-github edge function. */
  authToken?: string | null;
};

export type ToolOutcome =
  | { ok: true; tool: string; result: unknown; durationMs: number }
  | {
      ok: false;
      tool: string;
      error: string;
      kind: "policy" | "not_configured" | "unknown_tool" | "failed";
      durationMs: number;
    };

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

function edgeOptions(ctx: Pick<GatewayContext, "env" | "fetcher" | "authToken">) {
  const env = ctx.env ?? processEnv();
  const supabaseUrl = env["SUPABASE_URL"];
  const publishableKey = env["SUPABASE_PUBLISHABLE_KEY"];
  if (!ctx.authToken || !supabaseUrl || !publishableKey) return null;
  return {
    supabaseUrl,
    publishableKey,
    accessToken: ctx.authToken,
    ...(ctx.fetcher ? { fetcher: ctx.fetcher } : {}),
  };
}

/**
 * The one GitHub client. With an owner session it runs authenticated calls through
 * the protected jarvis-github edge function (token stays in Supabase secrets). A
 * directly configured server token is still honoured for local/dev use.
 */
export function createGithubClient(
  ctx: Pick<GatewayContext, "env" | "fetcher" | "github" | "authToken">,
) {
  if (ctx.github) return ctx.github;
  const env = ctx.env ?? processEnv();
  const base = githubEnv(env);
  if (base.token) return new GithubClient(base, ctx.fetcher ?? fetch);
  const edge = edgeOptions(ctx);
  if (edge) {
    return new GithubClient(
      { token: null, repo: base.repo, edge: true },
      createEdgeGithubFetcher(edge),
    );
  }
  return new GithubClient(base, ctx.fetcher ?? fetch);
}

const presenceCache = new WeakMap<object, Promise<Record<string, string | undefined>>>();

/**
 * Presence-only configuration, resolved once per gateway context. GitHub counts as
 * configured when a direct token exists or the edge function reports its secret.
 */
export function resolvePresence(ctx: GatewayContext): Promise<Record<string, string | undefined>> {
  let cached = presenceCache.get(ctx);
  if (!cached) {
    cached = (async () => {
      const presence = configurationPresence(ctx.env ?? processEnv());
      if (!presence["JARVIS_GITHUB_TOKEN"]) {
        const edge = edgeOptions(ctx);
        if (edge && (await edgeGithubStatus(edge)).configured)
          presence["JARVIS_GITHUB_TOKEN"] = "configured (edge function)";
      }
      return presence;
    })();
    presenceCache.set(ctx, cached);
  }
  return cached;
}

export async function executeJarvisTool(
  name: string,
  rawArgs: unknown,
  ctx: GatewayContext,
): Promise<ToolOutcome> {
  const started = Date.now();
  const definition = getJarvisTool(name);
  if (!definition)
    return {
      ok: false,
      tool: name,
      error: `Unknown tool ${name}. Use capability.search.`,
      kind: "unknown_tool",
      durationMs: 0,
    };
  const decision = evaluateToolPolicy(definition, ctx.approvals);
  if (!decision.allowed) {
    await recordToolEvent(ctx, name, "skipped", 0, { policy: decision.reason });
    return { ok: false, tool: name, error: decision.message, kind: "policy", durationMs: 0 };
  }
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, any>)
      : {};
  try {
    const result = await run(name, args, ctx);
    const durationMs = Date.now() - started;
    await recordToolEvent(ctx, name, "ok", durationMs, {});
    return { ok: true, tool: name, result, durationMs };
  } catch (error: any) {
    const durationMs = Date.now() - started;
    const notConfigured =
      error instanceof GithubError &&
      (error.status === 412 ||
        (error.status === 404 &&
          !createGithubClient(ctx).configuredForWrites &&
          definition.family === "github"));
    const kind =
      error instanceof PolicyError ? "policy" : notConfigured ? "not_configured" : "failed";
    let message = redactSecrets(String(error?.message ?? error)).slice(0, 600);
    if (kind === "not_configured" && !message.includes("JARVIS_GITHUB_TOKEN"))
      message +=
        " — the repository is private, so GitHub tools need JARVIS_GITHUB_TOKEN in Supabase Edge Function secrets and the jarvis-github function deployed.";
    await recordToolEvent(ctx, name, kind === "policy" ? "skipped" : "error", durationMs, {
      kind,
      error: message.slice(0, 240),
    });
    return { ok: false, tool: name, error: message, kind, durationMs };
  }
}

async function recordToolEvent(
  ctx: GatewayContext,
  action: string,
  status: "ok" | "error" | "skipped",
  durationMs: number,
  metadata: Record<string, unknown>,
) {
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
  const presence = await resolvePresence(ctx);
  const fetcher = ctx.fetcher ?? fetch;
  const gh = () => createGithubClient(ctx);

  switch (name) {
    // ------------------------------------------------------------ GitHub
    case "github.inspect_repo":
      return gh().inspectRepo();
    case "github.search_code":
      return gh().searchCode(String(args["query"] ?? ""), {
        pathPrefix: args["path_prefix"],
        ref: args["ref"],
      });
    case "github.read_file":
      return gh().readFile(
        String(args["path"] ?? ""),
        args["ref"] || "main",
        num(args["start_line"]),
        num(args["end_line"]),
      );
    case "github.inspect_history":
      return gh().inspectHistory(args["ref"] || "main", args["path"], num(args["limit"]) ?? 10);
    case "github.compare":
      return gh().compare(String(args["base"]), String(args["head"]));
    case "github.create_branch":
      return gh().createBranch(String(args["name"] ?? ""), args["from_ref"] || "main");
    case "github.edit_candidate":
      return gh().editCandidate(
        String(args["branch"]),
        String(args["path"]),
        String(args["find"] ?? ""),
        String(args["replace"] ?? ""),
        String(args["message"] ?? ""),
      );
    case "github.create_file":
      return gh().createFile(
        String(args["branch"]),
        String(args["path"]),
        String(args["content"] ?? ""),
        String(args["message"] ?? ""),
      );
    case "github.commit_candidate":
      return gh().commitFiles(
        String(args["branch"]),
        String(args["message"] ?? ""),
        Array.isArray(args["files"]) ? args["files"] : [],
      );
    case "github.inspect_ci":
      return gh().inspectCi(args["ref"] || "main");
    case "github.create_pr":
      return gh().createPr(
        String(args["head"]),
        String(args["title"] ?? ""),
        String(args["body"] ?? ""),
        args["base"] || "main",
        args["draft"] !== false,
      );
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
      const ranked = rankKnowledge(
        items,
        String(args["query"] ?? ""),
        Math.min(num(args["limit"]) ?? 8, 15),
      );
      return {
        matched: ranked.length,
        total_items: items.length,
        knowledge: formatKnowledgeForPrompt(ranked),
      };
    }
    case "jarvis.create_task":
      return createTask(ctx, args);
    case "jarvis.create_tasks":
      return createTasks(ctx, args);
    case "jarvis.approve_tasks":
      return approveTasks(ctx, args);
    case "jarvis.supersede_batch":
      return supersedeBatch(ctx, args);
    case "jarvis.approve_release":
      return approveRelease(ctx, args);
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
      const [served, releases] = await Promise.all([
        state.observeServedBuild("https://emery-personal-ai.lovable.app", fetcher),
        state.releaseLedger(db, userId, 1),
      ]);
      return {
        published: served,
        last_recorded_observation: releases[0]
          ? {
              commit: releases[0].production_commit_sha,
              deployed_at: releases[0].deployed_at,
              verified: releases[0].deployment_verified,
              source: releases[0].metadata?.["observed_via"] ?? "release ledger",
            }
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
        latest_release: truth.latest_release
          ? {
              name: truth.latest_release.release_name,
              commit: truth.latest_release.production_commit_sha,
              verified: truth.latest_release.deployment_verified,
            }
          : null,
        caveats: truth.reconciliation.discrepancies.filter((d) => !d.includes("GitHub")),
      };
    }
    case "lovable.verify_build": {
      const ref = args["ref"] || "main";
      const [ci, preview] = await Promise.all([
        gh()
          .inspectCi(ref)
          .catch((e: any) => ({ error: redactSecrets(String(e.message)) })),
        state.lovablePreviewState(fetcher),
      ]);
      return { ref, ci, preview };
    }
    case "lovable.verify_deployment":
    case "system.get_deployment": {
      const truth = await state.deploymentTruth(
        db,
        userId,
        presence["JARVIS_GITHUB_TOKEN"] ? gh() : null,
        fetcher,
      );
      const health = await state.runtimeTelemetry(db, userId, 1);
      return {
        ...truth,
        runtime_last_24h: { events: health.total_events, problems: health.recent_problems.length },
      };
    }

    // ---------------------------------------------------------- Research
    case "research.web_search":
      if (!ctx.openAiKey)
        throw new Error("Web research is unavailable: OPENAI_API_KEY is not configured.");
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
      return {
        corpus_version: run.corpusVersion,
        cases: run.cases,
        summary: run.summary,
        failing_signals: failed.slice(0, 15),
      };
    }

    // -------------------------------------------------------- Capability
    case "capability.search":
      return {
        results: searchCapabilities(String(args["query"] ?? ""), {
          limit: num(args["limit"]) ?? 8,
        }),
      };
    case "capability.describe": {
      const described = describeCapability(String(args["name"] ?? ""), presence);
      if (!described)
        throw new Error(`No capability named ${args["name"]}. Use capability.search.`);
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
      return {
        ...state.capabilitySummary(),
        configuration: state.jarvisToolConfiguration(presence),
      };
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

async function supabaseManagement(
  name: string,
  args: Record<string, any>,
  env: Record<string, string | undefined>,
  fetcher: typeof fetch,
) {
  const token = env["JARVIS_SUPABASE_ACCESS_TOKEN"];
  const ref = env["SUPABASE_PROJECT_ID"] || env["VITE_SUPABASE_PROJECT_ID"];
  if (!token || !ref) {
    return {
      configured: false,
      message:
        "Management API access is not configured (JARVIS_SUPABASE_ACCESS_TOKEN). Use supabase.schema for the in-database security/performance lint and supabase.runtime_telemetry for app logs.",
    };
  }
  const path =
    name === "supabase.advisors"
      ? `/v1/projects/${ref}/advisors/${args["type"] === "performance" ? "performance" : "security"}`
      : `/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(logQuery(String(args["service"] ?? "postgres")))}`;
  const response = await fetcher(`https://api.supabase.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Supabase management API ${response.status}`);
  return redactDeep(await response.json());
}

function logQuery(service: string) {
  const table =
    {
      postgres: "postgres_logs",
      api: "edge_logs",
      auth: "auth_logs",
      "edge-function": "function_logs",
    }[service] ?? "postgres_logs";
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
    .insert({
      user_id: ctx.userId,
      agent_id: ctx.agentId,
      session_date: today,
      status: "running",
      intake_limit: state.DAILY_TASK_CAPACITY,
      started_at: new Date().toISOString(),
      metadata: { opened_by: "jarvis_room" },
    })
    .select("id,status,intake_limit")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const TASK_KINDS = ["code_change", "diagnostic"];
const TASK_SOURCES = [
  "adam",
  "chatgpt_batch",
  "claude_batch",
  "runtime",
  "evaluation",
  "capability_gap",
  "user_correction",
  "regression",
  "research",
  "jarvis_self_research",
];

function normalizedTitle(title: unknown) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Build a worker-executable task row. The jarvis-worker accepts it into the day's
 * session atomically (capacity, dedupe, dependencies, risk), so no session is
 * pre-assigned here.
 */
function buildTaskRow(
  ctx: GatewayContext,
  args: Record<string, any>,
  sourceType: string,
  batchId: string,
) {
  const title = String(args["title"] ?? "")
    .trim()
    .slice(0, 200);
  if (title.length < 4) throw new PolicyError("A task needs a clear title.");
  if (sensitiveReason(`${title} ${args["objective"] ?? ""} ${JSON.stringify(args["edits"] ?? "")}`))
    throw new PolicyError("Task text looks like it contains sensitive data; rephrase without it.");
  const objective = args["objective"] ? String(args["objective"]).slice(0, 2000) : null;
  const targetPaths = Array.isArray(args["target_paths"])
    ? args["target_paths"].map(String).slice(0, 6)
    : [];
  const edits = Array.isArray(args["edits"]) ? args["edits"].slice(0, 12) : undefined;
  const checks = Array.isArray(args["checks"]) ? args["checks"].slice(0, 10) : undefined;
  const kind = TASK_KINDS.includes(args["kind"])
    ? args["kind"]
    : targetPaths.length || edits?.length
      ? "code_change"
      : checks?.length
        ? "diagnostic"
        : null;
  const task_spec: Record<string, unknown> = { objective: objective ?? title };
  if (kind) task_spec["kind"] = kind;
  if (targetPaths.length) task_spec["target_paths"] = targetPaths;
  if (edits) task_spec["edits"] = edits;
  if (checks) task_spec["checks"] = checks;
  return {
    row: {
      user_id: ctx.userId,
      source_type: sourceType,
      source_ref: ctx.sourceRef ?? null,
      title,
      objective,
      why_it_matters: args["why_it_matters"] ? String(args["why_it_matters"]).slice(0, 1000) : null,
      priority: Math.min(Math.max(Math.round(num(args["priority"]) ?? 3), 1), 5),
      risk_level: ["low", "medium", "high", "critical"].includes(args["risk_level"])
        ? args["risk_level"]
        : "medium",
      status: "queued",
      scheduled_for: state.easternDate(),
      task_spec,
      // Proposed unless Adam approved execution in this very message (code-enforced).
      approval_state: ctx.approvals.tasksApproved ? "approved" : "proposed",
      approved_at: ctx.approvals.tasksApproved ? new Date().toISOString() : null,
      batch_id: batchId,
    },
    executable: Boolean(kind),
  };
}

function sourceOf(args: Record<string, any>, fallback = "adam") {
  const source = String(args["source_type"] ?? fallback);
  return TASK_SOURCES.includes(source) ? source : fallback;
}

async function createTask(ctx: GatewayContext, args: Record<string, any>) {
  const result = await createTasks(ctx, { tasks: [args], source_type: args["source_type"] });
  const only = result.results[0];
  return { ...only, accepted_today: result.accepted_today, capacity: result.capacity };
}

async function createTasks(ctx: GatewayContext, args: Record<string, any>) {
  const items: Array<Record<string, any>> = Array.isArray(args["tasks"]) ? args["tasks"] : [];
  if (!items.length) throw new PolicyError("Provide at least one task.");
  if (items.length > state.DAILY_TASK_CAPACITY)
    throw new PolicyError(`A batch can hold at most ${state.DAILY_TASK_CAPACITY} tasks.`);
  const batchSource = sourceOf(args);
  const batchId = randomUuid();
  const built = items.map((item) => buildTaskRow(ctx, item, sourceOf(item, batchSource), batchId));
  const status = await state.getJarvisStatus(ctx.db, ctx.userId);
  // Duplicates merge against open production tasks AND tasks already proposed.
  const open = new Map(
    [...status.open_tasks, ...status.proposed_tasks].map((t: any) => [normalizedTitle(t.title), t]),
  );
  const ids: Array<string | null> = [];
  const results: Array<Record<string, unknown>> = [];
  for (const [index, { row, executable }] of built.entries()) {
    const existing = open.get(normalizedTitle(row.title)) as any;
    if (existing) {
      ids.push(existing.id);
      results.push({
        index,
        created: false,
        duplicate_of: existing.id,
        status: existing.status,
        note: "Merged with an existing open task.",
      });
      continue;
    }
    const dependsOn = (
      Array.isArray(items[index]!["depends_on_index"]) ? items[index]!["depends_on_index"] : []
    )
      .map((i: unknown) => (Number.isInteger(i) && (i as number) < index ? ids[i as number] : null))
      .filter((id: string | null | undefined): id is string => Boolean(id));
    const { data, error } = await ctx.db
      .from("jarvis_engineering_tasks")
      .insert({ ...row, depends_on: dependsOn })
      .select("id,title,status,priority,risk_level")
      .single();
    if (error) throw new Error(error.message);
    ids.push(data.id);
    open.set(normalizedTitle(row.title), data);
    results.push({
      index,
      created: true,
      task: data,
      depends_on: dependsOn,
      ...(executable
        ? {}
        : {
            needs_spec:
              "No executable spec: the worker will block this task. Add target_paths (find them with github.search_code), explicit edits, or diagnostic checks.",
          }),
    });
  }
  const created = results.filter((r) => r["created"]).length;
  const capacity = state.DAILY_TASK_CAPACITY;
  const room = Math.max(0, capacity - status.accepted_today);
  const approved = Boolean(ctx.approvals.tasksApproved);
  return {
    created,
    merged: results.length - created,
    results,
    batch_id: batchId,
    approval_state: approved ? "approved" : "proposed",
    accepted_today: status.accepted_today,
    capacity,
    note: !approved
      ? `Saved as a PROPOSED batch (${created} task(s)). Nothing runs and no production capacity is used until Adam approves — say "execute these" and call jarvis.approve_tasks with this batch_id.`
      : created > room
        ? `${created - room} task(s) exceed today's remaining intake (${room}); the worker holds them for the next day.`
        : "Approved and queued for the JARVIS worker (runs every 2 minutes): accept → validate → dedupe → dependencies → risk → execute → test → repair → PR.",
  };
}

function randomUuid() {
  return globalThis.crypto.randomUUID();
}

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

/** Adam approved: proposed tasks become approved and enter the worker's intake. */
async function approveTasks(ctx: GatewayContext, args: Record<string, any>) {
  if (!ctx.approvals.tasksApproved)
    throw new PolicyError(
      "Adam has not approved execution in this message. Proposed tasks stay proposed until he says to execute or schedule them.",
    );
  const batchId = args["batch_id"] ? String(args["batch_id"]) : null;
  const ids: string[] = Array.isArray(args["task_ids"]) ? args["task_ids"].map(String) : [];
  if (batchId && !UUID_PATTERN.test(batchId)) throw new PolicyError("batch_id must be a UUID.");
  if (ids.some((id) => !UUID_PATTERN.test(id))) throw new PolicyError("task_ids must be UUIDs.");
  if (!batchId && !ids.length && args["all_proposed"] !== true)
    throw new PolicyError("Give a batch_id, task_ids, or all_proposed: true.");
  const status = await state.getJarvisStatus(ctx.db, ctx.userId);
  const targets = (status.proposed_tasks as any[]).filter(
    (t) =>
      (batchId && t.batch_id === batchId) || ids.includes(t.id) || args["all_proposed"] === true,
  );
  const now = new Date().toISOString();
  for (const task of targets) {
    const { error } = await ctx.db
      .from("jarvis_engineering_tasks")
      .update({ approval_state: "approved", approved_at: now })
      .eq("id", task.id)
      .eq("user_id", ctx.userId)
      .eq("approval_state", "proposed");
    if (error) throw new Error(error.message);
  }
  return {
    approved: targets.length,
    task_ids: targets.map((t) => t.id),
    note: targets.length
      ? `${targets.length} task(s) approved. The worker accepts them into today's production intake (${state.DAILY_TASK_CAPACITY}/day) as capacity allows.`
      : "No matching proposed tasks.",
  };
}

const RELEASE_APPROVAL_TTL_MS = 60 * 60_000;

/**
 * Adam approved a release. Bind the approval to ONE candidate: its PR number,
 * exact head sha (which must still be the commit JARVIS tested), the task and the
 * production commit right now. The worker's release operator performs the release
 * and rechecks every one of these; if the PR moves, the approval is void.
 */
async function approveRelease(ctx: GatewayContext, args: Record<string, any>) {
  if (!ctx.approvals.releaseApproved)
    throw new PolicyError(
      "Adam has not approved a release in this message. Ask: 'Ready for release. Approve it?' and wait for his reply.",
    );
  const { data, error } = await ctx.db
    .from("jarvis_engineering_tasks")
    .select("id,title,status,pr_url,commit_sha,is_fixture,metadata")
    .eq("user_id", ctx.userId)
    .eq("status", "ready_for_release")
    .eq("is_fixture", false);
  if (error) throw new Error(error.message);
  const prOf = (url: unknown) => Number(/\/pull\/(\d+)/.exec(String(url ?? ""))?.[1] ?? 0);
  const wanted = Number(args["pr_number"] ?? ctx.approvals.releasePr ?? 0) || null;
  const pending = ((data ?? []) as any[]).filter(
    (t) =>
      prOf(t.pr_url) &&
      ![
        "merged",
        "awaiting_deploy",
        "awaiting_publish",
        "publishing",
        "verified",
        "stable",
        "released_no_deploy",
      ].includes(String(t.metadata?.release?.state ?? "")),
  );
  const matches = wanted ? pending.filter((t) => prOf(t.pr_url) === wanted) : pending;
  if (matches.length === 0)
    throw new PolicyError(
      wanted
        ? `PR #${wanted} is not a ready candidate.`
        : "There is no candidate waiting for release.",
    );
  if (matches.length > 1)
    throw new PolicyError(
      `Several candidates are ready (${matches.map((t) => `#${prOf(t.pr_url)} ${t.title}`).join("; ")}). Ask Adam which PR number to approve.`,
    );
  const task = matches[0]!;
  const pr = await createGithubClient(ctx).getPr(prOf(task.pr_url));
  if (pr.state !== "open" || pr.merged) throw new PolicyError(`PR #${pr.number} is not open.`);
  if (!pr.headRef.startsWith("jarvis/") || pr.baseRef !== "main")
    throw new PolicyError("Only jarvis/* candidates targeting main can be released.");
  if (pr.headSha !== task.commit_sha)
    throw new PolicyError(
      `PR #${pr.number} changed since JARVIS tested it (head ${pr.headSha.slice(0, 7)} vs tested ${String(task.commit_sha).slice(0, 7)}). It needs a fresh test run before approval.`,
    );
  const served = await state.observeServedBuild(EMERY_PUBLISHED_URL, ctx.fetcher ?? fetch);
  if (!served.commit)
    throw new PolicyError(
      "Production did not report its commit, so a release cannot be bound to it.",
    );
  const now = Date.now();
  const approval = {
    pr: pr.number,
    head_sha: pr.headSha,
    task_id: task.id,
    production_base: served.commit,
    approved_at: new Date(now).toISOString(),
    expires_at: new Date(now + RELEASE_APPROVAL_TTL_MS).toISOString(),
    source_ref: ctx.sourceRef ?? null,
  };
  const { data: ok, error: rpcError } = await ctx.db.rpc("jarvis_set_release_approval", {
    p_task: task.id,
    p_approval: approval,
  });
  if (rpcError) throw new Error(rpcError.message);
  if (ok !== true) throw new PolicyError("The candidate is no longer ready for release.");
  return {
    approved: true,
    pr: pr.number,
    head: pr.headSha.slice(0, 7),
    production: served.commit.slice(0, 7),
    expires_at: approval.expires_at,
    note: "Approval recorded for this exact commit. The release operator (runs every 2 minutes) re-checks CI, the release gate and that nothing changed, then merges, deploys and verifies production, and sends one notification. If the PR changes, I will ask you again.",
  };
}

/** Safe to cancel: nothing has run, no lease, no branch/PR — so nothing is lost. */
function safelySupersedable(task: any) {
  return (
    ["queued", "validating"].includes(task.status) &&
    !task.branch_name &&
    !task.pr_url &&
    !task.commit_sha &&
    !task.lease_token &&
    !(task.attempt_count > 1)
  );
}

/**
 * Adam replaced a plan: the old batch is superseded (cancelled, audit kept) so
 * both batches are never counted. Proposed tasks are always safe to supersede.
 * Approved tasks are superseded only while untouched; anything already in
 * progress is returned for Adam's decision instead of being cancelled.
 */
async function supersedeBatch(ctx: GatewayContext, args: Record<string, any>) {
  if (!ctx.approvals.batchReplacement)
    throw new PolicyError(
      "Adam did not say this replaces the previous plan. Ask before superseding existing tasks.",
    );
  const batchId = args["batch_id"] ? String(args["batch_id"]) : null;
  const supersededBy = args["superseded_by_batch_id"]
    ? String(args["superseded_by_batch_id"])
    : null;
  if (batchId && !UUID_PATTERN.test(batchId)) throw new PolicyError("batch_id must be a UUID.");
  if (supersededBy && !UUID_PATTERN.test(supersededBy))
    throw new PolicyError("superseded_by_batch_id must be a UUID.");
  const { data, error } = await ctx.db
    .from("jarvis_engineering_tasks")
    .select(
      "id,title,status,approval_state,batch_id,is_fixture,session_id,branch_name,pr_url,commit_sha,lease_token,attempt_count,metadata",
    )
    .eq("user_id", ctx.userId)
    .in("approval_state", ["proposed", "approved"])
    .in("status", [
      "queued",
      "validating",
      "researching",
      "planning",
      "building",
      "testing",
      "repairing",
    ]);
  if (error) throw new Error(error.message);
  const scope = ((data ?? []) as any[]).filter(
    (t) =>
      !t.is_fixture &&
      t.batch_id !== supersededBy &&
      (batchId
        ? t.batch_id === batchId
        : args["include_approved"] === true || t.approval_state === "proposed"),
  );
  const superseded: string[] = [];
  const needsDecision: Array<{ id: string; title: string; status: string }> = [];
  const now = new Date().toISOString();
  for (const task of scope) {
    if (task.approval_state === "approved" && !safelySupersedable(task)) {
      needsDecision.push({ id: task.id, title: task.title, status: task.status });
      continue;
    }
    const { error: updateError } = await ctx.db
      .from("jarvis_engineering_tasks")
      .update({
        status: "cancelled",
        approval_state: "superseded",
        blocker: "Superseded by Adam's replacement plan.",
        metadata: { ...(task.metadata ?? {}), superseded_by: supersededBy, superseded_at: now },
      })
      .eq("id", task.id)
      .eq("user_id", ctx.userId)
      .is("lease_token", null);
    if (updateError) throw new Error(updateError.message);
    superseded.push(task.id);
  }
  return {
    superseded: superseded.length,
    needs_decision: needsDecision,
    note: needsDecision.length
      ? `${needsDecision.length} approved task(s) are already in progress; I did not cancel them. Ask Adam whether to stop them.`
      : "Previous batch superseded; history is kept and none of it counts toward production capacity.",
  };
}

const TASK_UPDATE_FIELDS = [
  "status",
  "result_summary",
  "blocker",
  "branch_name",
  "commit_sha",
  "pr_url",
] as const;

async function updateTask(ctx: GatewayContext, args: Record<string, any>) {
  const id = String(args["id"] ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new PolicyError("Task id must be a UUID from jarvis.get_status.");
  const patch: Record<string, unknown> = {};
  for (const field of TASK_UPDATE_FIELDS)
    if (args[field] != null) patch[field] = String(args[field]).slice(0, 2000);
  if (
    patch["status"] &&
    !(state.TASK_STATUSES as readonly string[]).includes(String(patch["status"]))
  )
    throw new PolicyError("Invalid task status.");
  if (patch["status"] === "completed" && !patch["result_summary"])
    throw new PolicyError("Completing a task requires an evidence-based result_summary.");
  if (patch["status"] === "completed") patch["completed_at"] = new Date().toISOString();
  if (["building", "researching", "testing"].includes(String(patch["status"])))
    patch["started_at"] = new Date().toISOString();
  if (!Object.keys(patch).length) throw new PolicyError("Nothing to update.");
  const { data, error } = await ctx.db
    .from("jarvis_engineering_tasks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select("id,title,status,blocker,branch_name,commit_sha,pr_url")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new PolicyError("Task not found.");
  return { updated: true, task: data };
}

async function recordFinding(ctx: GatewayContext, args: Record<string, any>) {
  const classification = ["ignore", "watch", "test", "adopt", "engineering_task"].includes(
    args["classification"],
  )
    ? args["classification"]
    : null;
  if (!classification)
    throw new PolicyError("classification must be ignore/watch/test/adopt/engineering_task.");
  const session = await ensureTodaySession(ctx).catch(() => null);
  const { data, error } = await ctx.db
    .from("jarvis_research_findings")
    .insert({
      user_id: ctx.userId,
      session_id: session?.id ?? null,
      topic: String(args["topic"] ?? "").slice(0, 200),
      finding: redactSecrets(String(args["finding"] ?? "")).slice(0, 4000),
      source_url: args["source_url"] ? String(args["source_url"]).slice(0, 500) : null,
      source_type:
        args["source_url"] && /github\.com/.test(String(args["source_url"])) ? "github" : "web",
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
  input: {
    category: unknown;
    title: unknown;
    content: unknown;
    importance?: number;
    supersedesTitle?: string | null;
    sourceType: string;
    sourceTimestamp?: string | null;
  },
) {
  const category = String(input.category) as KnowledgeCategory;
  if (!KNOWLEDGE_CATEGORIES.includes(category))
    throw new PolicyError("Unknown knowledge category.");
  const title = String(input.title ?? "")
    .trim()
    .slice(0, 120);
  const content = String(input.content ?? "")
    .trim()
    .slice(0, 2000);
  if (title.length < 3 || content.length < 8)
    throw new PolicyError("Knowledge needs a title and content.");
  const sensitive = sensitiveReason(`${title} ${content}`);
  if (sensitive)
    throw new PolicyError(
      `Not stored: contains ${sensitive}. JARVIS knowledge never holds credentials, PHI or unrelated sensitive data.`,
    );
  const existing = await state.loadKnowledge(ctx.db, ctx.userId);
  if (isDuplicateKnowledge(existing, { content })) return { stored: false, reason: "duplicate" };
  const superseded = findSuperseded(
    existing,
    { category, title, content },
    input.supersedesTitle ?? null,
  );
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
      .update({
        status: "superseded",
        metadata: { ...(superseded.metadata ?? {}), superseded_by: data.id, superseded_at: now },
      })
      .eq("id", superseded.id)
      .eq("user_id", ctx.userId);
  }
  return {
    stored: true,
    item: data,
    superseded: superseded ? { id: superseded.id, title: superseded.title } : null,
  };
}

/** Continuous ingestion hook: extract structured knowledge from one of Adam's messages. */
export async function ingestKnowledgeFromMessage(
  ctx: Pick<GatewayContext, "db" | "userId" | "sourceRef">,
  text: string,
  opts: { sourceType: "jarvis_room" | "emery_conversation"; requireEngineeringSubject: boolean },
) {
  const candidates = extractKnowledgeCandidates(text, {
    requireEngineeringSubject: opts.requireEngineeringSubject,
  });
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
