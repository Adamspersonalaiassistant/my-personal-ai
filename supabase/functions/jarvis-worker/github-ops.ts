// Worker-side GitHub operations. Every call goes through handleGithubProxy (the
// same allowlist code as the jarvis-github gateway), so the worker inherits all
// protections: this repo only, jarvis/* writes only, fast-forward only, no
// merge/delete/force, no workflow/.env/credential edits, no RLS weakening.
// Pure module (no Deno APIs) — unit-tested in Node with a fake transport.

import { assertCandidateBranch, assertSafeContent, assertSafeRepoPath } from "./guards.ts";
import {
  handleGithubProxy,
  JARVIS_REPO,
  READY_FOR_REVIEW_MUTATION,
  type ProxyDeps,
} from "./proxy.ts";
import type { PrFile } from "./release-gate.ts";

const R = `/repos/${JARVIS_REPO}`;

export class GithubOpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type CiState = {
  state: "missing" | "pending" | "success" | "failure";
  checkRunId: number | null;
  url: string | null;
  conclusion: string | null;
  /** Failures carried by commit statuses (used when the Checks API is not readable). */
  failures?: Annotation[];
  source?: "checks" | "statuses";
};

export type Annotation = { path: string; line: number | null; title: string; message: string };

export class GithubOps {
  private readonly deps: ProxyDeps;
  readonly checkName: string;
  private checksReadable = true;

  constructor(deps: ProxyDeps, checkName = "jarvis-candidate") {
    this.deps = deps;
    this.checkName = checkName;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    accept?: "raw" | "json",
    releaseAuth?: ProxyDeps["releaseAuth"],
  ) {
    const out = await handleGithubProxy(
      { method, path, body, ...(accept ? { accept } : {}) },
      releaseAuth ? { ...this.deps, releaseAuth } : this.deps,
    );
    return out;
  }

  /** JSON call through the gateway; releaseAuth only ever comes from ReleaseGithub. */
  async rawJson(
    method: string,
    path: string,
    body?: unknown,
    releaseAuth?: ProxyDeps["releaseAuth"],
  ) {
    const out = await this.call(method, path, body, undefined, releaseAuth);
    if (out.status >= 400) {
      let message = out.body;
      try {
        message = JSON.parse(out.body)?.message ?? out.body;
      } catch {
        /* keep */
      }
      throw new GithubOpError(
        `${method} ${path.replace(R, "")} → ${out.status}: ${String(message).slice(0, 200)}`,
        out.status,
      );
    }
    return out.body ? JSON.parse(out.body) : null;
  }

  private async json(method: string, path: string, body?: unknown) {
    const out = await this.call(method, path, body);
    if (out.status >= 400) {
      let message = out.body;
      try {
        message = JSON.parse(out.body)?.message ?? out.body;
      } catch {
        /* keep */
      }
      throw new GithubOpError(
        `${method} ${path.replace(R, "")} → ${out.status}: ${String(message).slice(0, 200)}`,
        out.status,
      );
    }
    return out.body ? JSON.parse(out.body) : null;
  }

  async branchHead(branch: string): Promise<string | null> {
    const out = await this.call(
      "GET",
      `${R}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`,
    );
    if (out.status === 404) return null;
    if (out.status >= 400)
      throw new GithubOpError(`branch lookup failed (${out.status})`, out.status);
    return JSON.parse(out.body)?.object?.sha ?? null;
  }

  async commit(
    sha: string,
  ): Promise<{ sha: string; tree: string; message: string; parents: string[] }> {
    const data = await this.json("GET", `${R}/git/commits/${sha}`);
    return {
      sha: data.sha,
      tree: data.tree?.sha,
      message: String(data.message ?? ""),
      parents: ((data.parents ?? []) as any[]).map((p) => String(p?.sha ?? p)),
    };
  }

  /** Idempotent: an existing branch is reused. */
  async ensureBranch(branch: string, fromSha: string): Promise<{ created: boolean; head: string }> {
    assertCandidateBranch(branch);
    const existing = await this.branchHead(branch);
    if (existing) return { created: false, head: existing };
    const out = await this.call("POST", `${R}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: fromSha,
    });
    if (out.status === 422) {
      const head = await this.branchHead(branch);
      if (head) return { created: false, head };
    }
    if (out.status >= 400)
      throw new GithubOpError(
        `branch create failed (${out.status}): ${out.body.slice(0, 160)}`,
        out.status,
      );
    return { created: true, head: fromSha };
  }

  async readFile(path: string, ref: string): Promise<string | null> {
    const out = await this.call(
      "GET",
      `${R}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      undefined,
      "raw",
    );
    if (out.status === 404) return null;
    if (out.status >= 400)
      throw new GithubOpError(`read ${path} failed (${out.status})`, out.status);
    return out.body;
  }

  async listTree(ref: string): Promise<string[]> {
    const data = await this.json("GET", `${R}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return ((data?.tree ?? []) as any[])
      .filter((e) => e.type === "blob")
      .map((e) => String(e.path));
  }

  /**
   * Commit full-file writes on a jarvis/* branch, fast-forward only. `marker` is
   * embedded in the message; if the branch head already carries it (a previous
   * attempt committed but crashed before recording), that commit is reused, so
   * retries never create duplicate commits.
   */
  async commitFiles(
    branch: string,
    files: Array<{ path: string; content: string | null }>,
    message: string,
    marker: string,
  ) {
    assertCandidateBranch(branch);
    for (const file of files)
      if (file.content !== null) assertSafeContent(assertSafeRepoPath(file.path), file.content);
      else assertSafeRepoPath(file.path);
    const head = await this.branchHead(branch);
    if (!head) throw new GithubOpError(`branch ${branch} does not exist`, 404);
    const parent = await this.commit(head);
    if (parent.message.includes(marker)) return { sha: head, reused: true };
    const tree = await this.json("POST", `${R}/git/trees`, {
      base_tree: parent.tree,
      // content null deletes the file (used only by rollback candidates).
      tree: files.map((f) =>
        f.content === null
          ? { path: f.path, mode: "100644", type: "blob", sha: null }
          : { path: f.path, mode: "100644", type: "blob", content: f.content },
      ),
    });
    const commit = await this.json("POST", `${R}/git/commits`, {
      message: `${message}\n\n${marker}`,
      tree: tree.sha,
      parents: [head],
    });
    await this.json("PATCH", `${R}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
    return { sha: String(commit.sha), reused: false };
  }

  /**
   * CI result for a candidate commit. Prefers the Checks API; if the runtime
   * token cannot read checks (403), falls back to the commit statuses that the
   * workflow's code-free `report` job publishes.
   */
  async ci(sha: string): Promise<CiState> {
    if (this.checksReadable) {
      try {
        return await this.ciFromChecks(sha);
      } catch (error) {
        if (!(error instanceof GithubOpError) || error.status !== 403) throw error;
        this.checksReadable = false;
      }
    }
    return this.ciFromStatuses(sha);
  }

  private async ciFromChecks(sha: string): Promise<CiState> {
    const data = await this.json("GET", `${R}/commits/${sha}/check-runs?per_page=50`);
    const run = ((data?.check_runs ?? []) as any[]).find((r) => r.name === this.checkName);
    if (!run)
      return { state: "missing", checkRunId: null, url: null, conclusion: null, source: "checks" };
    if (run.status !== "completed")
      return {
        state: "pending",
        checkRunId: run.id,
        url: run.html_url,
        conclusion: null,
        source: "checks",
      };
    const ok = ["success", "neutral", "skipped"].includes(run.conclusion);
    return {
      state: ok ? "success" : "failure",
      checkRunId: run.id,
      url: run.html_url,
      conclusion: run.conclusion,
      source: "checks",
    };
  }

  private async ciFromStatuses(sha: string): Promise<CiState> {
    const data = await this.json("GET", `${R}/commits/${sha}/status`);
    const statuses = (data?.statuses ?? []) as any[];
    const overall = statuses.find((s) => s.context === this.checkName);
    const base = { checkRunId: null, source: "statuses" as const };
    if (!overall) return { ...base, state: "missing", url: null, conclusion: null };
    if (overall.state === "pending")
      return { ...base, state: "pending", url: overall.target_url ?? null, conclusion: null };
    if (overall.state === "success")
      return { ...base, state: "success", url: overall.target_url ?? null, conclusion: "success" };
    const failures = statuses
      .filter((s) => String(s.context).startsWith(`${this.checkName}/e`))
      .sort((a, b) => String(a.context).localeCompare(String(b.context)))
      .map((s) => parseStatusFailure(String(s.description ?? "")));
    return {
      ...base,
      state: "failure",
      url: overall.target_url ?? null,
      conclusion: overall.state,
      failures: failures.length
        ? failures
        : [
            {
              path: "",
              line: null,
              title: "jarvis-candidate",
              message: String(overall.description ?? ""),
            },
          ],
    };
  }

  async annotations(checkRunId: number): Promise<Annotation[]> {
    const data = await this.json("GET", `${R}/check-runs/${checkRunId}/annotations?per_page=50`);
    return ((data ?? []) as any[]).map((a) => ({
      path: String(a.path ?? ""),
      line: typeof a.start_line === "number" ? a.start_line : null,
      title: String(a.title ?? ""),
      message: String(a.message ?? "").slice(0, 2000),
    }));
  }

  async findOpenPr(branch: string): Promise<{ number: number; url: string } | null> {
    const owner = JARVIS_REPO.split("/")[0];
    const data = await this.json(
      "GET",
      `${R}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    const pr = (data ?? [])[0];
    return pr ? { number: pr.number, url: pr.html_url } : null;
  }

  /** Idempotent: returns the existing open PR for the branch if there is one. */
  async ensurePr(branch: string, title: string, body: string) {
    assertCandidateBranch(branch);
    const existing = await this.findOpenPr(branch);
    if (existing) return { ...existing, created: false };
    const pr = await this.json("POST", `${R}/pulls`, {
      head: branch,
      base: "main",
      title: title.slice(0, 240),
      body: `${body.slice(0, 60000)}\n\n---\n_Candidate prepared autonomously by JARVIS Engineer. Released only through JARVIS's gated release operator (auto for low-risk changes, otherwise after Adam's approval of this exact head)._`,
      draft: false,
    });
    return { number: Number(pr.number), url: String(pr.html_url), created: true };
  }
}

export type PullRequest = {
  number: number;
  nodeId: string;
  state: string;
  merged: boolean;
  mergeCommitSha: string | null;
  draft: boolean;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  url: string;
};

export class ReleaseGithub {
  private readonly ops: GithubOps;
  constructor(ops: GithubOps) {
    this.ops = ops;
  }

  async pr(number: number): Promise<PullRequest> {
    const d = await this.ops.rawJson("GET", `${R}/pulls/${Number(number)}`);
    return {
      number: Number(d.number),
      nodeId: String(d.node_id ?? ""),
      state: String(d.state),
      merged: Boolean(d.merged),
      mergeCommitSha: d.merge_commit_sha ?? null,
      draft: Boolean(d.draft),
      headRef: String(d.head?.ref ?? ""),
      headSha: String(d.head?.sha ?? ""),
      baseRef: String(d.base?.ref ?? ""),
      baseSha: String(d.base?.sha ?? ""),
      url: String(d.html_url ?? ""),
    };
  }

  async files(number: number): Promise<PrFile[]> {
    const d = await this.ops.rawJson("GET", `${R}/pulls/${Number(number)}/files?per_page=100`);
    return ((d ?? []) as any[]).map((f) => ({
      filename: String(f.filename),
      status: String(f.status),
      additions: Number(f.additions ?? 0),
      deletions: Number(f.deletions ?? 0),
      patch: typeof f.patch === "string" ? f.patch : null,
    }));
  }

  /** How many main commits the candidate is missing (0 = up to date). */
  async behindMain(headSha: string): Promise<number> {
    const d = await this.ops.rawJson("GET", `${R}/compare/main...${headSha}`);
    return Number(d?.behind_by ?? 0);
  }

  async updateBranch(number: number, expectedHeadSha: string) {
    await this.ops.rawJson("PUT", `${R}/pulls/${Number(number)}/update-branch`, {
      expected_head_sha: expectedHeadSha,
    });
  }

  async markReady(pr: PullRequest) {
    await this.ops.rawJson(
      "POST",
      "/graphql",
      { query: READY_FOR_REVIEW_MUTATION, variables: { id: pr.nodeId } },
      { pr: pr.number, sha: pr.headSha, nodeId: pr.nodeId },
    );
  }

  /** The one merge path: pinned head sha, merge commit, one-shot release authorization. */
  async merge(pr: PullRequest, title: string) {
    const d = await this.ops.rawJson(
      "PUT",
      `${R}/pulls/${pr.number}/merge`,
      { sha: pr.headSha, merge_method: "merge", commit_title: title.slice(0, 200) },
      { pr: pr.number, sha: pr.headSha },
    );
    return { merged: Boolean(d?.merged), sha: String(d?.sha ?? "") };
  }

  /** Latest GitHub Actions run of a workflow file for a commit. */
  async workflowRun(headSha: string, workflowFile: string) {
    const d = await this.ops.rawJson(
      "GET",
      `${R}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=20`,
    );
    const run = ((d?.workflow_runs ?? []) as any[]).find((r) =>
      String(r.path ?? "").endsWith(workflowFile),
    );
    return run
      ? {
          status: String(run.status),
          conclusion: run.conclusion ? String(run.conclusion) : null,
          url: String(run.html_url ?? ""),
        }
      : null;
  }
}

/** "src/x.ts:12 TS2322: message" → annotation; anything else keeps the text as the message. */
export function parseStatusFailure(description: string): Annotation {
  const match = /^(\S+?):(\d*) ([^:]*): ?(.*)$/.exec(description);
  if (match && match[1].includes("/"))
    return {
      path: match[1],
      line: match[2] ? Number(match[2]) : null,
      title: match[3],
      message: match[4],
    };
  const plain = /^([^:]*): ?(.*)$/.exec(description);
  return {
    path: "",
    line: null,
    title: plain?.[1] ?? "",
    message: plain?.[2] ?? description,
  };
}
