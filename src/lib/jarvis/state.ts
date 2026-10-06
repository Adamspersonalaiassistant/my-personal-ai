/* eslint-disable @typescript-eslint/no-explicit-any */
// Authoritative state reads for JARVIS and Emery self-awareness.
// Every function reads real tables through the caller's RLS-scoped Supabase
// client (owner-only), or real HTTP/GitHub state. Nothing here invents status.

import { EMERY_BUILD, EMERY_PREVIEW_URL, EMERY_PUBLISHED_URL } from "./build-info.ts";
import { CAPABILITY_CATALOG, healthFromEvidence } from "./capability-catalog.ts";
import type { GithubClient } from "./github.ts";
import type { KnowledgeItem } from "./knowledge.ts";
import { JARVIS_TOOLS } from "./tool-registry.ts";

export const DAILY_TASK_CAPACITY = 50;

export const TASK_STATUSES = [
  "queued",
  "validating",
  "researching",
  "planning",
  "building",
  "testing",
  "repairing",
  "ready_for_release",
  "completed",
  "blocked",
  "deferred",
  "failed",
  "cancelled",
] as const;

const OPEN_TASK_STATUSES = new Set([
  "queued",
  "validating",
  "researching",
  "planning",
  "building",
  "testing",
  "repairing",
  "ready_for_release",
  "blocked",
]);

export function easternDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function rows<T = any>(query: PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message ?? String(error));
  return data ?? [];
}

// ------------------------------------------------------------ JARVIS ledger

export async function getJarvisStatus(db: any, userId: string) {
  const today = easternDate();
  const [sessions, tasks, findings] = await Promise.all([
    rows(
      db
        .from("jarvis_engineering_sessions")
        .select(
          "id,status,session_date,intake_limit,accepted_count,completed_count,ready_for_release_count,blocked_count,failed_count,approval_required,summary,self_research_summary,self_research_classification,started_at,completed_at,updated_at,metadata",
        )
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(10),
    ),
    rows(
      db
        .from("jarvis_engineering_tasks")
        .select(
          "id,session_id,title,status,priority,risk_level,source_type,blocker,branch_name,commit_sha,pr_url,result_summary,created_at,updated_at,completed_at",
        )
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(200),
    ),
    rows(
      db
        .from("jarvis_research_findings")
        .select("id,topic,finding,classification,source_url,recommendation,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
    ),
  ]);

  const activeSession = sessions.find((s: any) => ["queued", "running"].includes(s.status)) ?? null;
  const todaysSession = sessions.find((s: any) => s.session_date === today) ?? null;
  const todaysTasks = tasks.filter(
    (t: any) => easternDate(new Date(t.created_at)) === today && t.status !== "cancelled",
  );
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    (typeof TASK_STATUSES)[number],
    number
  >;
  for (const task of tasks)
    if (task.status in counts) counts[task.status as keyof typeof counts] += 1;
  const openTasks = tasks.filter((t: any) => OPEN_TASK_STATUSES.has(t.status));
  const approvals = [
    ...sessions
      .filter((s: any) => s.approval_required && s.status !== "cancelled")
      .map((s: any) => ({ kind: "session", id: s.id, detail: s.summary })),
    ...tasks
      .filter((t: any) => t.status === "blocked" && /approv/i.test(String(t.blocker ?? "")))
      .map((t: any) => ({ kind: "task", id: t.id, detail: `${t.title}: ${t.blocker}` })),
  ];
  return {
    today,
    capacity: todaysSession?.intake_limit ?? DAILY_TASK_CAPACITY,
    accepted_today: todaysTasks.length,
    active_session: activeSession,
    latest_session: sessions[0] ?? null,
    status_counts: counts,
    open_tasks: openTasks.slice(0, 15),
    recently_completed: tasks.filter((t: any) => t.status === "completed").slice(0, 6),
    blocked: tasks.filter((t: any) => t.status === "blocked").slice(0, 6),
    approvals_required: approvals,
    self_improvement_research: findings,
    latest_session_self_improvement: (() => {
      const s = sessions.find((x: any) => x.self_research_summary);
      return s
        ? {
            session_id: s.id,
            date: s.session_date,
            classification: s.self_research_classification,
            summary: s.self_research_summary,
            metrics: s.metadata?.metrics ?? null,
            capacity_review: s.metadata?.capacity_review ?? null,
          }
        : null;
    })(),
    ready_for_more_tasks: {
      ready:
        !openTasks.some((t: any) =>
          ["validating", "researching", "planning", "building", "testing", "repairing"].includes(
            t.status,
          ),
        ) || (todaysSession?.intake_limit ?? DAILY_TASK_CAPACITY) - todaysTasks.length > 0,
      remaining_capacity_today: Math.max(
        0,
        (todaysSession?.intake_limit ?? DAILY_TASK_CAPACITY) - todaysTasks.length,
      ),
      in_flight: openTasks.filter((t: any) =>
        [
          "queued",
          "validating",
          "researching",
          "planning",
          "building",
          "testing",
          "repairing",
        ].includes(t.status),
      ).length,
    },
  };
}

export async function loadKnowledge(db: any, userId: string): Promise<KnowledgeItem[]> {
  return rows(
    db
      .from("jarvis_knowledge_items")
      .select(
        "id,category,title,content,status,importance,source_type,source_ref,source_timestamp,supersedes_id,metadata,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(500),
  );
}

// ---------------------------------------------------------- Supabase reads

export async function runtimeTelemetry(db: any, userId: string, days = 7) {
  const span = Math.min(Math.max(Number(days) || 7, 1), 30);
  const events = await rows(
    db
      .from("emery_runtime_events")
      .select("channel,event_type,domain,action,status,duration_ms,metadata,created_at")
      .eq("user_id", userId)
      .gte("created_at", daysAgo(span))
      .order("created_at", { ascending: false })
      .limit(1000),
  );
  const breakdown: Record<string, Record<string, number>> = {};
  for (const event of events) {
    breakdown[event.event_type] ??= {};
    breakdown[event.event_type]![event.status] =
      (breakdown[event.event_type]![event.status] ?? 0) + 1;
  }
  const problems = events
    .filter((e: any) => e.status === "error" || e.status === "clarification")
    .slice(0, 25)
    .map((e: any) => ({
      at: e.created_at,
      channel: e.channel,
      event_type: e.event_type,
      domain: e.domain,
      action: e.action,
      status: e.status,
      detail: compactDetail(e.metadata),
    }));
  return { days: span, total_events: events.length, breakdown, recent_problems: problems };
}

function compactDetail(metadata: any) {
  if (!metadata || typeof metadata !== "object") return null;
  const keys = [
    "error",
    "message",
    "reason",
    "signal",
    "expected",
    "observed",
    "failure",
    "code",
    "case",
  ];
  const out: Record<string, unknown> = {};
  for (const key of keys)
    if (metadata[key] != null)
      out[key] =
        typeof metadata[key] === "string" ? String(metadata[key]).slice(0, 200) : metadata[key];
  return Object.keys(out).length ? out : null;
}

export async function executionReceipts(db: any, userId: string, days = 7) {
  const runs = await rows(
    db
      .from("emery_execution_runs")
      .select("domain,action,status,error_code,error_message,retryable,created_at,parent_run_id")
      .eq("user_id", userId)
      .gte("created_at", daysAgo(Math.min(Math.max(Number(days) || 7, 1), 30)))
      .order("created_at", { ascending: false })
      .limit(300),
  );
  const byStatus: Record<string, number> = {};
  for (const run of runs) byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
  return {
    total: runs.length,
    by_status: byStatus,
    recent_failures: runs.filter((r: any) => r.status === "failed").slice(0, 15),
    recent_clarifications: runs.filter((r: any) => r.status === "needs_clarification").slice(0, 8),
  };
}

export async function evaluations(db: any, userId: string) {
  const evals = await rows(
    db
      .from("emery_self_evaluations")
      .select("target_type,target_ref,rubric_version,scores,findings,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  );
  return {
    count: evals.length,
    latest: evals.map((e: any) => ({
      ...e,
      findings: JSON.stringify(e.findings ?? null).slice(0, 600),
    })),
  };
}

export async function improvementBacklog(db: any, userId: string) {
  const items = await rows(
    db
      .from("emery_improvement_backlog")
      .select(
        "id,area,title,problem_statement,severity,confidence,status,occurrence_count,last_observed_at,expected_benefit",
      )
      .eq("user_id", userId)
      .order("severity", { ascending: false })
      .order("last_observed_at", { ascending: false })
      .limit(40),
  );
  const byStatus: Record<string, number> = {};
  for (const item of items) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  return {
    by_status: byStatus,
    open: items
      .filter((i: any) => ["observed", "proposed", "testing"].includes(i.status))
      .slice(0, 15),
  };
}

export async function capabilityGaps(db: any, userId: string) {
  const [events, backlog] = await Promise.all([
    rows(
      db
        .from("emery_runtime_events")
        .select("event_type,action,status,metadata,created_at")
        .eq("user_id", userId)
        .gte("created_at", daysAgo(30))
        .or("event_type.ilike.%gap%,action.ilike.%gap%,action.ilike.%unsupported%")
        .order("created_at", { ascending: false })
        .limit(30),
    ),
    rows(
      db
        .from("emery_improvement_backlog")
        .select("title,problem_statement,area,severity,status,occurrence_count,last_observed_at")
        .eq("user_id", userId)
        .or(
          "title.ilike.%capabil%,problem_statement.ilike.%capabil%,problem_statement.ilike.%not connected%",
        )
        .limit(20),
    ),
  ]);
  return {
    runtime_gap_events: events,
    backlog_gaps: backlog,
    note:
      events.length + backlog.length
        ? undefined
        : "No capability gaps recorded in the last 30 days.",
  };
}

export async function databaseDiagnostics(db: any) {
  const { data, error } = await db.rpc("jarvis_database_diagnostics");
  if (error) throw new Error(error.message);
  const tables = Array.isArray(data?.tables) ? data.tables : [];
  return {
    ...data,
    tables: undefined,
    table_count: tables.length,
    largest_tables: [...tables]
      .sort((a: any, b: any) => b.estimated_rows - a.estimated_rows)
      .slice(0, 12),
    known_intentional: {
      hpo_import_payload_staging: "RLS enabled with no policies by design (service-only staging).",
      pg_net:
        "Installed in public; not relocatable and used by the push-dispatch cron job. Left unchanged deliberately.",
    },
  };
}

const RELEASE_COLUMNS =
  "release_name,production_commit_sha,previous_production_commit_sha,source_branch,source_pr_url,deployed_at,summary,capabilities_added,capabilities_changed,bugs_fixed,known_limitations,deployment_verified,produced_by,tests_run,metadata,created_at";

/** Production releases only. JARVIS candidate upgrades (metadata.kind = "candidate") are excluded. */
export async function releaseLedger(db: any, userId: string, limit = 8) {
  const all = await rows(
    db
      .from("emery_releases")
      .select(RELEASE_COLUMNS)
      .eq("user_id", userId)
      .order("deployed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit + 20),
  );
  return all.filter((r: any) => r.metadata?.kind !== "candidate").slice(0, limit);
}

/** Candidate upgrades JARVIS prepared (tested on a jarvis/* branch, PR open, NOT deployed). */
export async function candidateUpgrades(db: any, userId: string, limit = 6) {
  const all = await rows(
    db
      .from("emery_releases")
      .select(RELEASE_COLUMNS)
      .eq("user_id", userId)
      .eq("metadata->>kind", "candidate")
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return all.map((r: any) => ({
    name: r.release_name,
    candidate_commit: r.production_commit_sha,
    branch: r.source_branch,
    pr: r.source_pr_url,
    tests: r.tests_run,
    deployed: false,
    fixture: r.metadata?.fixture === true,
    created_at: r.created_at,
  }));
}

// -------------------------------------------------- Deployment observation

export type ServedBuild = {
  url: string;
  reachable: boolean;
  http_status: number | null;
  commit: string | null;
  build_id: string | null;
  error?: string;
};

export async function observeServedBuild(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<ServedBuild> {
  try {
    const [page, build] = await Promise.all([
      fetcher(`${url}/?jarvis_probe=${Date.now()}`, {
        headers: { "cache-control": "no-cache" },
        redirect: "follow",
      }),
      fetcher(`${url}/emery-build.json?jarvis_probe=${Date.now()}`, {
        headers: { "cache-control": "no-cache" },
      }).catch(() => null),
    ]);
    const html = page.ok ? await page.text() : "";
    const commit = html.match(/<meta[^>]+name="emery-commit"[^>]+content="([^"]*)"/i)?.[1] ?? null;
    let buildId: string | null = null;
    if (build && build.ok) {
      try {
        buildId = (await build.json())?.buildId ?? null;
      } catch {
        buildId = null;
      }
    }
    return {
      url,
      reachable: page.ok,
      http_status: page.status,
      commit: commit && commit !== "unknown" ? commit : null,
      build_id: buildId,
    };
  } catch (error) {
    return {
      url,
      reachable: false,
      http_status: null,
      commit: null,
      build_id: null,
      error: String((error as Error)?.message ?? error).slice(0, 200),
    };
  }
}

export type DeploymentReconciliation = {
  production_commit: string | null;
  production_commit_source: "served_bundle" | "release_ledger" | "unknown";
  github_main: string | null;
  running_server_commit: string | null;
  latest_release_commit: string | null;
  latest_release_verified: boolean;
  in_sync: boolean | null;
  discrepancies: string[];
};

export function reconcileDeployment(input: {
  servedCommit: string | null;
  runningCommit: string | null;
  githubMain: string | null;
  githubMainAhead?: number | null;
  latestRelease: { production_commit_sha: string; deployment_verified: boolean } | null;
}): DeploymentReconciliation {
  const short = (sha: string | null) => (sha ? sha.slice(0, 7) : "unknown");
  const discrepancies: string[] = [];
  const productionCommit = input.servedCommit ?? input.latestRelease?.production_commit_sha ?? null;
  const source = input.servedCommit
    ? "served_bundle"
    : input.latestRelease
      ? "release_ledger"
      : "unknown";
  if (!input.servedCommit)
    discrepancies.push(
      "The live production bundle does not report a commit stamp yet (it predates commit stamping, or the build had no git metadata). Production commit is taken from the release ledger.",
    );
  if (productionCommit && input.githubMain && !sameSha(productionCommit, input.githubMain))
    discrepancies.push(
      `Production (${short(productionCommit)}) differs from GitHub main (${short(input.githubMain)})${input.githubMainAhead ? ` — main is ${input.githubMainAhead} commit(s) ahead` : ""}. Unpublished or unrecorded changes exist.`,
    );
  if (
    input.latestRelease &&
    productionCommit &&
    !sameSha(input.latestRelease.production_commit_sha, productionCommit)
  )
    discrepancies.push(
      `The release ledger's latest entry (${short(input.latestRelease.production_commit_sha)}) does not match production (${short(productionCommit)}). A release record is missing.`,
    );
  if (input.latestRelease && !input.latestRelease.deployment_verified)
    discrepancies.push("Latest release record is not deployment-verified.");
  if (!input.latestRelease) discrepancies.push("No release has been recorded in emery_releases.");
  if (input.runningCommit && productionCommit && !sameSha(input.runningCommit, productionCommit))
    discrepancies.push(
      `This server instance runs ${short(input.runningCommit)}, not the production commit (likely a preview build).`,
    );
  const comparable = Boolean(productionCommit && input.githubMain);
  return {
    production_commit: productionCommit,
    production_commit_source: source,
    github_main: input.githubMain,
    running_server_commit: input.runningCommit,
    latest_release_commit: input.latestRelease?.production_commit_sha ?? null,
    latest_release_verified: Boolean(input.latestRelease?.deployment_verified),
    in_sync: comparable
      ? sameSha(productionCommit!, input.githubMain!) &&
        Boolean(
          input.latestRelease &&
          sameSha(input.latestRelease.production_commit_sha, productionCommit!),
        )
      : null,
    discrepancies,
  };
}

function sameSha(a: string, b: string) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

export async function deploymentTruth(
  db: any,
  userId: string,
  github: GithubClient | null,
  fetcher: typeof fetch = fetch,
) {
  const [served, releases, main] = await Promise.all([
    observeServedBuild(EMERY_PUBLISHED_URL, fetcher),
    releaseLedger(db, userId, 3),
    github
      ? github.inspectHistory("main", undefined, 1).then(
          (h) => ({ sha: h.commits[0]?.sha ?? null, error: null as string | null }),
          (error) => ({ sha: null, error: String(error?.message ?? error) }),
        )
      : Promise.resolve({ sha: null, error: "GitHub not configured" }),
  ]);
  const latest = releases[0] ?? null;
  let ahead: number | null = null;
  const production = served.commit ?? latest?.production_commit_sha ?? null;
  if (github && production && main.sha && !sameSha(production, main.sha)) {
    ahead = await github.compare(production, main.sha).then(
      (c) => c.ahead_by ?? null,
      () => null,
    );
  }
  const reconciliation = reconcileDeployment({
    servedCommit: served.commit,
    runningCommit: EMERY_BUILD.commit,
    githubMain: main.sha,
    githubMainAhead: ahead,
    latestRelease: latest,
  });
  if (main.error) reconciliation.discrepancies.push(`GitHub main could not be read: ${main.error}`);
  return { served, latest_release: latest, reconciliation, running_build: EMERY_BUILD };
}

// ------------------------------------------------------------ Self-awareness

export async function systemVersion(db: any, userId: string) {
  const releases = await releaseLedger(db, userId, 1);
  const latest = releases[0] ?? null;
  return {
    running_commit: EMERY_BUILD.commit,
    running_built_at: EMERY_BUILD.builtAt,
    running_commit_known: Boolean(EMERY_BUILD.commit),
    latest_release: latest
      ? {
          name: latest.release_name,
          commit: latest.production_commit_sha,
          deployed_at: latest.deployed_at,
          verified: latest.deployment_verified,
          summary: latest.summary,
        }
      : null,
  };
}

export async function recentChanges(db: any, userId: string, github: GithubClient | null) {
  const [releases, candidates, commits] = await Promise.all([
    releaseLedger(db, userId, 8),
    candidateUpgrades(db, userId, 6),
    github
      ? github.inspectHistory("main", undefined, 8).then(
          (h) => h.commits,
          () => null,
        )
      : Promise.resolve(null),
  ]);
  return {
    releases: releases.map((r: any) => ({
      name: r.release_name,
      commit: r.production_commit_sha,
      deployed_at: r.deployed_at,
      verified: r.deployment_verified,
      summary: r.summary,
      capabilities_added: r.capabilities_added,
      capabilities_changed: r.capabilities_changed,
      bugs_fixed: r.bugs_fixed,
      known_limitations: r.known_limitations,
      produced_by: r.produced_by,
    })),
    candidate_upgrades_not_deployed: candidates,
    main_commits: commits,
    note: "Releases are deployed production upgrades. Candidate upgrades are tested JARVIS PRs that are NOT live until Adam approves the release — never describe them as deployed.",
  };
}

export function capabilitySummary() {
  const byFamily: Record<string, { total: number; executable: number }> = {};
  for (const entry of CAPABILITY_CATALOG) {
    const key = `${entry.owner}:${entry.family}`;
    byFamily[key] ??= { total: 0, executable: 0 };
    byFamily[key]!.total += 1;
    if (entry.executable) byFamily[key]!.executable += 1;
  }
  return {
    total: CAPABILITY_CATALOG.length,
    by_family: byFamily,
    not_available: CAPABILITY_CATALOG.filter((e) => !e.executable).map((e) => ({
      name: e.name,
      why: e.description,
    })),
  };
}

export async function capabilityHealth(
  db: any,
  userId: string,
  env: Record<string, string | undefined>,
  name?: string,
) {
  const [receipts, toolEvents] = await Promise.all([
    rows(
      db
        .from("emery_execution_runs")
        .select("action,status,created_at,error_message")
        .eq("user_id", userId)
        .gte("created_at", daysAgo(30))
        .order("created_at", { ascending: false })
        .limit(500),
    ),
    rows(
      db
        .from("emery_runtime_events")
        .select("action,status,created_at")
        .eq("user_id", userId)
        .eq("event_type", "jarvis_tool")
        .gte("created_at", daysAgo(30))
        .order("created_at", { ascending: false })
        .limit(500),
    ),
  ]);
  const entries = name ? CAPABILITY_CATALOG.filter((e) => e.name === name) : CAPABILITY_CATALOG;
  const results = entries.map((entry) => ({
    owner: entry.owner,
    ...healthFromEvidence(entry, { receipts, toolEvents, env }),
  }));
  const summary: Record<string, number> = {};
  for (const result of results) summary[result.health] = (summary[result.health] ?? 0) + 1;
  return {
    summary,
    capabilities: name
      ? results
      : results.filter((r) => r.health !== "configured_untested").slice(0, 40),
    untested_count: results.filter((r) => r.health === "configured_untested").length,
  };
}

export async function knownIssues(db: any, userId: string) {
  const [telemetry, receipts, backlog, releases] = await Promise.all([
    runtimeTelemetry(db, userId, 14),
    executionReceipts(db, userId, 14),
    improvementBacklog(db, userId),
    releaseLedger(db, userId, 3),
  ]);
  return {
    recent_runtime_problems: telemetry.recent_problems.slice(0, 12),
    failed_receipts: receipts.recent_failures.slice(0, 10),
    open_backlog: backlog.open.slice(0, 10),
    release_known_limitations: releases
      .flatMap((r: any) => (Array.isArray(r.known_limitations) ? r.known_limitations : []))
      .slice(0, 10),
  };
}

export async function improvementStatus(db: any, userId: string) {
  const [status, backlog] = await Promise.all([
    getJarvisStatus(db, userId),
    improvementBacklog(db, userId),
  ]);
  return {
    jarvis_task_counts: status.status_counts,
    open_tasks: status.open_tasks.map((t: any) => ({
      title: t.title,
      status: t.status,
      priority: t.priority,
      blocker: t.blocker,
    })),
    backlog_by_status: backlog.by_status,
    top_backlog: backlog.open.slice(0, 6).map((b: any) => ({
      title: b.title,
      severity: b.severity,
      status: b.status,
      occurrences: b.occurrence_count,
    })),
    latest_self_research: status.self_improvement_research[0] ?? null,
  };
}

// ----------------------------------------------------- Lovable observability

export async function lovablePreviewState(fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher(EMERY_PREVIEW_URL, { redirect: "manual" });
    return {
      url: EMERY_PREVIEW_URL,
      http_status: response.status,
      reachable: response.status < 500,
      note:
        response.status >= 300 && response.status < 400
          ? "Preview requires Lovable sign-in (redirect); reachability only."
          : undefined,
    };
  } catch (error) {
    return {
      url: EMERY_PREVIEW_URL,
      http_status: null,
      reachable: false,
      error: String((error as Error).message).slice(0, 200),
    };
  }
}

export function jarvisToolConfiguration(env: Record<string, string | undefined>) {
  const required = new Set(JARVIS_TOOLS.flatMap((tool) => tool.requiresEnv ?? []));
  return Object.fromEntries([...required].map((key) => [key, Boolean(env[key])]));
}
