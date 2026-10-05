/* eslint-disable @typescript-eslint/no-explicit-any */
// JARVIS GitHub workshop. Server-side only: the token is read from the server
// environment at call time and never returned, logged or shown to the model.
//
// Protections (enforced here, not just in prompts):
// - writes only to jarvis/<slug> candidate branches; main and other branches are read-only
// - ref updates are fast-forward only (force=false); refs are never deleted
// - protected paths (.env, CI workflows, generated auth clients, key material) cannot be written
// - content containing credentials or RLS/grant weakening is refused
// - PRs can be opened/updated but never merged or closed

import {
  assertCandidateBranch,
  assertSafeContent,
  assertSafeRepoPath,
  PolicyError,
  redactSecrets,
} from "./policy.ts";

const API = "https://api.github.com";
const DEFAULT_REPO = "Adamspersonalaiassistant/my-personal-ai";
const MAX_FILE_CHARS = 60_000;

export type GithubEnv = { token: string | null; repo: string };

export function githubEnv(env: Record<string, string | undefined> = readProcessEnv()): GithubEnv {
  const token = env["JARVIS_GITHUB_TOKEN"] || env["GITHUB_TOKEN"] || null;
  const repo = env["JARVIS_GITHUB_REPO"] || DEFAULT_REPO;
  return { token, repo };
}

function readProcessEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

export class GithubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class GithubClient {
  private readonly env: GithubEnv;
  private readonly fetcher: typeof fetch;

  constructor(env: GithubEnv, fetcher: typeof fetch = fetch) {
    this.env = env;
    this.fetcher = fetcher;
  }

  get configuredForWrites() {
    return Boolean(this.env.token);
  }

  get repo() {
    return this.env.repo;
  }

  private headers(extra: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "emery-jarvis-engineer",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
    if (this.env.token) headers["Authorization"] = `Bearer ${this.env.token}`;
    return headers;
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      method,
      headers: this.headers(body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : null,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = text;
      try {
        message = JSON.parse(text)?.message ?? text;
      } catch {
        /* keep text */
      }
      throw new GithubError(
        redactSecrets(
          `GitHub ${method} ${path} → ${response.status}: ${String(message).slice(0, 240)}`,
        ),
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private requireWrite() {
    if (!this.env.token)
      throw new GithubError(
        "GitHub writes are not configured: add a JARVIS_GITHUB_TOKEN server secret (fine-grained, this repository only).",
        412,
      );
  }

  private r(path: string) {
    return `/repos/${this.env.repo}${path}`;
  }

  // ------------------------------------------------------------------ reads

  async inspectRepo() {
    const repo = await this.request("GET", this.r(""));
    const branch = repo.default_branch as string;
    const [head, pulls] = await Promise.all([
      this.request("GET", this.r(`/commits/${encodeURIComponent(branch)}`)),
      this.request("GET", this.r(`/pulls?state=open&per_page=10`)).catch(() => []),
    ]);
    return {
      repo: repo.full_name,
      visibility: repo.private ? "private" : "public",
      default_branch: branch,
      main_head: {
        sha: head.sha,
        message: String(head.commit?.message ?? "").split("\n")[0],
        date: head.commit?.committer?.date ?? null,
      },
      open_pull_requests: (pulls as any[]).map((pr) => ({
        number: pr.number,
        title: pr.title,
        head: pr.head?.ref,
        draft: pr.draft,
        url: pr.html_url,
      })),
      write_access_configured: this.configuredForWrites,
    };
  }

  async readFile(path: string, ref = "main", startLine?: number, endLine?: number) {
    const clean = String(path).replace(/^\/+/, "");
    const data = await this.request(
      "GET",
      this.r(`/contents/${encodePath(clean)}?ref=${encodeURIComponent(ref)}`),
    );
    if (Array.isArray(data)) {
      return {
        path: clean,
        ref,
        type: "dir",
        entries: data.map((e: any) => `${e.type === "dir" ? "📁 " : ""}${e.path}`).slice(0, 200),
      };
    }
    const content = decodeBase64(String(data.content ?? ""));
    let lines = content.split("\n");
    const from = startLine && startLine > 0 ? startLine : 1;
    const to = endLine && endLine >= from ? endLine : lines.length;
    lines = lines.slice(from - 1, to);
    let text = lines.join("\n");
    const truncated = text.length > MAX_FILE_CHARS;
    if (truncated) text = text.slice(0, MAX_FILE_CHARS);
    return {
      path: clean,
      ref,
      sha: data.sha,
      total_lines: content.split("\n").length,
      from_line: from,
      to_line: Math.min(to, from + lines.length - 1),
      truncated,
      content: redactSecrets(text),
    };
  }

  async searchCode(query: string, opts: { pathPrefix?: string; ref?: string } = {}) {
    const q = String(query ?? "").trim();
    if (q.length < 2) throw new GithubError("Search query is too short.", 400);
    if (this.env.token && (!opts.ref || opts.ref === "main")) {
      try {
        const search = await this.request(
          "GET",
          `/search/code?per_page=20&q=${encodeURIComponent(`${q} repo:${this.env.repo}${opts.pathPrefix ? ` path:${opts.pathPrefix}` : ""}`)}`,
        );
        return {
          method: "github_code_search",
          query: q,
          total: search.total_count,
          results: (search.items ?? []).map((item: any) => ({
            path: item.path,
            url: item.html_url,
          })),
        };
      } catch (error) {
        if (!(error instanceof GithubError)) throw error;
        // fall through to the tree scan
      }
    }
    return this.scanTree(q, opts);
  }

  /** Token-free fallback: list the tree once, then grep raw files (raw.githubusercontent is not API rate-limited). */
  private async scanTree(query: string, opts: { pathPrefix?: string; ref?: string }) {
    const ref = opts.ref || "main";
    const tree = await this.request(
      "GET",
      this.r(`/git/trees/${encodeURIComponent(ref)}?recursive=1`),
    );
    const prefix = (opts.pathPrefix ?? "").replace(/^\/+/, "");
    const candidates = (tree.tree as any[])
      .filter((entry) => entry.type === "blob" && entry.size < 400_000)
      .map((entry) => entry.path as string)
      .filter(
        (path) =>
          (!prefix || path.startsWith(prefix)) && /\.(ts|tsx|js|mjs|sql|md|json|css)$/.test(path),
      )
      .filter((path) => !/(^|\/)(routeTree\.gen\.ts|bun\.lock|package-lock\.json)$/.test(path));
    const needle = query.toLowerCase();
    const pathHits = candidates.filter((path) => path.toLowerCase().includes(needle));
    const ordered = [...pathHits, ...candidates.filter((path) => !pathHits.includes(path))].slice(
      0,
      160,
    );
    const results: Array<{ path: string; line: number; text: string }> = [];
    let filesRead = 0;
    const batches = chunk(ordered, 16);
    for (const batch of batches) {
      const texts = await Promise.all(
        batch.map(async (path) => {
          const response = await this.fetcher(
            `https://raw.githubusercontent.com/${this.env.repo}/${encodeURIComponent(ref)}/${encodePath(path)}`,
            {
              headers: this.env.token ? { Authorization: `Bearer ${this.env.token}` } : {},
            },
          ).catch(() => null);
          return response && response.ok ? ([path, await response.text()] as const) : null;
        }),
      );
      for (const entry of texts) {
        if (!entry) continue;
        filesRead += 1;
        const [path, text] = entry;
        text.split("\n").forEach((line, index) => {
          if (results.length < 40 && line.toLowerCase().includes(needle))
            results.push({ path, line: index + 1, text: redactSecrets(line.trim().slice(0, 200)) });
        });
      }
      if (results.length >= 40) break;
    }
    return {
      method: "tree_scan",
      query,
      ref,
      files_scanned: Math.min(ordered.length, batches.length * 16),
      files_read: filesRead,
      ...(filesRead === 0 && ordered.length
        ? {
            warning:
              "No file contents were readable (private repository without JARVIS_GITHUB_TOKEN?). Results are incomplete.",
          }
        : {}),
      files_in_scope: candidates.length,
      path_matches: pathHits.slice(0, 20),
      results,
    };
  }

  async inspectHistory(ref = "main", path?: string, limit = 10) {
    const perPage = Math.min(Math.max(Number(limit) || 10, 1), 30);
    const commits = await this.request(
      "GET",
      this.r(
        `/commits?sha=${encodeURIComponent(ref)}&per_page=${perPage}${path ? `&path=${encodeURIComponent(path)}` : ""}`,
      ),
    );
    return {
      ref,
      path: path ?? null,
      commits: (commits as any[]).map((c) => ({
        sha: c.sha,
        short: String(c.sha).slice(0, 7),
        date: c.commit?.committer?.date,
        author: c.commit?.author?.name,
        message: String(c.commit?.message ?? "").split("\n")[0],
      })),
    };
  }

  async compare(base: string, head: string) {
    const data = await this.request(
      "GET",
      this.r(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`),
    );
    return {
      base,
      head,
      status: data.status,
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      commits: (data.commits ?? []).slice(-20).map((c: any) => ({
        short: String(c.sha).slice(0, 7),
        message: String(c.commit?.message ?? "").split("\n")[0],
      })),
      files: (data.files ?? []).slice(0, 60).map((f: any) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    };
  }

  async inspectCi(ref = "main") {
    const [runs, status] = await Promise.all([
      this.request(
        "GET",
        this.r(`/commits/${encodeURIComponent(ref)}/check-runs?per_page=30`),
      ).catch((error) => ({ error: String(error.message) })),
      this.request("GET", this.r(`/commits/${encodeURIComponent(ref)}/status`)).catch((error) => ({
        error: String(error.message),
      })),
    ]);
    const checkRuns = Array.isArray((runs as any).check_runs) ? (runs as any).check_runs : [];
    const statuses = Array.isArray((status as any).statuses) ? (status as any).statuses : [];
    const failing = [
      ...checkRuns
        .filter(
          (r: any) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion),
        )
        .map((r: any) => r.name),
      ...statuses
        .filter((s: any) => ["failure", "error"].includes(s.state))
        .map((s: any) => s.context),
    ];
    return {
      ref,
      sha: (status as any).sha ?? null,
      combined_state: (status as any).state ?? null,
      check_runs: checkRuns.map((r: any) => ({
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        url: r.html_url,
      })),
      statuses: statuses.map((s: any) => ({
        context: s.context,
        state: s.state,
        description: s.description,
      })),
      failing,
      has_ci: checkRuns.length > 0 || statuses.length > 0,
    };
  }

  // ----------------------------------------------------------------- writes

  async createBranch(name: string, fromRef = "main") {
    this.requireWrite();
    const branch = assertCandidateBranch(name);
    const source = await this.request("GET", this.r(`/commits/${encodeURIComponent(fromRef)}`));
    try {
      await this.request("POST", this.r(`/git/refs`), {
        ref: `refs/heads/${branch}`,
        sha: source.sha,
      });
      return { branch, created: true, from_ref: fromRef, sha: source.sha };
    } catch (error) {
      if (error instanceof GithubError && error.status === 422) {
        const existing = await this.request("GET", this.r(`/git/ref/heads/${encodePath(branch)}`));
        return { branch, created: false, already_existed: true, sha: existing.object?.sha };
      }
      throw error;
    }
  }

  async commitFiles(
    branchName: string,
    message: string,
    files: Array<{ path: string; content: string }>,
  ) {
    this.requireWrite();
    const branch = assertCandidateBranch(branchName);
    if (!Array.isArray(files) || !files.length || files.length > 25)
      throw new PolicyError("Commit 1–25 files per checkpoint.");
    const prepared = files.map((file) => {
      const path = assertSafeRepoPath(file.path);
      assertSafeContent(path, file.content);
      return { path, content: String(file.content) };
    });
    const commitMessage = String(message || "JARVIS candidate checkpoint").slice(0, 2000);
    const ref = await this.request("GET", this.r(`/git/ref/heads/${encodePath(branch)}`));
    const parentSha = ref.object.sha as string;
    const parent = await this.request("GET", this.r(`/git/commits/${parentSha}`));
    const tree = await this.request("POST", this.r(`/git/trees`), {
      base_tree: parent.tree.sha,
      tree: prepared.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        content: file.content,
      })),
    });
    const commit = await this.request("POST", this.r(`/git/commits`), {
      message: `${commitMessage}\n\nCandidate checkpoint by JARVIS Engineer.`,
      tree: tree.sha,
      parents: [parentSha],
    });
    // Fast-forward only: force=false means GitHub rejects anything that isn't a descendant.
    await this.request("PATCH", this.r(`/git/refs/heads/${encodePath(branch)}`), {
      sha: commit.sha,
      force: false,
    });
    return {
      branch,
      commit_sha: commit.sha,
      parent_sha: parentSha,
      files: prepared.map((f) => f.path),
      url: commit.html_url ?? null,
    };
  }

  async editCandidate(
    branchName: string,
    path: string,
    find: string,
    replace: string,
    message: string,
  ) {
    const branch = assertCandidateBranch(branchName);
    const clean = assertSafeRepoPath(path);
    const current = await this.readRaw(clean, branch);
    const occurrences = find ? current.split(find).length - 1 : 0;
    if (occurrences !== 1)
      throw new PolicyError(
        `Expected exactly one occurrence of the find text in ${clean}; found ${occurrences}. Read the file and use a more specific anchor.`,
      );
    const next = current.replace(find, replace);
    return this.commitFiles(branch, message, [{ path: clean, content: next }]);
  }

  async createFile(branchName: string, path: string, content: string, message: string) {
    const branch = assertCandidateBranch(branchName);
    const clean = assertSafeRepoPath(path);
    const exists = await this.request(
      "GET",
      this.r(`/contents/${encodePath(clean)}?ref=${encodeURIComponent(branch)}`),
    ).then(
      () => true,
      (error) =>
        error instanceof GithubError && error.status === 404 ? false : Promise.reject(error),
    );
    if (exists)
      throw new PolicyError(`${clean} already exists on ${branch}; use github.edit_candidate.`);
    return this.commitFiles(branch, message, [{ path: clean, content }]);
  }

  private async readRaw(path: string, ref: string) {
    const data = await this.request(
      "GET",
      this.r(`/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`),
    );
    if (Array.isArray(data)) throw new PolicyError(`${path} is a directory.`);
    return decodeBase64(String(data.content ?? ""));
  }

  async createPr(head: string, title: string, body: string, base = "main", draft = true) {
    this.requireWrite();
    const branch = assertCandidateBranch(head);
    const pr = await this.request("POST", this.r(`/pulls`), {
      head: branch,
      base,
      title: String(title).slice(0, 240),
      body: `${String(body ?? "").slice(0, 60_000)}\n\n---\n_Candidate prepared by JARVIS Engineer. Not merged — release requires review._`,
      draft,
    });
    return { number: pr.number, url: pr.html_url, head: branch, base, draft: pr.draft };
  }

  async updatePr(number: number, patch: { title?: string; body?: string }) {
    this.requireWrite();
    const pr = await this.request("GET", this.r(`/pulls/${Number(number)}`));
    assertCandidateBranch(pr.head?.ref ?? "");
    const update: Record<string, string> = {};
    if (patch.title) update["title"] = String(patch.title).slice(0, 240);
    if (patch.body) update["body"] = String(patch.body).slice(0, 60_000);
    if (!Object.keys(update).length) throw new PolicyError("Nothing to update.");
    const updated = await this.request("PATCH", this.r(`/pulls/${Number(number)}`), update);
    return { number: updated.number, url: updated.html_url, title: updated.title };
  }

  // -------------------------------------------------------- public research

  async searchRepositories(query: string, language?: string) {
    const q = `${query}${language ? ` language:${language}` : ""}`;
    const data = await this.request(
      "GET",
      `/search/repositories?per_page=8&sort=stars&q=${encodeURIComponent(q)}`,
    );
    return (data.items ?? []).map((repo: any) => ({
      repo: repo.full_name,
      url: repo.html_url,
      description: String(repo.description ?? "").slice(0, 200),
      stars: repo.stargazers_count,
      updated_at: repo.pushed_at,
      license: repo.license?.spdx_id ?? null,
      archived: repo.archived,
    }));
  }

  async repositoryLicense(fullName: string) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new GithubError("Use owner/name.", 400);
    try {
      const data = await this.request("GET", `/repos/${fullName}/license`);
      return {
        spdx: (data.license?.spdx_id as string) ?? null,
        name: data.license?.name ?? null,
        url: data.html_url ?? null,
      };
    } catch (error) {
      if (error instanceof GithubError && error.status === 404)
        return { spdx: null, name: null, url: null };
      throw error;
    }
  }
}

export type LicenseVerdict = "compatible" | "caution" | "incompatible" | "unknown";

const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "Zlib",
  "MIT-0",
  "BSL-1.0",
]);
const COPYLEFT = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "MPL-2.0",
  "EPL-2.0",
  "GPL-2.0-only",
  "GPL-3.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-or-later",
]);
const INCOMPATIBLE = new Set([
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "SSPL-1.0",
  "BUSL-1.1",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "Elastic-2.0",
  "PolyForm-Noncommercial-1.0.0",
]);

export function classifyLicense(spdx: string | null): {
  verdict: LicenseVerdict;
  guidance: string;
} {
  if (!spdx || spdx === "NOASSERTION")
    return {
      verdict: "unknown",
      guidance:
        "No detectable license: do not copy code. Learn the pattern and implement independently.",
    };
  if (PERMISSIVE.has(spdx))
    return {
      verdict: "compatible",
      guidance: `${spdx} permits commercial use. Preserve the copyright/license notice, record the source URL, security-review and adapt to Emery architecture.`,
    };
  if (INCOMPATIBLE.has(spdx))
    return {
      verdict: "incompatible",
      guidance: `${spdx} is network-copyleft, noncommercial or source-available. Do not copy; independently implement the idea.`,
    };
  if (COPYLEFT.has(spdx))
    return {
      verdict: "caution",
      guidance: `${spdx} is copyleft. Do not copy into Emery without Adam's explicit review; prefer an independent implementation.`,
    };
  return { verdict: "caution", guidance: `${spdx} needs manual review before any copying.` };
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64(value: string) {
  const clean = value.replace(/\n/g, "");
  if (typeof Buffer !== "undefined") return Buffer.from(clean, "base64").toString("utf8");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
