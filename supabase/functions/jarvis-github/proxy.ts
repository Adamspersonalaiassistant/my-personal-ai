// JARVIS GitHub proxy core. Pure (no Deno APIs) so it is unit-tested in Node.
//
// The edge function holds JARVIS_GITHUB_TOKEN. Callers never send or receive it.
// Every request is checked against an allowlist BEFORE the token is attached:
//   - repository is fixed to Adamspersonalaiassistant/my-personal-ai
//   - reads: repo metadata, commits, compare, checks/status, contents, trees, PRs, code search
//   - writes: only refs under refs/heads/jarvis/*, git objects (blobs/trees/commits),
//     opening a PR from a jarvis/* head, editing a PR whose head is jarvis/*
//   - never: merge, close, delete, force update, main/protected refs, workflows,
//     .env/key files, credentials, database-security weakening
// Anything not explicitly allowed is refused with 403.

import {
  assertCandidateBranch,
  assertSafeContent,
  assertSafeRepoPath,
  PolicyError,
  redactSecrets,
} from "./guards.ts";

export const JARVIS_REPO = "Adamspersonalaiassistant/my-personal-ai";
const REPO_PREFIX = `/repos/${JARVIS_REPO}`;
const API = "https://api.github.com";

export type ProxyRequest = {
  method: string;
  path: string;
  body?: unknown;
  accept?: "json" | "raw";
};

export type ProxyResult = { status: number; body: string; refused?: string };

export type ProxyDeps = {
  token: string | null;
  fetcher: typeof fetch;
  /**
   * One-shot release authorization for ONE pull request at ONE pinned head sha.
   * Only the worker's release operator sets this, and only after the release
   * gate plus CI (and, when required, Adam's sha-bound approval) cleared that
   * exact PR. The interactive jarvis-github gateway never sets it, so the model
   * can never merge through it.
   */
  releaseAuth?: { pr: number; sha: string; nodeId?: string } | null;
};

/** The only GraphQL operation the gateway allows: mark the authorized PR ready for review. */
export const READY_FOR_REVIEW_MUTATION =
  "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }";

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

function decodeSegments(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return refuse("Malformed path.");
  }
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

const READ_PATTERNS: RegExp[] = [
  /^$/, // repo metadata
  /^\/commits(\?.*)?$/,
  /^\/commits\/[^/?]+(\/check-runs|\/status)?(\?.*)?$/,
  /^\/compare\/[^/?]+\.\.\.[^/?]+(\?.*)?$/,
  /^\/contents(\/[^?]*)?(\?.*)?$/,
  /^\/git\/ref\/heads\/[^?]+$/,
  /^\/git\/commits\/[0-9a-f]{7,40}$/,
  /^\/git\/trees\/[^/?]+(\?.*)?$/,
  /^\/pulls(\?.*)?$/,
  /^\/pulls\/\d+$/,
  /^\/pulls\/\d+\/files(\?.*)?$/,
  /^\/actions\/runs(\?.*)?$/,
  /^\/license$/,
  /^\/branches\/[^/?]+$/,
  /^\/check-runs\/\d+\/annotations(\?.*)?$/,
];

function checkRead(path: string) {
  // Public research reads (any public repository's license, repo search) carry no repo write power.
  if (/^\/search\/repositories\?/.test(path)) return;
  if (/^\/repos\/[\w.-]+\/[\w.-]+\/license$/.test(path)) return;
  if (path.startsWith("/search/code?")) {
    const q = decodeSegments(new URL(`${API}${path}`).searchParams.get("q") ?? "");
    if (!q.includes(`repo:${JARVIS_REPO}`))
      refuse("Code search must be scoped to the Emery repository.");
    return;
  }
  if (!path.startsWith(REPO_PREFIX)) refuse("Only the Emery repository can be read.");
  const rest = path.slice(REPO_PREFIX.length);
  if (!READ_PATTERNS.some((pattern) => pattern.test(rest)))
    refuse(`GET ${rest || "/"} is not an allowed read.`);
}

function checkTreeBody(body: Record<string, any>) {
  if (!Array.isArray(body["tree"]) || body["tree"].length === 0 || body["tree"].length > 25)
    refuse("A tree must contain 1–25 entries.");
  if (typeof body["base_tree"] !== "string")
    refuse("A tree must extend a base_tree (no orphan trees).");
  for (const entry of body["tree"]) {
    const item = asObject(entry);
    const path = assertSafeRepoPath(String(item["path"] ?? ""));
    if (item["mode"] !== "100644") refuse("Only regular files (mode 100644) can be written.");
    if (typeof item["content"] === "string") assertSafeContent(path, item["content"]);
    else if (item["sha"] !== null && typeof item["sha"] !== "string")
      refuse("Tree entries need content or a sha.");
  }
}

async function checkWrite(req: ProxyRequest, deps: ProxyDeps) {
  const method = req.method;
  const path = req.path;
  if (method === "POST" && path === "/graphql") return checkGraphql(asObject(req.body), deps);
  if (!path.startsWith(REPO_PREFIX)) refuse("Only the Emery repository can be written.");
  const rest = path.slice(REPO_PREFIX.length);
  const body = asObject(req.body);

  if (method === "POST" && rest === "/git/refs") {
    const ref = String(body["ref"] ?? "");
    if (!ref.startsWith("refs/heads/")) refuse("Only branch refs can be created.");
    assertCandidateBranch(ref);
    return;
  }
  if (method === "PATCH" && rest.startsWith("/git/refs/heads/")) {
    assertCandidateBranch(decodeSegments(rest.slice("/git/refs/heads/".length)));
    if (body["force"] === true) refuse("Force updates are not allowed.");
    if (typeof body["sha"] !== "string") refuse("A target sha is required.");
    return;
  }
  if (method === "POST" && rest === "/git/trees") return checkTreeBody(body);
  if (method === "POST" && rest === "/git/commits") {
    if (
      typeof body["tree"] !== "string" ||
      !Array.isArray(body["parents"]) ||
      body["parents"].length < 1
    )
      refuse("Commits need a tree and at least one parent.");
    return;
  }
  if (method === "POST" && rest === "/pulls") {
    assertCandidateBranch(String(body["head"] ?? ""));
    if (body["base"] !== "main") refuse("Pull requests must target main.");
    return;
  }
  if (method === "PATCH" && /^\/pulls\/\d+$/.test(rest)) {
    // Only title/body edits; never state (close/merge) and only for jarvis/* PRs.
    for (const key of Object.keys(body))
      if (!["title", "body"].includes(key)) refuse("Only title/body of a PR can be changed.");
    const pr = await deps.fetcher(`${API}${path}`, { headers: authHeaders(deps.token) });
    if (!pr.ok) refuse("Pull request could not be inspected.");
    assertCandidateBranch(String(asObject(asObject(await pr.json())["head"])["ref"] ?? ""));
    return;
  }
  if (method === "PUT" && /^\/pulls\/\d+\/update-branch$/.test(rest)) {
    // Bring a jarvis/* candidate up to date with main (a write to the candidate branch only).
    for (const key of Object.keys(body))
      if (key !== "expected_head_sha") refuse("Only expected_head_sha may be sent.");
    if (typeof body["expected_head_sha"] !== "string") refuse("expected_head_sha is required.");
    const pr = asObject(
      await (
        await deps.fetcher(`${API}${path.replace(/\/update-branch$/, "")}`, {
          headers: authHeaders(deps.token),
        })
      ).json(),
    );
    assertCandidateBranch(String(asObject(pr["head"])["ref"] ?? ""));
    return;
  }
  const mergeMatch = /^\/pulls\/(\d+)\/merge$/.exec(rest);
  if (method === "PUT" && mergeMatch) {
    const auth = deps.releaseAuth;
    if (!auth || auth.pr !== Number(mergeMatch[1]))
      refuse("Merging is only possible through the worker's gated release operator.");
    if (body["sha"] !== auth.sha || body["merge_method"] !== "merge")
      refuse("A release merge must pin the authorized head sha and use a merge commit.");
    for (const key of Object.keys(body))
      if (!["sha", "merge_method", "commit_title", "commit_message"].includes(key))
        refuse("Unexpected merge parameter.");
    await assertReleasablePr(auth, deps);
    return;
  }
  refuse(
    `${method} ${rest} is not an allowed write (merge, delete, workflow and protected-ref operations are refused).`,
  );
}

/** Re-verified at the chokepoint for every release write: open, jarvis/* head at the pinned sha, base main. */
async function assertReleasablePr(
  auth: { pr: number; sha: string; nodeId?: string },
  deps: ProxyDeps,
) {
  const res = await deps.fetcher(`${API}${REPO_PREFIX}/pulls/${auth.pr}`, {
    headers: authHeaders(deps.token),
  });
  if (!res.ok) refuse("Pull request could not be inspected.");
  const pr = asObject(await res.json());
  const head = asObject(pr["head"]);
  assertCandidateBranch(String(head["ref"] ?? ""));
  if (pr["state"] !== "open") refuse("Only an open pull request can be released.");
  if (head["sha"] !== auth.sha) refuse("The pull request head moved after authorization.");
  if (asObject(pr["base"])["ref"] !== "main") refuse("Release merges must target main.");
  return pr;
}

async function checkGraphql(body: Record<string, any>, deps: ProxyDeps) {
  const auth = deps.releaseAuth;
  if (!auth?.nodeId) refuse("GraphQL is only available to the release operator.");
  if (body["query"] !== READY_FOR_REVIEW_MUTATION)
    refuse("Only the ready-for-review mutation is allowed.");
  const variables = asObject(body["variables"]);
  if (Object.keys(variables).join() !== "id" || variables["id"] !== auth.nodeId)
    refuse("The mutation must target the authorized pull request.");
  const pr = await assertReleasablePr(auth, deps);
  if (pr["node_id"] !== auth.nodeId) refuse("Pull request identity mismatch.");
}

function authHeaders(token: string | null, accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "emery-jarvis-edge",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function handleGithubProxy(req: ProxyRequest, deps: ProxyDeps): Promise<ProxyResult> {
  const method = String(req.method ?? "").toUpperCase();
  const path = String(req.path ?? "");
  try {
    if (!["GET", "POST", "PATCH", "PUT"].includes(method)) refuse(`${method} is not allowed.`);
    if (
      !path.startsWith("/") ||
      // Path traversal only: "main...sha" in compare URLs is a legitimate range, "/../" is not.
      /(^|\/)\.\.(\/|$)|%2e%2e/i.test(path) ||
      path.includes("//") ||
      path.includes("@") ||
      path.length > 600
    )
      refuse("Invalid path.");
    const normalized = { ...req, method, path };
    if (method === "GET") checkRead(path);
    else await checkWrite(normalized, deps);
    if (!deps.token) {
      return {
        status: 412,
        body: JSON.stringify({
          message: "JARVIS_GITHUB_TOKEN is not configured on the edge function.",
        }),
      };
    }
    const accept =
      req.accept === "raw" && method === "GET"
        ? "application/vnd.github.raw+json"
        : "application/vnd.github+json";
    const response = await deps.fetcher(`${API}${path}`, {
      method,
      headers: {
        ...authHeaders(deps.token, accept),
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      body: method === "GET" ? null : JSON.stringify(req.body ?? {}),
    });
    const text = await response.text();
    return { status: response.status, body: redactSecrets(text).slice(0, 4_000_000) };
  } catch (error) {
    if (error instanceof Refusal || error instanceof PolicyError)
      return {
        status: 403,
        body: JSON.stringify({ message: redactSecrets(error.message) }),
        refused: error.message,
      };
    return { status: 502, body: JSON.stringify({ message: "GitHub request failed." }) };
  }
}
