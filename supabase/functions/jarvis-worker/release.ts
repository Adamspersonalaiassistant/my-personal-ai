// JARVIS release operator. The ONLY code path that can merge to main.
//
// The model never receives a merge tool. Adam's "Approve it" (or the low-risk
// auto policy) only records intent; this operator, running inside the durable
// worker, re-verifies everything at merge time and then carries the release
// through deployment, production verification, the release ledger and one
// notification. State lives in jarvis_engineering_tasks.metadata.release, so a
// release survives worker restarts and is never performed twice.
//
// Per candidate (ready_for_release, real, approved task with a PR):
//   evaluate: PR open · jarvis/* head · base main · head == CI-verified sha ·
//             CI green · up to date with main · release gate · daily limit ·
//             production reachable · (auto) or (Adam approval bound to PR+sha+
//             production base, unexpired)
//   merge:    pinned head sha, merge commit, one-shot gateway authorization
//   deploy:   edge functions via the GitHub Actions deploy workflow; frontend
//             via Lovable publish (API when configured, otherwise Adam taps
//             Publish once and JARVIS detects it)
//   verify:   served production commit contains the merge · ledger · notify ·
//             15-minute regression watch · rollback candidate on failure

import type { GithubOps } from "./github-ops.ts";
import { ReleaseGithub, type PullRequest } from "./github-ops.ts";
import {
  AUTO_RELEASE_LIMITS,
  deploymentNeeds,
  describeDecision,
  evaluateReleaseGate,
  type ReleaseDecision,
} from "./release-gate.ts";
import type { TaskRow } from "./engine.ts";

export const DEPLOY_WORKFLOW = "deploy-jarvis-functions.yml";
export const APPROVAL_TTL_MS = 60 * 60_000;
const DEPLOY_TIMEOUT_MS = 30 * 60_000;
const PUBLISH_REMINDER_MS = 24 * 60 * 60_000;
const WATCH_MS = 15 * 60_000;

export type ReleaseState =
  | "awaiting_approval"
  | "ci_not_green"
  | "head_changed"
  | "refreshing"
  | "blocked"
  | "manual_only"
  | "closed"
  | "daily_limit"
  | "production_unreachable"
  | "merging"
  | "merged"
  | "awaiting_deploy"
  | "awaiting_publish"
  | "publishing"
  | "verified"
  | "stable"
  | "released_no_deploy"
  | "deployment_failed"
  | "regression_detected"
  | "merge_failed";

/** States after which nothing will ever be merged again for this candidate. */
export const POST_MERGE: ReleaseState[] = [
  "merged",
  "awaiting_deploy",
  "awaiting_publish",
  "publishing",
  "verified",
  "stable",
  "released_no_deploy",
  "deployment_failed",
  "regression_detected",
];
const TERMINAL: ReleaseState[] = [
  "stable",
  "released_no_deploy",
  "deployment_failed",
  "regression_detected",
  "blocked",
  "manual_only",
  "closed",
];

export type ReleaseApproval = {
  pr: number;
  head_sha: string;
  task_id: string;
  production_base: string;
  approved_at: string;
  expires_at: string;
  source_ref?: string | null;
};

export type ReleaseRecord = {
  state: ReleaseState;
  at: string;
  mode?: "auto_low_risk" | "adam_approved";
  pr?: number;
  head_sha?: string;
  merge_sha?: string;
  merged_at?: string;
  production_base?: string | null;
  decision?: string;
  reasons?: string[];
  files?: string[];
  needs?: { functions: string[]; frontend: boolean };
  backend_ok?: boolean;
  deployment_id?: string | null;
  verified_at?: string;
  served_commit?: string | null;
  release_id?: string | null;
  errors_before?: number;
  refreshed_from?: string;
  approval_invalid?: string;
  rollback_pr?: string | null;
  note?: string;
};

export interface ReleaseStore {
  releaseCandidates(userId: string): Promise<TaskRow[]>;
  /** Compare-and-set on metadata.release.state (null = no release yet). Returns false if someone else moved it. */
  casRelease(
    task: TaskRow,
    from: ReleaseState | null,
    release: ReleaseRecord,
    extra?: Partial<TaskRow>,
  ): Promise<boolean>;
  autoReleasesSince(userId: string, sinceIso: string): Promise<number>;
  recordRelease(row: Record<string, unknown>): Promise<string | null>;
  notify(
    userId: string,
    note: { title: string; body: string; ref: string; metadata?: Record<string, unknown> },
  ): Promise<void>;
  runtimeErrors(userId: string, fromIso: string, toIso: string): Promise<number>;
  insertTask(row: Partial<TaskRow>): Promise<{ id: string } | { duplicate: true }>;
}

export type Publisher = {
  publish(): Promise<{ id: string }>;
  status(id: string): Promise<{ status: string; error?: string | null }>;
};

export type ReleaseDeps = {
  store: ReleaseStore;
  github: GithubOps;
  /** Commit the live production site reports (emery-commit meta), or null if unreachable. */
  servedCommit: () => Promise<string | null>;
  publisher: Publisher | null;
  now: () => Date;
  enabled?: boolean;
};

export function prNumberFromUrl(url: string | null | undefined) {
  const m = /\/pull\/(\d+)/.exec(String(url ?? ""));
  return m ? Number(m[1]) : null;
}

/** Approval is bound to the exact PR, head sha, task and production base, and expires. */
export function approvalProblem(
  approval: ReleaseApproval | null | undefined,
  ctx: { pr: number; headSha: string; taskId: string; production: string | null; now: Date },
): string | null {
  if (!approval) return "no approval";
  if (approval.pr !== ctx.pr) return "approval is for a different PR";
  if (approval.task_id !== ctx.taskId) return "approval is for a different candidate";
  if (approval.head_sha !== ctx.headSha)
    return "the PR changed after approval (approval covers only the approved commit)";
  if (Date.parse(approval.expires_at) <= ctx.now.getTime()) return "approval expired";
  if (!ctx.production || approval.production_base !== ctx.production)
    return "production changed since approval";
  return null;
}

function easternDay(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export class ReleaseOperator {
  private readonly gh: ReleaseGithub;
  report = { evaluated: 0, merged: 0, verified: 0, failed: 0, notes: [] as string[] };

  constructor(private readonly d: ReleaseDeps) {
    this.gh = new ReleaseGithub(d.github);
  }

  private nowIso() {
    return this.d.now().toISOString();
  }

  async run(owner: string) {
    if (this.d.enabled === false) return this.report;
    const candidates = await this.d.store.releaseCandidates(owner);
    let mergedThisTick = false;
    for (const task of candidates.slice(0, 6)) {
      const current = (task.metadata?.release ?? null) as ReleaseRecord | null;
      if (current && TERMINAL.includes(current.state)) continue;
      this.report.evaluated += 1;
      try {
        if (current && POST_MERGE.includes(current.state)) await this.advance(task, current);
        else if (!mergedThisTick) mergedThisTick = await this.evaluate(task, current);
      } catch (error: any) {
        this.report.notes.push(
          `${task.id.slice(0, 8)}: ${String(error?.message ?? error).slice(0, 200)}`,
        );
      }
    }
    return this.report;
  }

  // -------------------------------------------------------------- pre-merge

  private async settle(task: TaskRow, current: ReleaseRecord | null, next: ReleaseRecord) {
    // Re-evaluation states are rewritten only when something changed.
    if (current && current.state === next.state && current.head_sha === next.head_sha) return false;
    return this.d.store.casRelease(task, current?.state ?? null, next);
  }

  /** Returns true when a merge happened this tick. */
  private async evaluate(task: TaskRow, current: ReleaseRecord | null): Promise<boolean> {
    const n = prNumberFromUrl(task.pr_url);
    if (!n) return false;
    const pr = await this.gh.pr(n);
    const base: ReleaseRecord = {
      state: "awaiting_approval",
      at: this.nowIso(),
      pr: n,
      head_sha: pr.headSha,
    };

    if (pr.merged) {
      // Merged outside the operator (e.g. by Adam on GitHub): adopt it and verify; never merge again.
      const adopted: ReleaseRecord = {
        ...base,
        state: "merged",
        merge_sha: pr.mergeCommitSha ?? undefined,
        merged_at: this.nowIso(),
        note: "Merged outside JARVIS; verifying.",
      };
      const files = await this.gh.files(n);
      adopted.files = files.map((f) => f.filename);
      adopted.needs = deploymentNeeds(files);
      await this.d.store.casRelease(task, current?.state ?? null, adopted);
      return false;
    }
    if (pr.state !== "open") {
      await this.settle(task, current, {
        ...base,
        state: "closed",
        note: "PR closed without merge.",
      });
      return false;
    }
    if (!pr.headRef.startsWith("jarvis/") || pr.baseRef !== "main") {
      await this.settle(task, current, {
        ...base,
        state: "blocked",
        note: "Only jarvis/* candidates targeting main can be released.",
      });
      return false;
    }
    // The head must be the commit JARVIS's CI verified (or JARVIS's own refresh of it).
    if (pr.headSha !== task.commit_sha) {
      if (current?.state === "refreshing" && current.refreshed_from === task.commit_sha) {
        await this.d.store.casRelease(
          task,
          "refreshing",
          { ...base, state: "ci_not_green", note: "Refreshed with main; waiting for CI." },
          { commit_sha: pr.headSha },
        );
        return false;
      }
      await this.settle(task, current, {
        ...base,
        state: "head_changed",
        note: "The PR head is not the commit JARVIS tested. It needs a new candidate run.",
      });
      return false;
    }
    const ci = await this.d.github.ci(pr.headSha);
    if (ci.state !== "success") {
      await this.settle(task, current, { ...base, state: "ci_not_green", note: `CI ${ci.state}.` });
      return false;
    }
    if ((await this.gh.behindMain(pr.headSha)) > 0) {
      // Never merge a candidate that was not tested against current main: refresh, re-test, re-decide.
      await this.gh.updateBranch(n, pr.headSha);
      await this.d.store.casRelease(task, current?.state ?? null, {
        ...base,
        state: "refreshing",
        refreshed_from: pr.headSha,
        note: "Main moved; candidate refreshed and re-testing. Any approval must be given again.",
      });
      return false;
    }
    const files = await this.gh.files(n);
    const decision: ReleaseDecision = evaluateReleaseGate(files);
    const described = describeDecision(decision);
    const withDecision: ReleaseRecord = {
      ...base,
      decision: described,
      reasons: decision.reasons.slice(0, 6),
      files: files.map((f) => f.filename),
      needs: deploymentNeeds(files),
    };
    if (decision.manualOnly) {
      await this.settle(task, current, { ...withDecision, state: "manual_only" });
      await this.notifyOnce(task, "manual_only", pr.headSha, {
        title: `PR #${n} needs a manual release`,
        body: `${task.title}: ${described} JARVIS will not merge it.`,
      });
      return false;
    }
    if (!decision.mergeable) {
      await this.settle(task, current, { ...withDecision, state: "blocked" });
      return false;
    }
    const production = await this.d.servedCommit();
    if (!production) {
      await this.settle(task, current, {
        ...withDecision,
        state: "production_unreachable",
        note: "Production site did not report its commit; not releasing blind.",
      });
      return false;
    }

    let mode: ReleaseRecord["mode"];
    const requiresAdam = task.metadata?.release_policy === "requires_adam";
    if (decision.auto && !requiresAdam) {
      const since = new Date(this.d.now().getTime() - 24 * 60 * 60_000).toISOString();
      const used = await this.d.store.autoReleasesSince(task.user_id, since);
      if (used >= AUTO_RELEASE_LIMITS.maxAutoReleasesPerDay) {
        await this.settle(task, current, { ...withDecision, state: "daily_limit" });
        return false;
      }
      mode = "auto_low_risk";
    } else {
      const problem = approvalProblem(
        task.metadata?.release_approval as ReleaseApproval | undefined,
        {
          pr: n,
          headSha: pr.headSha,
          taskId: task.id,
          production,
          now: this.d.now(),
        },
      );
      if (problem) {
        const hadApproval = Boolean(task.metadata?.release_approval);
        await this.settle(task, current, {
          ...withDecision,
          state: "awaiting_approval",
          production_base: production,
          ...(hadApproval ? { approval_invalid: problem } : {}),
        });
        await this.notifyOnce(task, "awaiting_approval", pr.headSha, {
          title: `Ready for release: PR #${n}`,
          body: `${task.title}. CI green · ${files.length} file(s). ${described}${hadApproval ? ` (Previous approval no longer valid: ${problem}.)` : ""} Reply "Approve it" in JARVIS.`,
        });
        return false;
      }
      mode = "adam_approved";
    }

    // Claim the merge (compare-and-set): a concurrent tick can never merge twice.
    const claimed = await this.d.store.casRelease(task, current?.state ?? null, {
      ...withDecision,
      state: "merging",
      mode,
      production_base: production,
    });
    if (!claimed) return false;
    try {
      if (pr.draft) await this.gh.markReady(pr);
      const merged = await this.gh.merge(pr, `Release PR #${n}: ${task.title}`);
      if (!merged.merged || !merged.sha) throw new Error("GitHub did not confirm the merge.");
      await this.d.store.casRelease(task, "merging", {
        ...withDecision,
        state: "merged",
        mode,
        production_base: production,
        merge_sha: merged.sha,
        merged_at: this.nowIso(),
      });
      this.report.merged += 1;
      return true;
    } catch (error: any) {
      // A second attempt after a crash: adopt an existing merge instead of failing.
      const again = await this.gh.pr(n).catch(() => null);
      if (again?.merged && again.mergeCommitSha) {
        await this.d.store.casRelease(task, "merging", {
          ...withDecision,
          state: "merged",
          mode,
          production_base: production,
          merge_sha: again.mergeCommitSha,
          merged_at: this.nowIso(),
        });
        return true;
      }
      await this.d.store.casRelease(task, "merging", {
        ...withDecision,
        state: "merge_failed",
        mode,
        note: String(error?.message ?? error).slice(0, 300),
      });
      return false;
    }
  }

  // ------------------------------------------------------------- post-merge

  private async advance(task: TaskRow, rel: ReleaseRecord) {
    const now = this.d.now();
    const needs = rel.needs ?? { functions: [], frontend: true };
    const sinceMerge = now.getTime() - Date.parse(rel.merged_at ?? rel.at);

    if (rel.state === "merged" || rel.state === "awaiting_deploy") {
      if (needs.functions.length && !rel.backend_ok) {
        const run = rel.merge_sha
          ? await this.gh.workflowRun(rel.merge_sha, DEPLOY_WORKFLOW)
          : null;
        if (run?.status === "completed" && run.conclusion === "success") {
          rel = { ...rel, backend_ok: true };
        } else if (
          (run?.status === "completed" && run.conclusion !== "success") ||
          sinceMerge > DEPLOY_TIMEOUT_MS
        ) {
          return this.fail(
            task,
            rel,
            run
              ? `Edge function deploy workflow ${run.conclusion} (${run.url}).`
              : "The edge function deploy workflow did not run (is SUPABASE_ACCESS_TOKEN set in GitHub Actions secrets?).",
          );
        } else {
          if (rel.state !== "awaiting_deploy")
            await this.d.store.casRelease(task, rel.state, {
              ...rel,
              state: "awaiting_deploy",
              at: this.nowIso(),
            });
          return;
        }
      }
      if (!needs.frontend) {
        if (needs.functions.length) return this.verified(task, rel, null);
        await this.d.store.casRelease(
          task,
          rel.state,
          { ...rel, state: "released_no_deploy", at: this.nowIso() },
          {
            status: "completed",
            result_summary: `Released PR #${rel.pr} to main (${(rel.merge_sha ?? "").slice(0, 7)}); no deployment needed.`,
          },
        );
        await this.notifyOnce(task, "released", rel.merge_sha ?? "", {
          title: `Released PR #${rel.pr}`,
          body: `${task.title} — merged (${(rel.merge_sha ?? "").slice(0, 7)}). Documentation/validation only; production unchanged.`,
        });
        return;
      }
      // Frontend: published through Lovable.
      if (this.d.publisher) {
        const job = await this.d.publisher.publish();
        await this.d.store.casRelease(task, rel.state, {
          ...rel,
          state: "publishing",
          deployment_id: job.id,
          at: this.nowIso(),
        });
        return;
      }
      await this.d.store.casRelease(task, rel.state, {
        ...rel,
        state: "awaiting_publish",
        at: this.nowIso(),
      });
      await this.notifyOnce(task, "awaiting_publish", rel.merge_sha ?? "", {
        title: `PR #${rel.pr} merged — tap Publish`,
        body: `${task.title} is merged and verified on main. One step left: open Lovable and tap Publish. JARVIS will verify production and finish the release.`,
      });
      return;
    }

    if (rel.state === "publishing" && this.d.publisher && rel.deployment_id) {
      const st = await this.d.publisher.status(rel.deployment_id);
      if (st.status === "error")
        return this.fail(task, rel, `Lovable publish failed: ${st.error ?? "unknown"}`);
      if (st.status !== "completed") return;
      // fall through to production verification
    }

    if (rel.state === "publishing" || rel.state === "awaiting_publish") {
      const served = await this.d.servedCommit();
      if (served && rel.merge_sha && (await this.contains(served, rel.merge_sha)))
        return this.verified(task, rel, served);
      if (rel.state === "publishing" && sinceMerge > DEPLOY_TIMEOUT_MS)
        return this.fail(
          task,
          rel,
          `Published, but production still serves ${served ?? "unknown"}.`,
        );
      if (rel.state === "awaiting_publish" && sinceMerge > PUBLISH_REMINDER_MS)
        await this.notifyOnce(task, "publish_reminder", rel.merge_sha ?? "", {
          title: `Still waiting to publish PR #${rel.pr}`,
          body: "Tap Publish in Lovable when ready; JARVIS verifies and records it automatically.",
        });
      return;
    }

    if (rel.state === "verified") {
      if (now.getTime() - Date.parse(rel.verified_at ?? rel.at) < WATCH_MS) return;
      const after = await this.d.store.runtimeErrors(
        task.user_id,
        rel.verified_at ?? rel.at,
        this.nowIso(),
      );
      const before = rel.errors_before ?? 0;
      if (after >= 5 && after > before * 3) {
        const rollback = await this.prepareRollback(task, rel).catch(() => null);
        await this.d.store.casRelease(task, "verified", {
          ...rel,
          state: "regression_detected",
          rollback_pr: rollback,
          note: `${after} runtime errors in the 15 minutes after release (before: ${before}).`,
        });
        await this.notifyOnce(task, "regression", rel.merge_sha ?? "", {
          title: `Possible regression after PR #${rel.pr}`,
          body: `${after} runtime errors since release (before: ${before}). ${rollback ? `Rollback candidate ready: ${rollback}. Reply "Approve it" to roll back.` : "Rollback candidate could not be prepared; investigate."}`,
        });
        return;
      }
      await this.d.store.casRelease(
        task,
        "verified",
        { ...rel, state: "stable", at: this.nowIso() },
        { status: "completed" },
      );
    }
  }

  /** Does `served` include `merge`? (identical, or merge is an ancestor of served) */
  private async contains(served: string, merge: string) {
    if (served === merge) return true;
    try {
      const d = await this.d.github.rawJson(
        "GET",
        `/repos/Adamspersonalaiassistant/my-personal-ai/compare/${merge}...${served}`,
      );
      return ["identical", "ahead"].includes(String(d?.status));
    } catch {
      return false;
    }
  }

  private async verified(task: TaskRow, rel: ReleaseRecord, served: string | null) {
    const at = this.nowIso();
    const before = await this.d.store
      .runtimeErrors(
        task.user_id,
        new Date(Date.parse(rel.merged_at ?? at) - WATCH_MS).toISOString(),
        rel.merged_at ?? at,
      )
      .catch(() => 0);
    const releaseId = await this.d.store.recordRelease({
      user_id: task.user_id,
      release_name: `JARVIS release: ${task.title}`.slice(0, 200),
      production_commit_sha: served ?? rel.merge_sha,
      previous_production_commit_sha: rel.production_base ?? null,
      source_branch: null,
      source_pr_url: task.pr_url,
      deployed_at: at,
      summary:
        `Released by the JARVIS release operator (${rel.mode === "auto_low_risk" ? "low-risk auto release" : "approved by Adam"}). ${rel.decision ?? ""}`.slice(
          0,
          1000,
        ),
      capabilities_changed: [task.title],
      tests_run: { jarvis_candidate_ci: "pass", gate: rel.decision ?? null },
      deployment_verified: true,
      produced_by: "JARVIS release operator",
      metadata: {
        kind: "jarvis_release",
        mode: rel.mode,
        pr: rel.pr,
        head_sha: rel.head_sha,
        merge_sha: rel.merge_sha,
        task_id: task.id,
        functions: rel.needs?.functions ?? [],
        frontend: rel.needs?.frontend ?? false,
      },
    });
    await this.d.store.casRelease(
      task,
      rel.state,
      {
        ...rel,
        state: "verified",
        verified_at: at,
        served_commit: served,
        release_id: releaseId,
        errors_before: before,
      },
      {
        result_summary: `Released PR #${rel.pr}; production verified at ${(served ?? rel.merge_sha ?? "").slice(0, 7)}.`,
      },
    );
    this.report.verified += 1;
    await this.notifyOnce(task, "verified", rel.merge_sha ?? "", {
      title: `Released and verified: PR #${rel.pr}`,
      body: `${task.title} is live${served ? ` (production ${served.slice(0, 7)})` : ""}. ${rel.mode === "auto_low_risk" ? "Low-risk auto release." : "Released on your approval."}`,
    });
  }

  private async fail(task: TaskRow, rel: ReleaseRecord, reason: string) {
    this.report.failed += 1;
    const rollback = await this.prepareRollback(task, rel).catch(() => null);
    await this.d.store.casRelease(
      task,
      rel.state,
      {
        ...rel,
        state: "deployment_failed",
        note: reason,
        rollback_pr: rollback,
        at: this.nowIso(),
      },
      { status: "failed", blocker: `Release deployment failed: ${reason}`.slice(0, 500) },
    );
    await this.notifyOnce(task, "deployment_failed", rel.merge_sha ?? "", {
      title: `Release of PR #${rel.pr} did not deploy`,
      body: `${reason} Production was not changed by this release. ${rollback ? `A rollback candidate is ready (${rollback}) so main matches production again; reply "Approve it" to apply it.` : "Next step: re-run the deploy."}`,
    });
  }

  /**
   * Rollback = a NEW candidate that restores the released files to their
   * pre-merge contents. History is never rewritten; the rollback goes through
   * CI and needs Adam's approval like any other non-trivial release.
   */
  private async prepareRollback(task: TaskRow, rel: ReleaseRecord): Promise<string | null> {
    if (!rel.merge_sha || !rel.files?.length) return null;
    const ops = this.d.github;
    const merge = await ops.commit(rel.merge_sha);
    const parent = merge.parents[0];
    if (!parent) return null;
    const mainHead = await ops.branchHead("main");
    if (!mainHead) return null;
    const branch = `jarvis/rollback-pr-${rel.pr}`;
    await ops.ensureBranch(branch, mainHead);
    const restored: Array<{ path: string; content: string | null }> = [];
    for (const path of rel.files.slice(0, 20))
      restored.push({ path, content: await ops.readFile(path, parent) });
    const commit = await ops.commitFiles(
      branch,
      restored,
      `Roll back PR #${rel.pr}: ${task.title}`.slice(0, 120),
      `[jarvis-rollback pr-${rel.pr}]`,
    );
    const pr = await ops.ensurePr(
      branch,
      `Roll back PR #${rel.pr}: ${task.title}`.slice(0, 200),
      `Restores ${restored.length} file(s) changed by PR #${rel.pr} to their pre-release contents (parent ${parent.slice(0, 7)}). History is not rewritten.\n\nReason: ${rel.note ?? "post-release failure"}`,
    );
    await this.d.store.insertTask({
      user_id: task.user_id,
      source_type: "regression",
      title: `Roll back PR #${rel.pr}`,
      objective: `Restore the files changed by PR #${rel.pr} to their pre-release contents.`,
      priority: 1,
      risk_level: "high",
      status: "testing",
      branch_name: branch,
      commit_sha: commit.sha,
      pr_url: null,
      is_fixture: false,
      approval_state: "approved",
      task_spec: { kind: "code_change", objective: `Roll back PR #${rel.pr}` },
      stage_state: {
        ci_sha: commit.sha,
        ci_started_at: this.nowIso(),
        plan_summary: `Rollback of PR #${rel.pr}`,
        files_changed: restored.map((f) => f.path),
      },
      metadata: { rollback_of: rel.pr, release_policy: "requires_adam" },
    } as Partial<TaskRow>);
    return pr.url;
  }

  private async notifyOnce(
    task: TaskRow,
    kind: string,
    sha: string,
    note: { title: string; body: string },
  ) {
    await this.d.store.notify(task.user_id, {
      ...note,
      ref: `${task.id}:${kind}:${sha.slice(0, 12)}`,
      metadata: { task_id: task.id, kind, pr: prNumberFromUrl(task.pr_url), sha },
    });
  }
}

/** Lovable publish API (Business plan and above). Used only when a key is configured. */
export function lovablePublisher(
  apiKey: string | null,
  projectId: string,
  fetcher: typeof fetch,
): Publisher | null {
  if (!apiKey) return null;
  const base = `https://api.lovable.dev/v1/projects/${projectId}/publish`;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  return {
    async publish() {
      const res = await fetcher(base, { method: "POST", headers, body: "{}" });
      if (!res.ok) throw new Error(`Lovable publish rejected (${res.status}).`);
      const body: any = await res.json();
      return { id: String(body.id) };
    },
    async status(id: string) {
      const res = await fetcher(`${base}/${id}`, { headers });
      if (!res.ok) return { status: "running" };
      const body: any = await res.json();
      return { status: String(body.status), error: body.error_message ?? null };
    },
  };
}

/** Commit the published site reports in <meta name="emery-commit">. */
export async function servedCommitFrom(url: string, fetcher: typeof fetch) {
  try {
    const res = await fetcher(url, { headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) return null;
    const html = await res.text();
    const commit = /<meta[^>]+name="emery-commit"[^>]+content="([0-9a-f]{7,40})"/i.exec(html)?.[1];
    return commit ?? null;
  } catch {
    return null;
  }
}

export { easternDay };
export type { PullRequest };
