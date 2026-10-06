// JARVIS engineering worker engine. Pure orchestration over injected ports so it
// is unit-tested in Node and run in the jarvis-worker Edge Function.
//
// Authoritative state: jarvis_engineering_tasks / jarvis_engineering_sessions.
// Safety:
//   - tasks are claimed with leases; every write is fenced by the lease token
//   - every GitHub mutation is idempotent (branch reuse, commit markers, PR reuse)
//   - generated code is only executed in the isolated jarvis-candidate CI job
//     (no production secrets); the worker itself never runs generated code
//   - concurrency: ≤4 active leases, ≤1 code-writing task at a time

import { assertSafeContent, assertSafeRepoPath, assessPaidCreditRequest } from "./guards.ts";
import type { Annotation, GithubOps } from "./github-ops.ts";
import type { EditPlan, PlannedEdit, Planner } from "./llm.ts";
import { buildOpportunities, type RadarInputs } from "./radar.ts";

export const RUNNABLE = [
  "queued",
  "validating",
  "researching",
  "planning",
  "building",
  "testing",
  "repairing",
] as const;
export const TERMINAL = [
  "completed",
  "ready_for_release",
  "failed",
  "cancelled",
  "deferred",
  "blocked",
] as const;
export const DAILY_CAPACITY = 50;
const MAX_STEP_ERRORS = 3;
const CI_TIMEOUT_MS = 30 * 60_000;
const DIAGNOSTIC_TABLES = new Set([
  "emery_runtime_events",
  "emery_execution_runs",
  "emery_self_evaluations",
  "emery_improvement_backlog",
  "jarvis_engineering_tasks",
]);
const EDITABLE_ROOTS = ["src/", "scripts/", "docs/"];
const PROTECTED_CODE = [
  { pattern: /^src\/integrations\//, reason: "generated auth/database integration" },
  { pattern: /^src\/lib\/(hpo-|hpo\/)|^src\/components\/Hpo/, reason: "protected HPO workflow" },
  { pattern: /auth|security|rls|secret|credential/i, reason: "auth/security-sensitive path" },
];

export type TaskRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  source_type: string;
  source_ref: string | null;
  title: string;
  objective: string | null;
  why_it_matters: string | null;
  priority: number;
  risk_level: string;
  status: string;
  branch_name: string | null;
  commit_sha: string | null;
  pr_url: string | null;
  test_results: Record<string, any>;
  result_summary: string | null;
  blocker: string | null;
  attempt_count: number;
  task_spec: Record<string, any>;
  stage_state: Record<string, any>;
  metadata: Record<string, any>;
  dedupe_key: string | null;
  depends_on: string[];
  merged_into: string | null;
  lease_token: string | null;
  next_attempt_at: string;
  is_fixture: boolean;
  /** proposed | approved | superseded. Only approved tasks are ever claimed or counted. */
  approval_state?: string;
  created_at: string;
  completed_at: string | null;
};

/** Read-only radar diagnostics at or above this confidence may run without Adam approving them first. */
export const RADAR_AUTO_CONFIDENCE = 0.8;

export type SessionRow = {
  id: string;
  user_id: string;
  session_date: string;
  status: string;
  intake_limit: number;
  accepted_count: number;
  started_at: string | null;
  metadata: Record<string, any>;
};

export interface Store {
  ownerId(): Promise<string>;
  claim(workerId: string, limit: number): Promise<TaskRow[]>;
  /** Fenced write: only succeeds while `leaseToken` still owns the task. */
  update(id: string, leaseToken: string, patch: Partial<TaskRow>): Promise<boolean>;
  /** Fenced write that also clears the lease. */
  release(id: string, leaseToken: string, patch: Partial<TaskRow>): Promise<boolean>;
  tasks(filter: {
    userId: string;
    statuses?: string[];
    sinceIso?: string;
    ids?: string[];
    sessionId?: string;
  }): Promise<TaskRow[]>;
  insertTask(row: Partial<TaskRow>): Promise<{ id: string } | { duplicate: true }>;
  openSession(userId: string, date: string): Promise<SessionRow | null>;
  insertSession(row: Partial<SessionRow>): Promise<SessionRow>;
  /** Conditional update: only applies when the session still has `expectStatus`. */
  updateSession(
    id: string,
    patch: Record<string, unknown>,
    expectStatus?: string,
  ): Promise<boolean>;
  runningSessions(userId: string): Promise<SessionRow[]>;
  acceptedOn(userId: string, date: string): Promise<number>;
  /** Atomic, capacity-checked, lease-fenced assignment of a task to a session. */
  acceptInto(
    taskId: string,
    leaseToken: string,
    sessionId: string,
    date: string,
    limit: number,
  ): Promise<boolean>;
  count(table: string, userId: string, sinceIso: string): Promise<number>;
  radarInputs(userId: string, sinceIso: string): Promise<RadarInputs>;
  lastEventAt(userId: string, eventType: string): Promise<string | null>;
  logEvent(
    userId: string,
    event: {
      event_type: string;
      action: string;
      status: "ok" | "error" | "skipped";
      duration_ms?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  insertFinding(row: Record<string, unknown>): Promise<void>;
  recordCandidate(row: Record<string, unknown>): Promise<void>;
}

export type EngineDeps = {
  store: Store;
  github: GithubOps | null;
  planner: Planner | null;
  workerId: string;
  now?: () => Date;
  budgetMs?: number;
  forceRadar?: boolean;
};

type StepResult = {
  status: string;
  patch?: Partial<TaskRow>;
  /** Seconds before the task may run again (releases the lease). */
  wait?: number;
  note: string;
};

/** Mirrors src/lib/jarvis/state.ts countsTowardCapacity (and the jarvis_accept_task SQL). */
export function countsTowardCapacity(t: TaskRow) {
  return Boolean(
    t.session_id &&
    !t.is_fixture &&
    (t.approval_state ?? "approved") === "approved" &&
    !["cancelled", "deferred"].includes(t.status) &&
    !t.merged_into,
  );
}

export function easternDate(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nextEasternMidnight(d: Date) {
  const date = easternDate(d);
  const [y, m, day] = date.split("-").map(Number);
  // 05:00Z is safely after midnight in America/New_York (EST/EDT).
  return new Date(Date.UTC(y!, m! - 1, day! + 1, 5, 0, 0));
}

export function normalizeTitle(title: string) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(text: string) {
  return new Set(
    normalizeTitle(text)
      .split(" ")
      .filter((t) => t.length > 2),
  );
}

export function similarity(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter += 1;
  return inter / (x.size + y.size - inter);
}

function slug(text: string) {
  return normalizeTitle(text).replace(/ /g, "-").slice(0, 36).replace(/-+$/, "") || "task";
}

export function branchFor(task: Pick<TaskRow, "id" | "title">) {
  return `jarvis/t-${task.id.slice(0, 8)}-${slug(task.title)}`;
}

export function marker(task: Pick<TaskRow, "id">, step: string) {
  return `[jarvis-task ${task.id.slice(0, 8)} ${step}]`;
}

export function classifyRisk(task: Pick<TaskRow, "title" | "objective" | "task_spec">) {
  const spec = task.task_spec ?? {};
  if (spec.kind !== "code_change") return { level: "low", approval: null as string | null };
  const paths: string[] = [
    ...(Array.isArray(spec.target_paths) ? spec.target_paths : []),
    ...(Array.isArray(spec.edits) ? spec.edits.map((e: any) => e?.path) : []),
  ].filter((p): p is string => typeof p === "string");
  for (const path of paths) {
    if (!EDITABLE_ROOTS.some((root) => path.startsWith(root)))
      return {
        level: "critical",
        approval: `Path ${path} is outside JARVIS's autonomous edit scope (src/, scripts/, docs/). Adam approval required.`,
      };
    const hit = PROTECTED_CODE.find((entry) => entry.pattern.test(path));
    if (hit)
      return {
        level: "high",
        approval: `${path} is a ${hit.reason}. Adam approval required before JARVIS edits it.`,
      };
  }
  const text = `${task.title} ${task.objective ?? ""}`;
  if (
    /\b(drop|delete|truncate|migration|row level security|rls|credential|secret|auth)\b/i.test(text)
  )
    return {
      level: "high",
      approval: "Objective touches database/auth/credential territory. Adam approval required.",
    };
  return { level: "medium", approval: null };
}

export function applyEdits(files: Map<string, string | null>, edits: PlannedEdit[]) {
  const out = new Map<string, string>();
  for (const edit of edits) {
    const path = assertSafeRepoPath(edit.path);
    if (!EDITABLE_ROOTS.some((root) => path.startsWith(root)))
      throw new Error(`Edit outside src/, scripts/ or docs/: ${path}`);
    if ("create" in edit) {
      if ((files.get(path) ?? null) !== null && !out.has(path))
        throw new Error(`${path} already exists — use a find/replace edit.`);
      assertSafeContent(path, edit.content);
      out.set(path, edit.content);
      continue;
    }
    const current = out.get(path) ?? files.get(path);
    if (current == null)
      throw new Error(`Cannot edit ${path}: file not found on the candidate branch.`);
    const occurrences = edit.find ? current.split(edit.find).length - 1 : 0;
    if (occurrences !== 1)
      throw new Error(`Find text must occur exactly once in ${path} (found ${occurrences}).`);
    const next = current.replace(edit.find, edit.replace);
    assertSafeContent(path, next);
    out.set(path, next);
  }
  return [...out.entries()].map(([path, content]) => ({ path, content }));
}

function appendLog(state: Record<string, any>, entry: Record<string, unknown>) {
  const log = Array.isArray(state.log) ? state.log : [];
  return { ...state, log: [...log, entry].slice(-40) };
}

export class Engine {
  private readonly d: EngineDeps;
  private readonly now: () => Date;
  private readonly started: number;
  report = {
    claimed: 0,
    steps: 0,
    completed: 0,
    errors: 0,
    radar: null as null | Record<string, unknown>,
    finalized: [] as string[],
    lease_lost: 0,
  };

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.now = deps.now ?? (() => new Date());
    this.started = this.now().getTime();
  }

  private timeLeft() {
    return (this.d.budgetMs ?? 100_000) - (this.now().getTime() - this.started);
  }

  async tick() {
    const owner = await this.d.store.ownerId();
    await this.runRadar(owner).catch(async (error) => {
      await this.d.store.logEvent(owner, {
        event_type: "jarvis_radar",
        action: "radar",
        status: "error",
        metadata: { error: String(error?.message ?? error).slice(0, 300) },
      });
    });
    while (this.timeLeft() > 15_000) {
      const claimed = await this.d.store.claim(this.d.workerId, 4);
      if (!claimed.length) break;
      this.report.claimed += claimed.length;
      await Promise.all(claimed.map((task) => this.runTask(task)));
    }
    await this.finalizeSessions(owner);
    return this.report;
  }

  // ------------------------------------------------------------- per task

  async runTask(task: TaskRow) {
    let current = task;
    const token = task.lease_token as string;
    for (let i = 0; i < 8; i += 1) {
      if (this.timeLeft() < 10_000) {
        await this.d.store.release(current.id, token, {
          next_attempt_at: this.now().toISOString(),
        });
        return;
      }
      const startedAt = this.now().getTime();
      let result: StepResult;
      try {
        result = await this.step(current);
      } catch (error: any) {
        this.report.errors += 1;
        const errors = Number(current.stage_state?.errors ?? 0) + 1;
        const message = String(error?.message ?? error).slice(0, 400);
        const stage_state = appendLog(
          { ...current.stage_state, errors },
          { at: this.now().toISOString(), stage: current.status, error: message },
        );
        await this.d.store.logEvent(current.user_id, {
          event_type: "jarvis_worker",
          action: `${current.status}:error`,
          status: "error",
          metadata: { task_id: current.id, error: message },
        });
        if (errors >= MAX_STEP_ERRORS) {
          await this.d.store.release(current.id, token, {
            status: "failed",
            stage_state,
            blocker: `Stopped after ${errors} errors in ${current.status}: ${message}`,
          });
        } else {
          await this.d.store.release(current.id, token, {
            stage_state,
            next_attempt_at: new Date(this.now().getTime() + 60_000 * errors).toISOString(),
          });
        }
        return;
      }
      this.report.steps += 1;
      const stage_state = appendLog(
        { ...current.stage_state, ...(result.patch?.stage_state ?? {}) },
        {
          at: this.now().toISOString(),
          from: current.status,
          to: result.status,
          note: result.note.slice(0, 300),
        },
      );
      const patch: Partial<TaskRow> = { ...result.patch, status: result.status, stage_state };
      if (result.status === "completed" || result.status === "ready_for_release")
        patch.completed_at = this.now().toISOString();
      await this.d.store.logEvent(current.user_id, {
        event_type: "jarvis_worker",
        action: `${current.status}->${result.status}`,
        status: result.status === "failed" ? "error" : "ok",
        duration_ms: this.now().getTime() - startedAt,
        metadata: {
          task_id: current.id,
          note: result.note.slice(0, 200),
          fixture: current.is_fixture,
        },
      });
      const terminal = (TERMINAL as readonly string[]).includes(result.status);
      if (terminal || result.wait !== undefined) {
        if (terminal) this.report.completed += 1;
        const ok = await this.d.store.release(current.id, token, {
          ...patch,
          next_attempt_at: new Date(this.now().getTime() + (result.wait ?? 0) * 1000).toISOString(),
        });
        if (!ok) this.report.lease_lost += 1;
        return;
      }
      const ok = await this.d.store.update(current.id, token, patch);
      if (!ok) {
        this.report.lease_lost += 1;
        return; // another worker owns it now — stop without further side effects
      }
      current = { ...current, ...patch } as TaskRow;
    }
    await this.d.store.release(current.id, token, { next_attempt_at: this.now().toISOString() });
  }

  async step(task: TaskRow): Promise<StepResult> {
    const kind = task.task_spec?.kind;
    switch (task.status) {
      case "queued":
        return this.accept(task);
      case "validating":
        return this.validate(task);
      case "researching":
        return this.runDiagnostics(task);
      case "testing":
        return kind === "code_change" ? this.checkCi(task) : this.verifyDiagnostics(task);
      case "planning":
        return this.createBranch(task);
      case "building":
        return this.build(task);
      case "repairing":
        return this.repair(task);
      default:
        return { status: task.status, wait: 3600, note: `No executor for status ${task.status}.` };
    }
  }

  private async accept(task: TaskRow): Promise<StepResult> {
    if (task.session_id) return { status: "validating", note: "Already accepted." };
    const now = this.now();
    const date = easternDate(now);
    const session = await this.sessionFor(task.user_id, date);
    const accepted = await this.d.store.acceptInto(
      task.id,
      task.lease_token as string,
      session.id,
      date,
      session.intake_limit ?? DAILY_CAPACITY,
    );
    if (!accepted) {
      return {
        status: "queued",
        wait: Math.max(60, Math.round((nextEasternMidnight(now).getTime() - now.getTime()) / 1000)),
        patch: { metadata: { ...task.metadata, capacity_deferred_on: date } },
        note: `Daily intake capacity (${session.intake_limit ?? DAILY_CAPACITY}) reached for ${date}; held for the next day.`,
      };
    }
    return {
      status: "validating",
      patch: { session_id: session.id },
      note: "Accepted into today's engineering session.",
    };
  }

  private sessionCache = new Map<string, Promise<SessionRow>>();

  /** One open session per day: concurrent acceptances share one lookup; the DB unique index settles cross-worker races. */
  private sessionFor(userId: string, date: string) {
    let pending = this.sessionCache.get(date);
    if (!pending) {
      pending = (async () => {
        const open = await this.d.store.openSession(userId, date);
        if (open) return open;
        try {
          return await this.d.store.insertSession({
            user_id: userId,
            session_date: date,
            status: "running",
            intake_limit: DAILY_CAPACITY,
            accepted_count: 0,
            started_at: this.now().toISOString(),
            metadata: { opened_by: "jarvis-worker" },
          });
        } catch (error) {
          const raced = await this.d.store.openSession(userId, date);
          if (raced) return raced;
          throw error;
        }
      })();
      this.sessionCache.set(date, pending);
      pending.catch(() => this.sessionCache.delete(date));
    }
    return pending;
  }

  private async validate(task: TaskRow): Promise<StepResult> {
    const spec = task.task_spec ?? {};
    if (!["diagnostic", "code_change"].includes(spec.kind))
      return {
        status: "blocked",
        patch: {
          blocker: "Needs an executable spec (diagnostic checks or a code_change objective).",
        },
        note: "No executable spec.",
      };

    const credit = assessPaidCreditRequest(
      `${task.title}. ${task.objective ?? ""}. ${spec.objective ?? ""}`,
    );
    if (credit.requestsPaidPath && !credit.approved)
      return {
        status: "blocked",
        patch: {
          blocker: `Free-first policy: this asks for ${credit.services.join(" + ")}. Adam approval required — free alternative: direct GitHub branch/edit/CI/PR.`,
          metadata: {
            ...task.metadata,
            approval: { kind: "paid_credit", services: credit.services },
          },
        },
        note: "Paid-credit path requested — stopped for Adam's approval.",
      };

    // De-duplicate and merge overlap against open/recent work.
    const since = new Date(this.now().getTime() - 7 * 86_400_000).toISOString();
    const others = (await this.d.store.tasks({ userId: task.user_id, sinceIso: since })).filter(
      (o) =>
        o.id !== task.id &&
        // A failed or cancelled task cannot absorb new work: a re-run must execute.
        !["cancelled", "failed"].includes(o.status) &&
        !o.merged_into &&
        // Strict order (id breaks timestamp ties) so two duplicates never merge into each other.
        (o.created_at < task.created_at || (o.created_at === task.created_at && o.id < task.id)),
    );
    const norm = normalizeTitle(task.title);
    const dup = others.find(
      (o) =>
        (task.dedupe_key && o.dedupe_key === task.dedupe_key) ||
        normalizeTitle(o.title) === norm ||
        (spec.kind === "code_change" &&
          o.task_spec?.kind === "code_change" &&
          similarity(o.title, task.title) >= 0.6 &&
          JSON.stringify([...(o.task_spec?.target_paths ?? [])].sort()) ===
            JSON.stringify([...(spec.target_paths ?? [])].sort())),
    );
    if (dup)
      return {
        status: "cancelled",
        patch: {
          merged_into: dup.id,
          result_summary: `Duplicate/overlapping work merged into "${dup.title}" (${dup.id.slice(0, 8)}).`,
        },
        note: `Merged into ${dup.id.slice(0, 8)}.`,
      };

    // Dependencies: follow merges; a dependency that cannot complete blocks this task.
    if (task.depends_on?.length) {
      const deps = await this.d.store.tasks({ userId: task.user_id, ids: task.depends_on });
      const resolved = deps.map((d) => d.merged_into ?? d.id);
      const dead = deps.filter(
        (d) => !d.merged_into && ["failed", "cancelled", "blocked", "deferred"].includes(d.status),
      );
      if (dead.length)
        return {
          status: "blocked",
          patch: { blocker: `Dependency did not complete: ${dead.map((d) => d.title).join(", ")}` },
          note: "Dependency failed.",
        };
      if (resolved.join() !== task.depends_on.join())
        return {
          status: "validating",
          patch: { depends_on: resolved },
          wait: 0,
          note: "Rewired dependencies to merged tasks.",
        };
    }

    const risk = classifyRisk(task);
    if (risk.approval)
      return {
        status: "blocked",
        patch: {
          risk_level: risk.level,
          blocker: risk.approval,
          metadata: { ...task.metadata, approval: { kind: "risk" } },
        },
        note: "Risk requires Adam approval.",
      };
    if (spec.kind === "code_change" && !spec.edits && !this.d.planner)
      return {
        status: "blocked",
        patch: { blocker: "No code planner configured (OPENAI_API_KEY missing on the worker)." },
        note: "Planner unavailable.",
      };
    if (spec.kind === "code_change" && !this.d.github)
      return {
        status: "blocked",
        patch: {
          blocker: "GitHub gateway not configured (JARVIS_GITHUB_TOKEN missing on the worker).",
        },
        note: "GitHub unavailable.",
      };
    return {
      status: spec.kind === "diagnostic" ? "researching" : "planning",
      patch: { risk_level: risk.level },
      note: `Validated (${spec.kind}, risk ${risk.level}).`,
    };
  }

  // ------------------------------------------------------------ diagnostics

  private async runDiagnostics(task: TaskRow): Promise<StepResult> {
    const checks: any[] =
      Array.isArray(task.task_spec?.checks) && task.task_spec.checks.length
        ? task.task_spec.checks.slice(0, 10)
        : [{ type: "noop" }];
    const results: any[] = [];
    for (const check of checks) {
      try {
        if (check.type === "noop") results.push({ type: "noop", ok: true });
        else if (check.type === "db_count") {
          if (!DIAGNOSTIC_TABLES.has(check.table))
            throw new Error(`table ${check.table} is not allowlisted`);
          const since = new Date(
            this.now().getTime() - Number(check.days ?? 7) * 86_400_000,
          ).toISOString();
          const n = await this.d.store.count(check.table, task.user_id, since);
          results.push({
            type: "db_count",
            table: check.table,
            days: check.days ?? 7,
            count: n,
            ok: check.min === undefined || n >= Number(check.min),
          });
        } else if (check.type === "github_file") {
          if (!this.d.github) throw new Error("GitHub not configured");
          const text = await this.d.github.readFile(
            String(check.path),
            String(check.ref ?? "main"),
          );
          results.push({
            type: "github_file",
            path: check.path,
            exists: text !== null,
            ok: text !== null && (!check.contains || text.includes(String(check.contains))),
          });
        } else if (check.type === "radar_dry_run") {
          const inputs = await this.d.store.radarInputs(
            task.user_id,
            new Date(this.now().getTime() - 14 * 86_400_000).toISOString(),
          );
          const opps = buildOpportunities(inputs);
          results.push({
            type: "radar_dry_run",
            opportunities: opps.length,
            top: opps.slice(0, 3).map((o) => ({ title: o.title, score: o.score })),
            ok: true,
          });
        } else results.push({ type: check.type, ok: false, error: "unknown check type" });
      } catch (error: any) {
        results.push({
          type: check.type,
          ok: false,
          error: String(error?.message ?? error).slice(0, 200),
        });
      }
    }
    return {
      status: "testing",
      patch: { test_results: { ...task.test_results, checks: results } },
      note: `Ran ${results.length} diagnostic check(s).`,
    };
  }

  private async verifyDiagnostics(task: TaskRow): Promise<StepResult> {
    const checks: any[] = task.test_results?.checks ?? [];
    const failed = checks.filter((c) => !c.ok);
    if (failed.length)
      return {
        status: "failed",
        patch: {
          result_summary: `${failed.length}/${checks.length} checks failed`,
          blocker: JSON.stringify(failed).slice(0, 500),
        },
        note: "Diagnostic verification failed.",
      };
    return {
      status: "completed",
      patch: {
        result_summary: `Verified ${checks.length} check(s): ${checks.map((c) => `${c.type}${c.count !== undefined ? `=${c.count}` : ""}`).join(", ")}`,
      },
      note: "Diagnostic verified.",
    };
  }

  // ---------------------------------------------------------- code changes

  private async createBranch(task: TaskRow): Promise<StepResult> {
    const gh = this.d.github!;
    const branch = task.branch_name ?? branchFor(task);
    const mainSha = task.stage_state?.base_sha ?? (await gh.branchHead("main"));
    if (!mainSha) throw new Error("Cannot read main head.");
    const ensured = await gh.ensureBranch(branch, mainSha);
    const doc = [
      `# JARVIS candidate ${task.id.slice(0, 8)}: ${task.title}`,
      "",
      `- Task: \`${task.id}\``,
      `- Source: ${task.source_type}${task.source_ref ? ` (${task.source_ref})` : ""}`,
      `- Base: main @ \`${mainSha.slice(0, 7)}\``,
      `- Risk: ${task.risk_level}`,
      "",
      "## Objective",
      "",
      String(task.task_spec?.objective ?? task.objective ?? task.title),
      "",
      "## Evidence",
      "",
      "```json",
      JSON.stringify(
        task.metadata?.radar?.evidence ?? task.task_spec?.evidence ?? [],
        null,
        2,
      ).slice(0, 4000),
      "```",
      "",
      "## Verification",
      "",
      "Isolated GitHub Actions job `jarvis-candidate` (no production secrets): typecheck, validate:jarvis, validate:phase0, validate:behavior, build.",
      "",
    ].join("\n");
    const checkpoint = await gh.commitFiles(
      branch,
      [{ path: `docs/jarvis-engineer/candidates/${task.id.slice(0, 8)}.md`, content: doc }],
      `JARVIS checkpoint: ${task.title}`.slice(0, 120),
      marker(task, "plan"),
    );
    return {
      status: "building",
      patch: {
        branch_name: branch,
        commit_sha: checkpoint.sha,
        stage_state: {
          base_sha: mainSha,
          branch_created: ensured.created,
          checkpoint_sha: checkpoint.sha,
        },
      },
      note: `Branch ${branch} ${ensured.created ? "created" : "reused"}; checkpoint ${checkpoint.sha.slice(0, 7)}${checkpoint.reused ? " (reused)" : ""}.`,
    };
  }

  private async filesAt(branch: string, paths: string[]) {
    const gh = this.d.github!;
    const map = new Map<string, string | null>();
    for (const path of [...new Set(paths)].slice(0, 6))
      map.set(path, await gh.readFile(path, branch));
    return map;
  }

  /** If a previous attempt already committed this step (then crashed before recording), adopt that commit. */
  private async alreadyCommitted(task: TaskRow, step: string) {
    const gh = this.d.github!;
    const head = await gh.branchHead(task.branch_name!);
    if (!head) return null;
    const commit = await gh.commit(head);
    return commit.message.includes(marker(task, step)) ? head : null;
  }

  private async build(task: TaskRow): Promise<StepResult> {
    const gh = this.d.github!;
    const spec = task.task_spec ?? {};
    const branch = task.branch_name!;
    const existing = await this.alreadyCommitted(task, "build");
    if (existing)
      return {
        status: "testing",
        patch: {
          commit_sha: existing,
          stage_state: {
            ci_sha: existing,
            ci_started_at: this.now().toISOString(),
            recovered: true,
          },
        },
        wait: 60,
        note: `Recovered build commit ${existing.slice(0, 7)} from a previous attempt (no duplicate work).`,
      };
    let plan: EditPlan;
    let files: Array<{ path: string; content: string }>;
    if (Array.isArray(spec.edits) && spec.edits.length) {
      const current = await this.filesAt(
        branch,
        spec.edits.map((e: any) => e.path),
      );
      plan = { summary: String(spec.summary ?? "Specified change"), edits: spec.edits };
      files = applyEdits(current, plan.edits);
    } else {
      const targets: string[] = Array.isArray(spec.target_paths) ? spec.target_paths : [];
      if (!targets.length) throw new Error("code_change needs target_paths or explicit edits.");
      const current = await this.filesAt(branch, targets);
      const context = [...current.entries()]
        .filter(([, c]) => c !== null)
        .map(([path, content]) => ({ path, content: content as string }));
      const constraints = [
        "Only edit files under src/, scripts/ or docs/.",
        "Keep public APIs and existing behaviour intact unless the objective requires otherwise.",
        "The candidate must pass: tsc --noEmit, validate:jarvis, validate:phase0, validate:behavior, vite build.",
      ];
      plan = await this.d.planner!.planEdits({
        objective: String(spec.objective ?? task.objective ?? task.title),
        files: context,
        constraints,
      });
      try {
        files = applyEdits(current, plan.edits);
      } catch (error: any) {
        plan = await this.d.planner!.planEdits({
          objective: String(spec.objective ?? task.objective ?? task.title),
          files: context,
          constraints,
          feedback: String(error?.message ?? error),
        });
        files = applyEdits(current, plan.edits);
      }
    }
    if (spec.inject_failure && !task.stage_state?.failure_injected) {
      // Controlled-failure fixture: add a deliberately broken file so the repair loop is exercised.
      files.push({
        path: String(spec.inject_failure.path),
        content: String(spec.inject_failure.content),
      });
    }
    const commit = await gh.commitFiles(
      branch,
      files,
      `JARVIS: ${task.title}`.slice(0, 120),
      marker(task, "build"),
    );
    return {
      status: "testing",
      patch: {
        commit_sha: commit.sha,
        stage_state: {
          ci_sha: commit.sha,
          ci_started_at: this.now().toISOString(),
          plan_summary: plan.summary,
          files_changed: files.map((f) => f.path),
          failure_injected:
            Boolean(spec.inject_failure) || task.stage_state?.failure_injected === true,
        },
      },
      wait: 60,
      note: `Committed ${files.length} file(s) as ${commit.sha.slice(0, 7)}; waiting for isolated CI.`,
    };
  }

  private async checkCi(task: TaskRow): Promise<StepResult> {
    const gh = this.d.github!;
    const sha = task.stage_state?.ci_sha as string;
    const ci = await gh.ci(sha);
    const startedAt = Date.parse(task.stage_state?.ci_started_at ?? task.created_at);
    if (ci.state === "missing" || ci.state === "pending") {
      if (this.now().getTime() - startedAt > CI_TIMEOUT_MS)
        return {
          status: "failed",
          patch: {
            blocker: `Isolated CI did not report for ${sha.slice(0, 7)} within 30 minutes.`,
          },
          note: "CI timeout.",
        };
      return { status: "testing", wait: 60, note: `CI ${ci.state} for ${sha.slice(0, 7)}.` };
    }
    const history = [
      ...(task.test_results?.ci ?? []),
      { sha, state: ci.state, url: ci.url, at: this.now().toISOString() },
    ];
    if (ci.state === "failure") {
      const failures: Annotation[] =
        ci.failures ?? (ci.checkRunId ? await gh.annotations(ci.checkRunId) : []);
      const repairs = Number(task.stage_state?.repairs ?? 0);
      const maxRepairs = Math.min(Number(task.task_spec?.max_repairs ?? 2), 3);
      if (repairs >= maxRepairs)
        return {
          status: "failed",
          patch: {
            test_results: { ...task.test_results, ci: history },
            blocker: `Isolated CI still failing after ${repairs} bounded repair(s): ${failures
              .map((f) => `${f.path}:${f.line ?? ""} ${f.message}`)
              .join(" | ")
              .slice(0, 600)}`,
          },
          note: "Repair budget exhausted.",
        };
      return {
        status: "repairing",
        patch: {
          test_results: { ...task.test_results, ci: history },
          stage_state: { failures: failures.slice(0, 20) },
        },
        note: `CI failed (${failures.length} annotation(s)); starting bounded repair ${repairs + 1}/${maxRepairs}.`,
      };
    }
    // CI passed: open/update the PR and record the candidate upgrade.
    const pr = await gh.ensurePr(
      task.branch_name!,
      `JARVIS: ${task.title}`,
      [
        `**Objective:** ${task.task_spec?.objective ?? task.objective ?? task.title}`,
        "",
        `**Change:** ${task.stage_state?.plan_summary ?? ""}`,
        `**Files:** ${(task.stage_state?.files_changed ?? []).join(", ")}`,
        `**Verification:** isolated \`jarvis-candidate\` CI passed on \`${sha.slice(0, 7)}\` (${ci.url ?? ""}).`,
        `**Repairs:** ${task.stage_state?.repairs ?? 0}`,
        `**Task:** \`${task.id}\` (source: ${task.source_type})`,
      ].join("\n"),
    );
    await this.d.store.recordCandidate({
      user_id: task.user_id,
      release_name: `Candidate: ${task.title}`.slice(0, 200),
      production_commit_sha: sha,
      source_branch: task.branch_name,
      source_pr_url: pr.url,
      summary:
        `Candidate upgrade prepared by JARVIS (not deployed). ${task.stage_state?.plan_summary ?? ""}`.slice(
          0,
          1000,
        ),
      capabilities_changed: [task.title],
      tests_run: {
        jarvis_candidate_ci: "pass",
        ci_url: ci.url,
        repairs: task.stage_state?.repairs ?? 0,
      },
      deployment_verified: false,
      produced_by: "JARVIS Engineer worker",
      metadata: { kind: "candidate", task_id: task.id, fixture: task.is_fixture },
    });
    return {
      status: "ready_for_release",
      patch: {
        pr_url: pr.url,
        commit_sha: sha,
        test_results: { ...task.test_results, ci: history },
        result_summary: `Candidate ready: PR #${pr.number} (${pr.created ? "opened" : "updated"}), isolated CI passed on ${sha.slice(0, 7)} after ${task.stage_state?.repairs ?? 0} repair(s). Awaiting Adam's release review.`,
      },
      note: `CI passed; PR #${pr.number}.`,
    };
  }

  private async repair(task: TaskRow): Promise<StepResult> {
    const gh = this.d.github!;
    if (!this.d.planner)
      return {
        status: "blocked",
        patch: { blocker: "Repair needs the code planner (OPENAI_API_KEY missing on the worker)." },
        note: "No planner.",
      };
    const failures: Annotation[] = task.stage_state?.failures ?? [];
    const branch = task.branch_name!;
    const nextRepair = Number(task.stage_state?.repairs ?? 0) + 1;
    const existing = await this.alreadyCommitted(task, `repair-${nextRepair}`);
    if (existing)
      return {
        status: "testing",
        patch: {
          commit_sha: existing,
          stage_state: {
            repairs: nextRepair,
            ci_sha: existing,
            ci_started_at: this.now().toISOString(),
            recovered: true,
          },
        },
        wait: 60,
        note: `Recovered repair commit ${existing.slice(0, 7)} from a previous attempt.`,
      };
    const paths = [
      ...new Set([
        ...failures
          .map((f) => f.path)
          .filter((p) => p && EDITABLE_ROOTS.some((r) => p.startsWith(r))),
        ...(task.stage_state?.files_changed ?? []),
      ]),
    ].slice(0, 6);
    const current = await this.filesAt(branch, paths);
    const context = [...current.entries()]
      .filter(([, c]) => c !== null)
      .map(([path, content]) => ({ path, content: content as string }));
    const plan = await this.d.planner.repair({
      objective: String(task.task_spec?.objective ?? task.objective ?? task.title),
      failures,
      files: context,
    });
    const files = applyEdits(current, plan.edits);
    const repairs = Number(task.stage_state?.repairs ?? 0) + 1;
    const commit = await gh.commitFiles(
      branch,
      files,
      `JARVIS repair ${repairs}: ${task.title}`.slice(0, 120),
      marker(task, `repair-${repairs}`),
    );
    return {
      status: "testing",
      patch: {
        commit_sha: commit.sha,
        stage_state: {
          repairs,
          ci_sha: commit.sha,
          ci_started_at: this.now().toISOString(),
          last_repair: plan.summary,
          files_changed: [
            ...new Set([...(task.stage_state?.files_changed ?? []), ...files.map((f) => f.path)]),
          ],
        },
      },
      wait: 60,
      note: `Repair ${repairs} committed as ${commit.sha.slice(0, 7)}; re-running isolated CI.`,
    };
  }

  // ---------------------------------------------------------------- radar

  async runRadar(owner: string) {
    const last = await this.d.store.lastEventAt(owner, "jarvis_radar");
    if (!this.d.forceRadar && last && this.now().getTime() - Date.parse(last) < 30 * 60_000) return;
    const since = new Date(this.now().getTime() - 14 * 86_400_000).toISOString();
    const inputs = await this.d.store.radarInputs(owner, since);
    const opportunities = buildOpportunities(inputs);
    const recent = await this.d.store.tasks({
      userId: owner,
      sinceIso: new Date(this.now().getTime() - 7 * 86_400_000).toISOString(),
    });
    const created: string[] = [];
    const skipped: string[] = [];
    for (const opp of opportunities.slice(0, 5)) {
      if (recent.some((t) => t.dedupe_key === opp.dedupe_key)) {
        skipped.push(opp.dedupe_key);
        continue;
      }
      const inserted = await this.d.store.insertTask({
        user_id: owner,
        source_type: opp.signal === "self_weakness" ? "jarvis_self_research" : "opportunity_radar",
        source_ref: opp.dedupe_key,
        title: opp.title,
        objective: opp.objective,
        why_it_matters: `Radar score ${opp.score}: ${opp.occurrences} occurrence(s) of ${opp.signal}, severity ${opp.severity}, confidence ${opp.confidence}.`,
        priority: opp.score >= 12 ? 1 : opp.score >= 9 ? 2 : 3,
        status: "queued",
        dedupe_key: opp.dedupe_key,
        task_spec:
          opp.kind === "code_change"
            ? { kind: "code_change", objective: opp.objective, target_paths: opp.target_paths }
            : {
                kind: "diagnostic",
                checks: [
                  { type: "radar_dry_run" },
                  { type: "db_count", table: "emery_runtime_events", days: 14 },
                ],
              },
        metadata: {
          radar: {
            signal: opp.signal,
            score: opp.score,
            occurrences: opp.occurrences,
            feasibility: opp.feasibility,
            risk: opp.risk,
            evidence: opp.evidence,
          },
        },
        is_fixture: opp.fixture,
        // Radar discoveries are PROPOSALS unless they are fixtures (validation) or
        // high-confidence read-only diagnostics that safe-autonomy policy already
        // allows to run. Low-confidence findings never consume production slots.
        approval_state:
          opp.fixture || (opp.kind !== "code_change" && opp.confidence >= RADAR_AUTO_CONFIDENCE)
            ? "approved"
            : "proposed",
        approved_at:
          opp.fixture || (opp.kind !== "code_change" && opp.confidence >= RADAR_AUTO_CONFIDENCE)
            ? this.now().toISOString()
            : null,
      } as Partial<TaskRow>);
      if ("id" in inserted) created.push(inserted.id);
      else skipped.push(opp.dedupe_key);
    }
    this.report.radar = {
      opportunities: opportunities.length,
      created: created.length,
      skipped: skipped.length,
    };
    await this.d.store.logEvent(owner, {
      event_type: "jarvis_radar",
      action: "radar",
      status: "ok",
      metadata: {
        opportunities: opportunities.length,
        created,
        skipped,
        top: opportunities.slice(0, 5).map((o) => ({ key: o.dedupe_key, score: o.score })),
      },
    });
  }

  // ------------------------------------------------------------- sessions

  async finalizeSessions(owner: string) {
    for (const session of await this.d.store.runningSessions(owner)) {
      const tasks = await this.d.store.tasks({ userId: owner, sessionId: session.id });
      if (!tasks.length) continue;
      if (tasks.some((t) => (RUNNABLE as readonly string[]).includes(t.status))) continue;
      const count = (s: string) => tasks.filter((t) => t.status === s).length;
      const completed = count("completed");
      const ready = count("ready_for_release");
      const blocked = count("blocked");
      const failed = count("failed");
      const merged = tasks.filter((t) => t.merged_into).length;
      const repairs = tasks.reduce((n, t) => n + Number(t.stage_state?.repairs ?? 0), 0);
      const repaired = tasks.filter(
        (t) => Number(t.stage_state?.repairs ?? 0) > 0 && t.status === "ready_for_release",
      ).length;
      const metrics = {
        accepted: tasks.length,
        fixture_tasks: tasks.filter((t) => t.is_fixture).length,
        completed,
        ready_for_release: ready,
        blocked,
        failed,
        merged_duplicates: merged,
        repairs,
        repair_success: repairs
          ? repaired / tasks.filter((t) => Number(t.stage_state?.repairs ?? 0) > 0).length
          : null,
        completion_rate: (completed + ready) / Math.max(1, tasks.length - merged),
        failure_rate: failed / Math.max(1, tasks.length - merged),
      };
      const research = await this.selfResearch(owner, session, metrics);
      const approvalRequired =
        tasks.some((t) => t.status === "blocked" && /approval/i.test(t.blocker ?? "")) || ready > 0;
      // Capacity evidence counts real work only: fixtures prove mechanics, not throughput.
      const real = tasks.filter((t) => !t.is_fixture && !t.merged_into);
      const realDone = real.filter((t) => ["completed", "ready_for_release"].includes(t.status));
      const realFailed = real.filter((t) => t.status === "failed");
      const capacity = {
        current: DAILY_CAPACITY,
        recommended: DAILY_CAPACITY,
        real_tasks: real.length,
        eligible_for_increase:
          real.length >= 40 &&
          realDone.length / real.length >= 0.9 &&
          realFailed.length / real.length <= 0.05,
        note: "Capacity changes require measured stability across sessions AND a worker throughput improvement; a number change alone is not an upgrade.",
      };
      const ok = await this.d.store.updateSession(
        session.id,
        {
          status: blocked || failed ? "completed_with_blockers" : "completed",
          // Production intake only: validation fixtures are evidence, not capacity.
          accepted_count: tasks.filter(countsTowardCapacity).length,
          completed_count: completed,
          ready_for_release_count: ready,
          blocked_count: blocked,
          failed_count: failed,
          approval_required: approvalRequired,
          completed_at: this.now().toISOString(),
          summary: `Worker session: ${completed} completed, ${ready} ready for release, ${blocked} blocked, ${failed} failed, ${merged} duplicates merged. Ready for more tasks.`,
          self_research_summary: research.summary,
          self_research_classification: research.classification,
          metadata: {
            ...session.metadata,
            metrics,
            capacity_review: capacity,
            ready_for_more_tasks: true,
          },
        },
        "running",
      );
      if (ok) this.report.finalized.push(session.id);
    }
  }

  private async selfResearch(owner: string, session: SessionRow, metrics: Record<string, any>) {
    let topic =
      "durable task-queue throughput for an LLM coding worker on Postgres (leases, SKIP LOCKED, visibility timeouts)";
    let classification: "ignore" | "watch" | "test" | "adopt" | "engineering_task" = "watch";
    if (metrics.repairs > 0 && (metrics.repair_success ?? 1) < 1) {
      topic = "improving automated repair of TypeScript CI failures from compiler diagnostics";
      classification = "engineering_task";
    } else if (metrics.failure_rate > 0.1) {
      topic = "reducing failure rate of autonomous code-change tasks via better context selection";
      classification = "test";
    } else if (metrics.repairs > 0) {
      topic = "selecting the minimal test set for a code change to shorten CI feedback";
      classification = "watch";
    }
    let answer = "";
    let sources: string[] = [];
    if (this.d.planner && this.timeLeft() > 25_000) {
      try {
        const r = await Promise.race([
          this.d.planner.research(
            `For JARVIS (an autonomous engineering worker for a TypeScript/Supabase app): ${topic}. What is the single most evidence-backed improvement?`,
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("research timeout")), 20_000),
          ),
        ]);
        answer = r.answer;
        sources = r.sources;
      } catch (error: any) {
        answer = `Web research unavailable this session (${String(error?.message ?? error).slice(0, 80)}); finding is based on session metrics only.`;
      }
    } else answer = "Finding based on session metrics only (no research budget/planner).";
    const summary = `Self-research (${classification}): ${topic}. Metrics: completion ${(metrics.completion_rate * 100).toFixed(0)}%, failure ${(metrics.failure_rate * 100).toFixed(0)}%, repairs ${metrics.repairs}. ${answer.slice(0, 400)}`;
    await this.d.store.insertFinding({
      user_id: owner,
      session_id: session.id,
      topic: `JARVIS self-improvement: ${topic}`.slice(0, 200),
      finding: answer.slice(0, 3000) || summary,
      source_url: sources[0] ?? null,
      source_type: sources.length ? "web" : "session_metrics",
      recommendation:
        classification === "engineering_task"
          ? "Queue an engineering task to improve the repair strategy using the recorded failure annotations."
          : "Keep measuring; act only with evidence.",
      classification,
      metadata: { kind: "jarvis_self_improvement", metrics, sources },
    });
    return { summary: summary.slice(0, 1500), classification };
  }
}
