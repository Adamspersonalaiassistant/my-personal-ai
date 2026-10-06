// JARVIS release operator: end-to-end harness with a fake GitHub behind the REAL
// gateway (proxy.ts), the REAL GithubOps and the REAL release operator. Proves:
// low-risk auto release, Adam's exact-PR/exact-SHA approval, invalidation when
// the head changes, red CI / wrong base / non-jarvis branch / protected change /
// secret file all blocked, worker deploy after merge, idempotency, production
// verification before the ledger is written, and rollback preparation.

import assert from "node:assert/strict";
import { GithubOps } from "../supabase/functions/jarvis-worker/github-ops.ts";
import { handleGithubProxy } from "../supabase/functions/jarvis-worker/proxy.ts";
import { handleGithubProxy as edgeProxy } from "../supabase/functions/jarvis-github/proxy.ts";
import {
  ReleaseOperator,
  approvalProblem,
  prNumberFromUrl,
  servedCommitFrom,
} from "../supabase/functions/jarvis-worker/release.ts";
import {
  evaluateReleaseGate,
  deploymentNeeds,
} from "../supabase/functions/jarvis-worker/release-gate.ts";

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const REPO = "/repos/Adamspersonalaiassistant/my-personal-ai";
const OWNER = "owner-1";
const MAIN0 = "a".repeat(40);
const sha = (n) => String(n).padStart(40, "0");

// ------------------------------------------------------------------ fakes

class FakeRepo {
  constructor() {
    this.prs = new Map();
    this.ci = new Map(); // sha -> "success" | "failure"
    this.behind = new Map(); // sha -> commits behind main
    this.runs = []; // workflow runs
    this.mergeCalls = [];
    this.updateCalls = [];
    this.graphql = [];
    this.refs = new Map([["main", MAIN0]]);
    this.commits = new Map();
    this.trees = new Map([[MAIN0, { "docs/a.md": "old\n" }]]);
    this.contents = new Map();
    this.nextPr = 300;
    this.mergeSeq = 0;
    this.served = null;
  }
  addPr({ number, headRef = "jarvis/t-1", base = "main", head, files, draft = false }) {
    const pr = {
      number,
      node_id: `PR_${number}`,
      state: "open",
      merged: false,
      merge_commit_sha: null,
      draft,
      head: { ref: headRef, sha: head },
      base: { ref: base },
      html_url: `https://github.com/o/r/pull/${number}`,
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status ?? "modified",
        additions: f.additions ?? 4,
        deletions: f.deletions ?? 0,
        patch: f.patch ?? "+ added line",
      })),
    };
    this.prs.set(number, pr);
    this.ci.set(head, "success");
    return pr;
  }
  fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (u.pathname === "/graphql") {
      this.graphql.push(body);
      const pr = [...this.prs.values()].find((p) => p.node_id === body.variables.id);
      if (pr) pr.draft = false;
      return json({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
    }
    const p = u.pathname.replace(REPO, "");
    let m;
    if (method === "GET" && (m = p.match(/^\/pulls\/(\d+)$/))) {
      const pr = this.prs.get(Number(m[1]));
      return pr ? json(pr) : json({ message: "Not Found" }, 404);
    }
    if (method === "GET" && (m = p.match(/^\/pulls\/(\d+)\/files$/)))
      return json(this.prs.get(Number(m[1])).files);
    if (method === "GET" && (m = p.match(/^\/compare\/main\.\.\.(\w+)$/)))
      return json({ behind_by: this.behind.get(m[1]) ?? 0, status: "ahead" });
    if (method === "GET" && (m = p.match(/^\/compare\/(\w+)\.\.\.(\w+)$/))) {
      // "ahead" only when the second commit descends from the first (real ancestry).
      const descends = (child, ancestor) => {
        for (let cur = [child], seen = new Set(); cur.length;) {
          const c = cur.pop();
          if (c === ancestor) return true;
          if (seen.has(c)) continue;
          seen.add(c);
          cur.push(...(this.commits.get(c)?.parents ?? []));
        }
        return false;
      };
      const status = m[1] === m[2] ? "identical" : descends(m[2], m[1]) ? "ahead" : "behind";
      return json({ status });
    }
    if (method === "GET" && (m = p.match(/^\/commits\/(\w+)\/check-runs$/))) {
      const state = this.ci.get(m[1]);
      return json({
        check_runs: state
          ? [
              {
                id: 5,
                name: "jarvis-candidate",
                status: "completed",
                conclusion: state,
                html_url: `https://ci/${m[1]}`,
              },
            ]
          : [],
      });
    }
    if (method === "GET" && p === "/actions/runs")
      return json({
        workflow_runs: this.runs.filter((r) => r.head_sha === u.searchParams.get("head_sha")),
      });
    if (method === "PUT" && (m = p.match(/^\/pulls\/(\d+)\/update-branch$/))) {
      this.updateCalls.push(Number(m[1]));
      const pr = this.prs.get(Number(m[1]));
      const next = sha(900 + this.updateCalls.length);
      this.ci.set(next, "success");
      this.behind.set(next, 0);
      pr.head.sha = next;
      return json({ message: "Updating pull request branch." }, 202);
    }
    if (method === "PUT" && (m = p.match(/^\/pulls\/(\d+)\/merge$/))) {
      this.mergeCalls.push({ pr: Number(m[1]), body });
      const pr = this.prs.get(Number(m[1]));
      if (pr.merged) return json({ message: "Pull Request is not mergeable" }, 405);
      pr.merged = true;
      pr.state = "closed";
      pr.merge_commit_sha = sha(700 + ++this.mergeSeq);
      const parent = this.refs.get("main");
      this.commits.set(pr.merge_commit_sha, { parents: [parent], tree: parent });
      this.trees.set(pr.merge_commit_sha, { ...(this.trees.get(parent) ?? {}) });
      this.refs.set("main", pr.merge_commit_sha);
      return json({ merged: true, sha: pr.merge_commit_sha });
    }
    if (method === "GET" && (m = p.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const s = this.refs.get(decodeURIComponent(m[1]));
      return s ? json({ object: { sha: s } }) : json({ message: "Not Found" }, 404);
    }
    if (method === "GET" && (m = p.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1]);
      return c
        ? json({
            sha: m[1],
            tree: { sha: c.tree },
            message: c.message ?? "",
            parents: c.parents.map((x) => ({ sha: x })),
          })
        : json({ sha: m[1], tree: { sha: m[1] }, message: "", parents: [] });
    }
    if (method === "POST" && p === "/git/refs") {
      this.refs.set(body.ref.replace("refs/heads/", ""), body.sha);
      return json({ ref: body.ref }, 201);
    }
    if (method === "GET" && (m = p.match(/^\/contents\/(.+)$/))) {
      const files = this.trees.get(u.searchParams.get("ref")) ?? {};
      const c = files[decodeURIComponent(m[1])];
      return c == null ? json({ message: "Not Found" }, 404) : new Response(c, { status: 200 });
    }
    if (method === "POST" && p === "/git/trees")
      return json({ sha: `tree${Math.random().toString(16).slice(2, 10)}` }, 201);
    if (method === "POST" && p === "/git/commits") {
      const s = sha(800 + this.commits.size);
      this.commits.set(s, { parents: body.parents, tree: body.tree, message: body.message });
      return json({ sha: s }, 201);
    }
    if (method === "PATCH" && (m = p.match(/^\/git\/refs\/heads\/(.+)$/))) {
      this.refs.set(decodeURIComponent(m[1]), body.sha);
      return json({ object: { sha: body.sha } });
    }
    if (method === "GET" && p.startsWith("/pulls")) {
      const head = u.searchParams.get("head")?.split(":")[1];
      return json([...this.prs.values()].filter((x) => x.head.ref === head && x.state === "open"));
    }
    if (method === "POST" && p === "/pulls") {
      const number = this.nextPr++;
      this.addPr({
        number,
        headRef: body.head,
        head: sha(1000 + number),
        files: [{ filename: "docs/rollback.md" }],
      });
      return json({ number, html_url: `https://github.com/o/r/pull/${number}` }, 201);
    }
    return json({ message: `fake: unhandled ${method} ${p}` }, 404);
  };
}

class FakeStore {
  constructor() {
    this.tasks = [];
    this.notifications = [];
    this.ledger = [];
    this.errors = 0;
    this.inserted = [];
  }
  async releaseCandidates() {
    return this.tasks
      .filter(
        (t) =>
          t.status === "ready_for_release" &&
          !t.is_fixture &&
          t.approval_state === "approved" &&
          t.pr_url,
      )
      .map((t) => structuredClone(t));
  }
  async casRelease(task, from, release, extra = {}) {
    const t = this.tasks.find((x) => x.id === task.id);
    const cur = t.metadata.release?.state ?? null;
    if (cur !== from) return false;
    t.metadata = { ...t.metadata, release };
    for (const [k, v] of Object.entries(extra)) if (v != null) t[k] = v;
    return true;
  }
  async autoReleasesSince(_u, sinceIso) {
    return this.tasks.filter(
      (t) =>
        t.metadata.release?.mode === "auto_low_risk" &&
        (t.metadata.release.merged_at ?? "") >= sinceIso,
    ).length;
  }
  async recordRelease(row) {
    this.ledger.push(row);
    return `rel-${this.ledger.length}`;
  }
  async notify(_u, note) {
    if (!this.notifications.some((n) => n.ref === note.ref)) this.notifications.push(note);
  }
  async runtimeErrors() {
    return this.errors;
  }
  async insertTask(row) {
    this.inserted.push(row);
    return { id: `rb-${this.inserted.length}` };
  }
}

let clock = Date.parse("2026-10-07T12:00:00Z");
const now = () => new Date(clock);
const advance = (ms) => (clock += ms);

function world({ publisher = null } = {}) {
  const repo = new FakeRepo();
  const store = new FakeStore();
  const github = new GithubOps({ token: "test-token", fetcher: repo.fetch });
  const state = { served: sha(1), publisher };
  const op = () =>
    new ReleaseOperator({
      store,
      github,
      servedCommit: async () => state.served,
      publisher: state.publisher,
      now,
    });
  let n = 0;
  const candidate = ({ files, headRef, base, draft, tested, ci, behind, metadata = {} }) => {
    n += 1;
    const head = sha(10 + n);
    const pr = repo.addPr({
      number: 100 + n,
      headRef: headRef ?? `jarvis/t-${n}`,
      base: base ?? "main",
      head,
      files,
      draft,
    });
    if (ci) repo.ci.set(head, ci);
    if (behind) repo.behind.set(head, behind);
    const task = {
      id: `task-${n}`,
      user_id: OWNER,
      title: `Candidate ${n}`,
      status: "ready_for_release",
      is_fixture: false,
      approval_state: "approved",
      pr_url: pr.html_url,
      commit_sha: tested ?? head,
      metadata,
    };
    store.tasks.push(task);
    return { pr, task, head };
  };
  const approve = (task, pr, over = {}) => {
    task.metadata.release_approval = {
      pr: pr.number,
      head_sha: pr.head.sha,
      task_id: task.id,
      production_base: state.served,
      approved_at: now().toISOString(),
      expires_at: new Date(clock + 3_600_000).toISOString(),
      ...over,
    };
  };
  const run = async () => op().run(OWNER);
  return { repo, store, github, state, candidate, approve, run, op };
}

const docs = [{ filename: "docs/jarvis-engineer/20-NOTE.md" }];
const capNote = [
  {
    filename: "src/lib/execution-capabilities.ts",
    patch:
      '+  spotify_playback: {\n+    canExecute: false,\n+    note: "Spotify playback is not connected.",\n+  },',
  },
];
const emery = [{ filename: "src/lib/emery/planner.ts" }];
const workerFiles = [{ filename: "supabase/functions/jarvis-worker/engine.ts" }];
const rel = (task) => task.metadata.release;

// ------------------------------------------------------------------ tests

await check(
  "gate tiers: auto / needs Adam / manual-only / never (and capability notes may never claim new executables)",
  () => {
    const f = (filename, extra = {}) => ({
      filename,
      status: "modified",
      additions: 3,
      deletions: 0,
      patch: "+ x",
      ...extra,
    });
    assert.equal(evaluateReleaseGate([f("docs/a.md")]).auto, true);
    assert.equal(
      evaluateReleaseGate(capNote.map((c) => f(c.filename, { patch: c.patch }))).auto,
      true,
    );
    assert.equal(
      evaluateReleaseGate([
        f("src/lib/execution-capabilities.ts", { patch: "+ x: { canExecute: true }," }),
      ]).auto,
      false,
    );
    assert.equal(evaluateReleaseGate([f("src/lib/emery/planner.ts")]).auto, false);
    assert.equal(
      evaluateReleaseGate([f("src/lib/emery/planner.ts")]).mergeable,
      true,
      "normal Emery code is mergeable after Adam",
    );
    assert.equal(
      evaluateReleaseGate([f("supabase/functions/jarvis-worker/engine.ts")]).mergeable,
      true,
      "edge functions are mergeable after Adam",
    );
    for (const guard of [
      "supabase/functions/jarvis-worker/release-gate.ts",
      "supabase/functions/jarvis-worker/release.ts",
      "supabase/functions/jarvis-worker/proxy.ts",
      "supabase/functions/jarvis-github/proxy.ts",
      "src/lib/jarvis/policy.ts",
      ".github/workflows/deploy-jarvis-functions.yml",
      "supabase/migrations/20261007000000_x.sql",
    ]) {
      const d = evaluateReleaseGate([f(guard)]);
      assert.equal(d.manualOnly, true, guard);
      assert.equal(d.mergeable, false, guard);
    }
    for (const secret of [
      ".env",
      ".env.production",
      "keys/server.pem",
      "config/credentials.json",
    ]) {
      const d = evaluateReleaseGate([f(secret)]);
      assert.equal(d.mergeable, false, secret);
      assert.equal(d.manualOnly, false, `${secret}: never, not merely manual`);
    }
    assert.equal(evaluateReleaseGate([f("docs/a.md", { status: "removed" })]).auto, false);
    assert.equal(
      evaluateReleaseGate(Array.from({ length: 9 }, (_, i) => f(`docs/${i}.md`))).auto,
      false,
      "size limit",
    );
    assert.deepEqual(
      deploymentNeeds([f("docs/a.md"), f("supabase/functions/jarvis-worker/engine.ts")]),
      { functions: ["jarvis-worker"], frontend: false },
    );
    assert.equal(deploymentNeeds([f("src/lib/x.ts")]).frontend, true);
  },
);

await check(
  "LOW-RISK AUTO RELEASE: docs candidate is gated, merged at its pinned head, and no deploy is needed",
  async () => {
    const w = world();
    const c = w.candidate({ files: docs });
    const rep = await w.run();
    assert.equal(w.repo.mergeCalls.length, 1);
    assert.equal(w.repo.mergeCalls[0].body.sha, c.head, "merge pinned to the exact head sha");
    assert.equal(w.repo.mergeCalls[0].body.merge_method, "merge");
    assert.equal(c.pr.merged, true);
    await w.run(); // next tick: documentation-only release needs no deployment
    assert.equal(rel(c.task).state, "released_no_deploy");
    assert.equal(rel(c.task).mode, "auto_low_risk");
    assert.equal(
      w.store.ledger.length,
      0,
      "no deployment, nothing to verify, no production ledger row",
    );
    assert.equal(w.store.notifications.length, 1);
  },
);

await check(
  "LOW-RISK + FRONTEND (free route): merged, then 'Publish' notification once; ledger only AFTER production serves the merge",
  async () => {
    const w = world();
    const c = w.candidate({ files: capNote });
    await w.run();
    assert.equal(rel(c.task).state, "merged");
    await w.run();
    assert.equal(rel(c.task).state, "awaiting_publish");
    const mergeSha = rel(c.task).merge_sha;
    assert.equal(w.store.ledger.length, 0, "no ledger row before verification");
    assert.equal(w.store.notifications.filter((n) => /Publish/.test(n.title)).length, 1);
    advance(10 * 60_000);
    await w.run();
    await w.run();
    assert.equal(rel(c.task).state, "awaiting_publish", "production still serves the old commit");
    assert.equal(
      w.store.notifications.filter((n) => /Publish/.test(n.title)).length,
      1,
      "one notification, no spam",
    );
    w.state.served = mergeSha; // Adam tapped Publish
    await w.run();
    assert.equal(rel(c.task).state, "verified");
    assert.equal(w.store.ledger.length, 1);
    assert.equal(w.store.ledger[0].deployment_verified, true);
    assert.equal(w.store.ledger[0].production_commit_sha, mergeSha);
    assert.equal(w.store.ledger[0].previous_production_commit_sha, sha(1));
    assert.equal(
      c.task.status,
      "ready_for_release",
      "stays open during the 15-minute regression watch",
    );
    advance(16 * 60_000);
    await w.run();
    assert.equal(rel(c.task).state, "stable");
    assert.equal(c.task.status, "completed");
    assert.equal(w.store.ledger.length, 1);
  },
);

await check(
  "LOVABLE API route (only if a key exists): publish → poll → verify → ledger",
  async () => {
    const jobs = [];
    const publisher = {
      publish: async () => (jobs.push("p"), { id: "dep-1" }),
      status: async () => ({ status: jobs.length > 1 ? "completed" : (jobs.push("s"), "running") }),
    };
    const w = world({ publisher });
    const c = w.candidate({ files: capNote });
    await w.run();
    await w.run(); // merged -> publishing
    assert.equal(rel(c.task).state, "publishing");
    await w.run();
    w.state.served = rel(c.task).merge_sha;
    await w.run();
    assert.equal(rel(c.task).state, "verified");
    assert.equal(w.store.ledger.length, 1);
  },
);

await check(
  "ADAM 'APPROVE IT': a normal Emery change waits, then merges only with approval bound to this exact PR + head + production",
  async () => {
    const w = world();
    const c = w.candidate({ files: emery });
    await w.run();
    assert.equal(rel(c.task).state, "awaiting_approval");
    assert.equal(w.repo.mergeCalls.length, 0, "never merged without approval");
    assert.equal(w.store.notifications.length, 1);
    assert.match(w.store.notifications[0].body, /Approve it/);
    w.approve(c.task, c.pr);
    await w.run();
    assert.equal(w.repo.mergeCalls.length, 1);
    assert.equal(rel(c.task).mode, "adam_approved");
    assert.equal(w.repo.mergeCalls[0].body.sha, c.head);
  },
);

await check(
  "CHANGED HEAD invalidates approval: a commit pushed after approval can never be released",
  async () => {
    const w = world();
    const c = w.candidate({ files: emery });
    w.approve(c.task, c.pr);
    // The PR head moves after Adam approved (someone pushed to the branch).
    c.pr.head.sha = sha(555);
    w.repo.ci.set(sha(555), "success");
    await w.run();
    assert.equal(w.repo.mergeCalls.length, 0);
    assert.equal(rel(c.task).state, "head_changed");
    // Even if the task record is refreshed to the new head, the approval (old sha) is void.
    c.task.commit_sha = sha(555);
    c.task.metadata.release = undefined;
    delete c.task.metadata.release;
    await w.run();
    assert.equal(w.repo.mergeCalls.length, 0);
    assert.equal(rel(c.task).state, "awaiting_approval");
    assert.match(rel(c.task).approval_invalid, /changed after approval/);
    assert.equal(
      approvalProblem(
        {
          pr: 1,
          head_sha: "a",
          task_id: "t",
          production_base: "p",
          approved_at: "",
          expires_at: new Date(clock + 1000).toISOString(),
        },
        { pr: 1, headSha: "b", taskId: "t", production: "p", now: now() },
      ).includes("changed after approval"),
      true,
    );
  },
);

await check("approval expires and is void if production moved", async () => {
  const w = world();
  const c = w.candidate({ files: emery });
  w.approve(c.task, c.pr, { expires_at: new Date(clock - 1).toISOString() });
  await w.run();
  assert.equal(rel(c.task).state, "awaiting_approval");
  assert.match(rel(c.task).approval_invalid, /expired/);
  const d = world();
  const e = d.candidate({ files: emery });
  d.approve(e.task, e.pr);
  d.state.served = sha(99); // production moved after approval
  await d.run();
  assert.equal(d.repo.mergeCalls.length, 0);
  assert.match(rel(e.task).approval_invalid, /production changed/);
});

await check("RED CI blocks release, even for a low-risk change with approval", async () => {
  const w = world();
  const c = w.candidate({ files: docs, ci: "failure" });
  w.approve(c.task, c.pr);
  await w.run();
  assert.equal(w.repo.mergeCalls.length, 0);
  assert.equal(rel(c.task).state, "ci_not_green");
});

await check("WRONG BASE and NON-JARVIS BRANCH block release", async () => {
  const w = world();
  const a = w.candidate({ files: docs, base: "release" });
  const b = w.candidate({ files: docs, headRef: "feature/hpo" });
  for (const x of [a, b]) w.approve(x.task, x.pr);
  await w.run();
  assert.equal(w.repo.mergeCalls.length, 0);
  assert.equal(rel(a.task).state, "blocked");
  assert.equal(rel(b.task).state, "blocked");
});

await check(
  "PROTECTED / MANUAL-ONLY / SECRET changes: blocked without approval; manual-only and secrets blocked even WITH approval",
  async () => {
    const w = world();
    const planner = w.candidate({ files: emery });
    const guard = w.candidate({
      files: [{ filename: "supabase/functions/jarvis-worker/release-gate.ts" }],
    });
    const secret = w.candidate({
      files: [{ filename: "docs/ok.md" }, { filename: ".env.production" }],
    });
    const migration = w.candidate({ files: [{ filename: "supabase/migrations/20261007_x.sql" }] });
    await w.run();
    assert.equal(w.repo.mergeCalls.length, 0, "nothing merges without approval");
    assert.equal(rel(planner.task).state, "awaiting_approval");
    for (const x of [guard, secret, migration]) w.approve(x.task, x.pr);
    await w.run();
    await w.run();
    await w.run();
    assert.equal(
      w.repo.mergeCalls.length,
      0,
      "guardrails, migrations and secrets are never merged by JARVIS",
    );
    assert.equal(rel(guard.task).state, "manual_only");
    assert.equal(rel(migration.task).state, "manual_only");
    assert.equal(rel(secret.task).state, "blocked");
  },
);

await check(
  "SUPABASE WORKER CHANGE: after an approved merge, waits for the deploy workflow; verifies before the ledger; failure → rollback candidate",
  async () => {
    const ok = world();
    const c = ok.candidate({ files: workerFiles });
    ok.approve(c.task, c.pr);
    await ok.run();
    assert.equal(rel(c.task).state, "merged");
    await ok.run();
    assert.equal(rel(c.task).state, "awaiting_deploy", "no workflow run yet");
    assert.equal(ok.store.ledger.length, 0);
    ok.repo.runs.push({
      head_sha: rel(c.task).merge_sha,
      path: ".github/workflows/deploy-jarvis-functions.yml",
      status: "in_progress",
      conclusion: null,
      html_url: "https://run/1",
    });
    await ok.run();
    assert.equal(rel(c.task).state, "awaiting_deploy");
    ok.repo.runs[0].status = "completed";
    ok.repo.runs[0].conclusion = "success";
    await ok.run();
    assert.equal(rel(c.task).state, "verified");
    assert.equal(ok.store.ledger.length, 1);
    assert.deepEqual(ok.store.ledger[0].metadata.functions, ["jarvis-worker"]);

    const bad = world();
    const d = bad.candidate({ files: workerFiles });
    bad.approve(d.task, d.pr);
    await bad.run();
    bad.repo.runs.push({
      head_sha: rel(d.task).merge_sha,
      path: ".github/workflows/deploy-jarvis-functions.yml",
      status: "completed",
      conclusion: "failure",
      html_url: "https://run/2",
    });
    await bad.run();
    assert.equal(rel(d.task).state, "deployment_failed");
    assert.equal(bad.store.ledger.length, 0, "a failed deployment is never recorded as a release");
    assert.ok(rel(d.task).rollback_pr, "rollback candidate prepared as a NEW PR");
    assert.equal(
      bad.store.inserted[0].metadata.release_policy,
      "requires_adam",
      "the rollback itself needs Adam",
    );
    assert.ok(bad.store.notifications.some((n) => /did not deploy/.test(n.title)));
    assert.equal(bad.repo.mergeCalls.length, 1, "the rollback is not merged automatically");
  },
);

await check("IDEMPOTENT: repeated and concurrent release attempts merge exactly once", async () => {
  const w = world();
  const c = w.candidate({ files: capNote });
  await Promise.all([w.run(), w.run(), w.run()]);
  await w.run();
  await w.run();
  assert.equal(w.repo.mergeCalls.length, 1);
  // Merged outside JARVIS (e.g. by Adam on GitHub): adopted, never merged again.
  const x = w.candidate({ files: emery });
  x.pr.merged = true;
  x.pr.state = "closed";
  x.pr.merge_commit_sha = sha(777);
  await w.run();
  assert.equal(w.repo.mergeCalls.length, 1);
  assert.equal(rel(x.task).merge_sha, sha(777));
});

await check(
  "STALE BASE: a candidate behind main is refreshed and re-tested, never merged; approval must be re-given",
  async () => {
    const w = world();
    const c = w.candidate({ files: emery, behind: 2 });
    w.approve(c.task, c.pr);
    await w.run();
    assert.equal(w.repo.mergeCalls.length, 0);
    assert.deepEqual(w.repo.updateCalls, [c.pr.number]);
    assert.equal(rel(c.task).state, "refreshing");
    await w.run();
    assert.equal(c.task.commit_sha, c.pr.head.sha, "tracks the refreshed, re-tested head");
    assert.equal(w.repo.mergeCalls.length, 0, "the old approval covered the old head");
  },
);

await check(
  "DAILY LIMIT: at most 3 automatic releases per day; Adam-approved releases are not limited",
  async () => {
    const w = world();
    const cs = [0, 1, 2, 3].map(() => w.candidate({ files: docs }));
    for (let i = 0; i < 5; i += 1) await w.run();
    assert.equal(w.repo.mergeCalls.length, 3);
    assert.equal(rel(cs[3].task).state, "daily_limit");
    w.approve(cs[3].task, cs[3].pr);
    cs[3].task.metadata.release_policy = "requires_adam";
    delete cs[3].task.metadata.release;
    await w.run();
    assert.equal(w.repo.mergeCalls.length, 4);
  },
);

await check(
  "REGRESSION WATCH: a runtime-error spike right after release prepares a rollback and notifies once",
  async () => {
    const w = world();
    const c = w.candidate({ files: capNote });
    await w.run();
    await w.run();
    w.state.served = rel(c.task).merge_sha;
    await w.run();
    assert.equal(rel(c.task).state, "verified");
    w.store.errors = 12;
    advance(16 * 60_000);
    await w.run();
    assert.equal(rel(c.task).state, "regression_detected");
    assert.ok(rel(c.task).rollback_pr);
    assert.ok(w.store.notifications.some((n) => /regression/i.test(n.title)));
  },
);

await check(
  "GATEWAY: merge is impossible without the one-shot release authorization (worker AND interactive gateway); authorization is pinned",
  async () => {
    const w = world();
    const c = w.candidate({ files: docs });
    const base = { token: "t", fetcher: w.repo.fetch };
    const req = (sha, extra = {}) => ({
      method: "PUT",
      path: `${REPO}/pulls/${c.pr.number}/merge`,
      body: { sha, merge_method: "merge", ...extra },
    });
    for (const proxy of [handleGithubProxy, edgeProxy]) {
      assert.equal((await proxy(req(c.head), base)).status, 403, "no authorization → refused");
      assert.equal(
        (await proxy(req(c.head), { ...base, releaseAuth: { pr: c.pr.number + 1, sha: c.head } }))
          .status,
        403,
        "other PR",
      );
      assert.equal(
        (await proxy(req(sha(1)), { ...base, releaseAuth: { pr: c.pr.number, sha: c.head } }))
          .status,
        403,
        "other sha",
      );
      assert.equal(
        (
          await proxy(req(c.head, { merge_method: "squash" }), {
            ...base,
            releaseAuth: { pr: c.pr.number, sha: c.head },
          })
        ).status,
        403,
        "merge commit only",
      );
      assert.equal(
        (
          await proxy(req(c.head, { admin: true }), {
            ...base,
            releaseAuth: { pr: c.pr.number, sha: c.head },
          })
        ).status,
        403,
        "unknown parameters",
      );
    }
    assert.equal(w.repo.mergeCalls.length, 0);
    // Authorization cannot override base/branch checks done at the chokepoint.
    const wrongBase = w.candidate({ files: docs, base: "release" });
    const auth = { pr: wrongBase.pr.number, sha: wrongBase.head };
    assert.equal(
      (
        await handleGithubProxy(
          {
            method: "PUT",
            path: `${REPO}/pulls/${wrongBase.pr.number}/merge`,
            body: { sha: wrongBase.head, merge_method: "merge" },
          },
          { ...base, releaseAuth: auth },
        )
      ).status,
      403,
    );
    const foreign = w.candidate({ files: docs, headRef: "feature/x" });
    assert.equal(
      (
        await handleGithubProxy(
          {
            method: "PUT",
            path: `${REPO}/pulls/${foreign.pr.number}/merge`,
            body: { sha: foreign.head, merge_method: "merge" },
          },
          { ...base, releaseAuth: { pr: foreign.pr.number, sha: foreign.head } },
        )
      ).status,
      403,
    );
    // A head that moved after authorization is refused at the gateway too.
    c.pr.head.sha = sha(4242);
    assert.equal(
      (
        await handleGithubProxy(req(c.head), {
          ...base,
          releaseAuth: { pr: c.pr.number, sha: c.head },
        })
      ).status,
      403,
    );
    assert.equal(w.repo.mergeCalls.length, 0);
    // Other dangerous writes stay refused.
    for (const bad of [
      { method: "DELETE", path: `${REPO}/git/refs/heads/main` },
      { method: "PATCH", path: `${REPO}/git/refs/heads/main`, body: { sha: "x" } },
      { method: "POST", path: "/graphql", body: { query: "mutation { x }" } },
    ])
      assert.equal((await handleGithubProxy(bad, { ...base })).status, 403, JSON.stringify(bad));
  },
);

await check(
  "helpers: PR number parsing; served-commit meta parsing; deploy workflow + config",
  async () => {
    assert.equal(prNumberFromUrl("https://github.com/x/y/pull/24"), 24);
    assert.equal(prNumberFromUrl(null), null);
    const html = '<meta name="emery-commit" content="8dd7081b5907fac617aeefbf7699b216b8abd0bf"/>';
    assert.equal(
      await servedCommitFrom("https://x", async () => new Response(html)),
      "8dd7081b5907fac617aeefbf7699b216b8abd0bf",
    );
    assert.equal(
      await servedCommitFrom(
        "https://x",
        async () => new Response('<meta name="emery-commit" content="unknown"/>'),
      ),
      null,
    );
    const { readFileSync } = await import("node:fs");
    const wf = readFileSync(
      new URL("../.github/workflows/deploy-jarvis-functions.yml", import.meta.url),
      "utf8",
    );
    assert.match(wf, /branches: \[main\]/);
    assert.doesNotMatch(wf, /pull_request/);
    assert.match(wf, /permissions:\s+contents: read/);
    assert.match(wf, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
    assert.equal(
      wf.split("secrets.SUPABASE_ACCESS_TOKEN").length - 1,
      1,
      "the token is referenced exactly once: the deploy step's env",
    );
    assert.match(wf, /supabase functions deploy "\$fn" --project-ref/);
    assert.match(wf, /ALLOWED="jarvis-worker jarvis-github jarvis-voice-lab"/);
    const cfg = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
    assert.match(cfg, /\[functions\.jarvis-worker\]\s+verify_jwt = false/);
  },
);

console.log(`\nJARVIS release operator validation: ${passed} checks passed.`);
