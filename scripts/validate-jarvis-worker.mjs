// Deterministic validation of the JARVIS Run 2 worker engine.
// Run: node --experimental-strip-types scripts/validate-jarvis-worker.mjs
// Uses an in-memory Store, a fake GitHub API (behind the REAL proxy allowlist),
// a fake isolated CI and a fake planner.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Engine,
  applyEdits,
  branchFor,
  classifyRisk,
} from "../supabase/functions/jarvis-worker/engine.ts";
import { GithubOps } from "../supabase/functions/jarvis-worker/github-ops.ts";
import { buildOpportunities } from "../supabase/functions/jarvis-worker/radar.ts";

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const OWNER = "owner-1";
const REPO = "/repos/Adamspersonalaiassistant/my-personal-ai";

// ------------------------------------------------------------------ clock
let clock = Date.parse("2026-10-06T14:00:00Z");
const now = () => new Date(clock);
const advance = (ms) => (clock += ms);
let idSeq = 0;
const uuid = () => {
  idSeq += 1;
  return `${idSeq.toString(16).padStart(8, "0")}-0000-4000-8000-${idSeq.toString(16).padStart(12, "0")}`;
};

// ------------------------------------------------------------- fake store
const IN_PROGRESS = [
  "queued",
  "validating",
  "researching",
  "planning",
  "building",
  "testing",
  "repairing",
];

class MemoryStore {
  constructor() {
    this.taskRows = [];
    this.sessions = [];
    this.events = [];
    this.findings = [];
    this.candidates = [];
    this.radar = { events: [], receipts: [], backlog: [], evaluations: [] };
    this.maxActiveSeen = 0;
    this.claimCalls = 0;
  }
  async ownerId() {
    return OWNER;
  }
  addTask(partial) {
    const row = {
      id: uuid(),
      user_id: OWNER,
      session_id: null,
      source_type: "adam",
      source_ref: null,
      title: "task",
      objective: null,
      why_it_matters: null,
      priority: 3,
      risk_level: "medium",
      status: "queued",
      branch_name: null,
      commit_sha: null,
      pr_url: null,
      test_results: {},
      result_summary: null,
      blocker: null,
      attempt_count: 0,
      task_spec: {},
      stage_state: {},
      metadata: {},
      dedupe_key: null,
      depends_on: [],
      merged_into: null,
      lease_token: null,
      lease_expires_at: null,
      leased_by: null,
      next_attempt_at: now().toISOString(),
      is_fixture: true,
      approval_state: "approved",
      created_at: new Date(clock + this.taskRows.length).toISOString(),
      completed_at: null,
      ...partial,
    };
    this.taskRows.push(row);
    return row;
  }
  async claim(workerId, limit) {
    this.claimCalls += 1;
    const t = now();
    const live = this.taskRows.filter(
      (r) => r.lease_expires_at && Date.parse(r.lease_expires_at) > t.getTime(),
    );
    let writers = live.filter((r) => r.task_spec?.kind === "code_change").length;
    const slots = Math.min(limit, 4 - live.length);
    const out = [];
    if (slots <= 0) return out;
    const runnable = this.taskRows
      .filter((r) =>
        [
          "queued",
          "validating",
          "researching",
          "planning",
          "building",
          "testing",
          "repairing",
        ].includes(r.status),
      )
      // Mirrors jarvis_claim_tasks: only approved tasks are ever claimed.
      .filter((r) => r.approval_state === "approved")
      .filter((r) => !r.lease_expires_at || Date.parse(r.lease_expires_at) < t.getTime())
      .filter((r) => Date.parse(r.next_attempt_at) <= t.getTime())
      // Mirrors jarvis_claim_tasks: wait only while a dependency is still in progress.
      // Terminal dependencies (merged, failed, blocked) are resolved by validation.
      .filter(
        (r) =>
          !r.depends_on.some((d) =>
            IN_PROGRESS.includes(this.taskRows.find((x) => x.id === d)?.status),
          ),
      )
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
    for (const r of runnable) {
      const writer = r.task_spec?.kind === "code_change";
      if (writer && writers >= 1) continue;
      r.lease_token = uuid();
      r.leased_by = workerId;
      r.lease_expires_at = new Date(t.getTime() + 240_000).toISOString();
      r.attempt_count += 1;
      out.push(structuredClone(r));
      if (writer) writers += 1;
      if (out.length >= slots) break;
    }
    const active = this.taskRows.filter(
      (r) => r.lease_expires_at && Date.parse(r.lease_expires_at) > t.getTime(),
    ).length;
    this.maxActiveSeen = Math.max(this.maxActiveSeen, active);
    return out;
  }
  async update(id, token, patch) {
    const r = this.taskRows.find((x) => x.id === id);
    if (!r || r.lease_token !== token) return false;
    Object.assign(r, structuredClone(patch));
    return true;
  }
  async release(id, token, patch) {
    return this.update(id, token, {
      ...patch,
      lease_token: null,
      lease_expires_at: null,
      leased_by: null,
    });
  }
  async tasks(f) {
    return this.taskRows
      .filter((r) => r.user_id === f.userId)
      .filter((r) => !f.statuses || f.statuses.includes(r.status))
      .filter((r) => !f.sinceIso || r.created_at >= f.sinceIso)
      .filter((r) => !f.ids || f.ids.includes(r.id))
      .filter((r) => !f.sessionId || r.session_id === f.sessionId)
      .map((r) => structuredClone(r));
  }
  async insertTask(row) {
    if (
      row.dedupe_key &&
      this.taskRows.some(
        (r) =>
          r.dedupe_key === row.dedupe_key &&
          [
            "queued",
            "validating",
            "researching",
            "planning",
            "building",
            "testing",
            "repairing",
            "blocked",
          ].includes(r.status),
      )
    )
      return { duplicate: true };
    return { id: this.addTask(row).id };
  }
  async openSession(userId, date) {
    return (
      this.sessions.find(
        (s) =>
          s.user_id === userId &&
          s.session_date === date &&
          ["queued", "running"].includes(s.status),
      ) ?? null
    );
  }
  async insertSession(row) {
    const s = { id: uuid(), metadata: {}, ...row };
    this.sessions.push(s);
    return s;
  }
  async updateSession(id, patch, expect) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s || (expect && s.status !== expect)) return false;
    Object.assign(s, patch);
    return true;
  }
  async runningSessions(userId) {
    return this.sessions.filter((s) => s.user_id === userId && s.status === "running");
  }
  // Mirrors jarvis_accept_task: a task is only counted against its own class
  // (production vs validation fixture); cancelled/deferred/merged never count.
  classCount(ids, fixture) {
    return this.taskRows.filter(
      (x) =>
        ids.includes(x.session_id) &&
        Boolean(x.is_fixture) === fixture &&
        x.approval_state === "approved" &&
        !["cancelled", "deferred"].includes(x.status) &&
        !x.merged_into,
    ).length;
  }
  async acceptedOn(userId, date) {
    const ids = this.sessions.filter((s) => s.session_date === date).map((s) => s.id);
    return this.classCount(ids, false);
  }
  async acceptInto(taskId, token, sessionId, date, limit) {
    // Synchronous body == atomic in this single-threaded fake (mirrors the advisory-locked SQL).
    const r = this.taskRows.find((x) => x.id === taskId);
    if (!r || r.lease_token !== token || r.session_id || r.approval_state !== "approved")
      return false;
    const ids = this.sessions.filter((s) => s.session_date === date).map((s) => s.id);
    const count = this.classCount(ids, Boolean(r.is_fixture));
    if (count >= limit) return false;
    r.session_id = sessionId;
    const session = this.sessions.find((s) => s.id === sessionId);
    if (r.is_fixture) session.metadata = { ...session.metadata, fixture_accepted: count + 1 };
    else session.accepted_count = count + 1;
    return true;
  }
  async count() {
    return 7;
  }
  async radarInputs() {
    return this.radar;
  }
  async lastEventAt(userId, type) {
    const e = [...this.events].reverse().find((x) => x.event_type === type);
    return e?.at ?? null;
  }
  async logEvent(userId, event) {
    this.events.push({ ...event, at: now().toISOString() });
  }
  async insertFinding(row) {
    this.findings.push(row);
  }
  async recordCandidate(row) {
    this.candidates.push(row);
  }
}

// ------------------------------------------------- fake GitHub + fake CI
class FakeGithub {
  constructor() {
    this.files = new Map([["main", null]]);
    this.commits = new Map();
    this.trees = new Map();
    this.refs = new Map();
    this.prs = [];
    this.calls = [];
    this.ciPendingOnce = new Set();
    const root = this.makeTree(null, {
      "src/lib/execution-capabilities.ts":
        'export const EMERY_EXECUTION_CAPABILITIES = {\n  google_calendar: { canExecute: false, note: "Google Calendar is not connected." },\n} as const;\n',
      "src/lib/emery/capability-registry.ts": "export const CAPABILITY_REGISTRY = {};\n",
      "src/lib/jarvis/fixtures/controlled.ts": "export const CONTROLLED_VALUE = 1;\n",
    });
    const c = this.makeCommit(root, [], "initial");
    this.refs.set("main", c);
  }
  makeTree(base, changes) {
    const files = { ...(base ? this.trees.get(base) : {}) };
    for (const [p, c] of Object.entries(changes)) files[p] = c;
    const id = `tree${this.trees.size + 1}`;
    this.trees.set(id, files);
    return id;
  }
  makeCommit(tree, parents, message) {
    const sha = `c${(this.commits.size + 1).toString().padStart(39, "0")}`;
    this.commits.set(sha, { sha, tree, parents, message });
    return sha;
  }
  filesAt(ref) {
    const sha = this.refs.get(ref) ?? ref;
    const commit = this.commits.get(sha);
    return commit ? this.trees.get(commit.tree) : null;
  }
  fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    this.calls.push({ method, path: u.pathname + u.search, body });
    const p = u.pathname.replace(REPO, "");
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    let m;
    if (method === "GET" && (m = p.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = this.refs.get(decodeURIComponent(m[1]));
      return sha ? json({ object: { sha } }) : json({ message: "Not Found" }, 404);
    }
    if (method === "POST" && p === "/git/refs") {
      const name = body.ref.replace("refs/heads/", "");
      if (this.refs.has(name)) return json({ message: "Reference already exists" }, 422);
      this.refs.set(name, body.sha);
      return json({ ref: body.ref }, 201);
    }
    if (method === "GET" && (m = p.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1]);
      return c ? json({ sha: c.sha, tree: { sha: c.tree }, message: c.message }) : json({}, 404);
    }
    if (method === "POST" && p === "/git/trees") {
      const changes = Object.fromEntries(body.tree.map((e) => [e.path, e.content]));
      return json({ sha: this.makeTree(body.base_tree, changes) }, 201);
    }
    if (method === "POST" && p === "/git/commits")
      return json({ sha: this.makeCommit(body.tree, body.parents, body.message) }, 201);
    if (method === "PATCH" && (m = p.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const name = decodeURIComponent(m[1]);
      const next = this.commits.get(body.sha);
      if (body.force) return json({ message: "force not expected" }, 400);
      if (!next || next.parents[0] !== this.refs.get(name))
        return json({ message: "Update is not a fast forward" }, 422);
      this.refs.set(name, body.sha);
      return json({ ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }
    if (method === "GET" && (m = p.match(/^\/contents\/(.+)$/))) {
      const files = this.filesAt(u.searchParams.get("ref"));
      const content = files?.[decodeURIComponent(m[1])];
      return content == null
        ? json({ message: "Not Found" }, 404)
        : new Response(content, { status: 200 });
    }
    if (method === "GET" && (m = p.match(/^\/git\/trees\/(.+)$/))) {
      const files = this.filesAt(decodeURIComponent(m[1]));
      return json({
        tree: Object.keys(files ?? {}).map((path) => ({ path, type: "blob", size: 10 })),
      });
    }
    if (method === "GET" && this.checksForbidden && /^\/commits\/\w+\/check-runs$/.test(p))
      return json({ message: "Resource not accessible by personal access token" }, 403);
    if (method === "GET" && (m = p.match(/^\/commits\/(\w+)\/status$/))) {
      // Commit statuses published by the workflow's code-free report job.
      const sha = m[1];
      if (!this.ciPendingOnce.has(sha)) {
        this.ciPendingOnce.add(sha);
        return json({ state: "pending", statuses: [] });
      }
      const broken = Object.entries(this.filesAt(sha) ?? {}).filter(([, c]) =>
        String(c).includes("BROKEN_TYPE_ERROR"),
      );
      const statuses = broken.map(([path], i) => ({
        context: `jarvis-candidate/e${i + 1}`,
        state: "failure",
        description: `${path}:1 TS2322: Type 'string' is not assignable to type 'number'.`,
      }));
      statuses.push({
        context: "jarvis-candidate",
        state: broken.length ? "failure" : "success",
        description: broken.length ? "Failed: typecheck" : "All candidate checks passed",
        target_url: `https://ci/${sha}`,
      });
      return json({ state: broken.length ? "failure" : "success", statuses });
    }
    if (method === "GET" && (m = p.match(/^\/commits\/(\w+)\/check-runs$/))) {
      const sha = m[1];
      if (!this.ciPendingOnce.has(sha)) {
        this.ciPendingOnce.add(sha);
        return json({
          check_runs: [
            { id: 1, name: "jarvis-candidate", status: "in_progress", conclusion: null },
          ],
        });
      }
      const broken = Object.entries(this.filesAt(sha) ?? {}).filter(([, c]) =>
        String(c).includes("BROKEN_TYPE_ERROR"),
      );
      return json({
        check_runs: [
          {
            id: broken.length ? 900 + this.commits.size : 1,
            name: "jarvis-candidate",
            status: "completed",
            conclusion: broken.length ? "failure" : "success",
            html_url: `https://ci/${sha}`,
          },
        ],
      });
    }
    if (method === "GET" && (m = p.match(/^\/check-runs\/(\d+)\/annotations$/))) {
      // Report the broken file from the most recent failing commit.
      const latest = [...this.commits.values()]
        .reverse()
        .find((c) =>
          Object.values(this.trees.get(c.tree)).some((x) =>
            String(x).includes("BROKEN_TYPE_ERROR"),
          ),
        );
      const files = latest ? this.trees.get(latest.tree) : {};
      return json(
        Object.entries(files)
          .filter(([, c]) => String(c).includes("BROKEN_TYPE_ERROR"))
          .map(([path]) => ({
            path,
            start_line: 1,
            title: "TS2322",
            message: "Type 'string' is not assignable to type 'number'.",
          })),
      );
    }
    if (method === "GET" && p.startsWith("/pulls")) {
      const head = u.searchParams.get("head")?.split(":")[1];
      return json(this.prs.filter((pr) => pr.head === head));
    }
    if (method === "POST" && p === "/pulls") {
      const pr = {
        number: this.prs.length + 100,
        html_url: `https://github.com/pr/${this.prs.length + 100}`,
        head: body.head,
      };
      this.prs.push(pr);
      return json(pr, 201);
    }
    return json({ message: `fake: unhandled ${method} ${p}` }, 404);
  };
}

class FakePlanner {
  constructor() {
    this.calls = [];
  }
  async planEdits(input) {
    this.calls.push({ kind: "plan", objective: input.objective });
    const target = input.files.find((f) => f.path.endsWith("execution-capabilities.ts"));
    return {
      summary: "Register Apple Reminders as not connected",
      edits: [
        {
          path: target.path,
          find: "} as const;",
          replace:
            '  apple_reminders: { canExecute: false, note: "Apple Reminders is not connected." },\n} as const;',
        },
      ],
    };
  }
  async repair(input) {
    this.calls.push({ kind: "repair", failures: input.failures.length });
    const broken = input.files.find((f) => f.content.includes("BROKEN_TYPE_ERROR"));
    return {
      summary: "Fix type error",
      edits: [
        {
          path: broken.path,
          find: 'const value: number = "BROKEN_TYPE_ERROR";',
          replace: "const value: number = 1;",
        },
      ],
    };
  }
  async research(question) {
    this.calls.push({ kind: "research", question });
    return {
      answer: "- Use leases with fencing tokens.\nRecommendation: keep SKIP LOCKED claims.",
      sources: ["https://example.org/queues"],
    };
  }
}

function makeEngine(store, gh, planner, extra = {}) {
  return new Engine({
    store,
    github: gh ? new GithubOps({ token: "test-token", fetcher: gh.fetch }) : null,
    planner,
    workerId: extra.workerId ?? "w1",
    now,
    budgetMs: 100_000,
    ...extra,
  });
}

async function drive(store, gh, planner, ticks = 12) {
  for (let i = 0; i < ticks; i += 1) {
    await makeEngine(store, gh, planner).tick();
    advance(61_000);
  }
}

const stages = (store, id) =>
  store.events
    .filter((e) => e.event_type === "jarvis_worker" && e.metadata?.task_id === id)
    .map((e) => e.action);

// ------------------------------------------------------------------ tests

await check("shared guards/proxy copies are byte-identical across app, gateway and worker", () => {
  const g = readFileSync("src/lib/jarvis/guards.ts", "utf8");
  assert.equal(readFileSync("supabase/functions/jarvis-github/guards.ts", "utf8"), g);
  assert.equal(readFileSync("supabase/functions/jarvis-worker/guards.ts", "utf8"), g);
  assert.equal(
    readFileSync("supabase/functions/jarvis-worker/proxy.ts", "utf8"),
    readFileSync("supabase/functions/jarvis-github/proxy.ts", "utf8"),
  );
});

await check(
  "acceptance 1: harmless scheduled task runs queued → validating → researching → testing → completed",
  async () => {
    const store = new MemoryStore();
    const t = store.addTask({
      title: "Verify telemetry is flowing",
      task_spec: {
        kind: "diagnostic",
        checks: [{ type: "db_count", table: "emery_runtime_events", days: 7 }, { type: "noop" }],
      },
    });
    await makeEngine(store, null, null).tick();
    const row = store.taskRows.find((r) => r.id === t.id);
    assert.equal(row.status, "completed");
    assert.deepEqual(stages(store, t.id), [
      "queued->validating",
      "validating->researching",
      "researching->testing",
      "testing->completed",
    ]);
    assert.match(row.result_summary, /db_count=7/);
    assert.equal(row.lease_token, null);
  },
);

await check(
  "acceptance 2+9: controlled code change — branch EARLY, checkpoint, edit, isolated CI, PR, candidate recorded (direct GitHub only)",
  async () => {
    const store = new MemoryStore();
    const gh = new FakeGithub();
    const t = store.addTask({
      title: "Controlled change: bump fixture value",
      task_spec: {
        kind: "code_change",
        objective: "Set CONTROLLED_VALUE to 2",
        edits: [
          {
            path: "src/lib/jarvis/fixtures/controlled.ts",
            find: "CONTROLLED_VALUE = 1",
            replace: "CONTROLLED_VALUE = 2",
          },
        ],
      },
    });
    await drive(store, gh, null, 4);
    const row = store.taskRows.find((r) => r.id === t.id);
    assert.equal(row.status, "ready_for_release", JSON.stringify(row.stage_state.log, null, 1));
    const order = stages(store, t.id);
    assert.ok(
      order.indexOf("planning->building") < order.indexOf("building->testing"),
      "branch + checkpoint before edit",
    );
    const branch = branchFor(row);
    assert.equal(row.branch_name, branch);
    assert.ok(
      gh.filesAt(branch)["src/lib/jarvis/fixtures/controlled.ts"].includes("CONTROLLED_VALUE = 2"),
    );
    assert.ok(
      gh.filesAt(branch)[`docs/jarvis-engineer/candidates/${row.id.slice(0, 8)}.md`],
      "change package doc committed",
    );
    assert.equal(
      gh.filesAt("main")["src/lib/jarvis/fixtures/controlled.ts"],
      "export const CONTROLLED_VALUE = 1;\n",
      "main untouched",
    );
    assert.equal(gh.prs.length, 1);
    assert.match(row.pr_url, /github.com\/pr/);
    assert.equal(store.candidates.length, 1);
    assert.equal(store.candidates[0].deployment_verified, false);
    assert.equal(store.candidates[0].metadata.kind, "candidate");
    assert.ok(
      !gh.calls.some((c) => c.method === "PATCH" && /heads\/main/.test(c.path)),
      "no main writes",
    );
    assert.ok(!gh.calls.some((c) => c.body?.force === true), "no force updates");
  },
);

await check(
  "acceptance 3: controlled test failure → detected from CI annotations → bounded repair → CI rerun passes",
  async () => {
    const store = new MemoryStore();
    const gh = new FakeGithub();
    const planner = new FakePlanner();
    const t = store.addTask({
      title: "Repair fixture",
      task_spec: {
        kind: "code_change",
        objective: "Add a typed fixture constant",
        edits: [
          {
            path: "src/lib/jarvis/fixtures/controlled.ts",
            find: "CONTROLLED_VALUE = 1",
            replace: "CONTROLLED_VALUE = 3",
          },
        ],
        inject_failure: {
          path: "src/lib/jarvis/fixtures/repair-fixture.ts",
          content:
            'export const value: number = "BROKEN_TYPE_ERROR";\n'.replace(
              "export const value",
              "const value",
            ) + "export { value };\n",
        },
        max_repairs: 2,
      },
    });
    await drive(store, gh, planner, 7);
    const row = store.taskRows.find((r) => r.id === t.id);
    assert.equal(row.status, "ready_for_release", JSON.stringify(row.stage_state.log, null, 1));
    assert.equal(row.stage_state.repairs, 1);
    assert.ok(planner.calls.some((c) => c.kind === "repair" && c.failures > 0));
    assert.deepEqual(
      row.test_results.ci.map((c) => c.state),
      ["failure", "success"],
    );
    assert.ok(
      !gh
        .filesAt(row.branch_name)
        ["src/lib/jarvis/fixtures/repair-fixture.ts"].includes("BROKEN_TYPE_ERROR"),
    );
  },
);

await check(
  "CI fallback: token without Checks: read → commit statuses drive failure detection and repair",
  async () => {
    const store = new MemoryStore();
    const gh = new FakeGithub();
    gh.checksForbidden = true;
    const planner = new FakePlanner();
    const t = store.addTask({
      title: "Repair via statuses",
      task_spec: {
        kind: "code_change",
        objective: "Add a typed fixture constant",
        edits: [
          {
            path: "src/lib/jarvis/fixtures/controlled.ts",
            find: "CONTROLLED_VALUE = 1",
            replace: "CONTROLLED_VALUE = 4",
          },
        ],
        inject_failure: {
          path: "src/lib/jarvis/fixtures/repair-fixture.ts",
          content: 'const value: number = "BROKEN_TYPE_ERROR";\nexport { value };\n',
        },
        max_repairs: 2,
      },
    });
    await drive(store, gh, planner, 7);
    const row = store.taskRows.find((r) => r.id === t.id);
    assert.equal(row.status, "ready_for_release", JSON.stringify(row.stage_state.log, null, 1));
    assert.equal(row.stage_state.repairs, 1);
    const repair = planner.calls.find((c) => c.kind === "repair");
    assert.ok(repair && repair.failures > 0, "repair received status-derived failures");
    assert.deepEqual(
      row.test_results.ci.map((c) => c.state),
      ["failure", "success"],
    );
    assert.ok(gh.calls.some((c) => c.path.endsWith("/status")));
  },
);

await check("repair is bounded: persistent failure ends in failed with evidence", async () => {
  const store = new MemoryStore();
  const gh = new FakeGithub();
  const stubborn = {
    ...new FakePlanner(),
    research: async () => ({ answer: "", sources: [] }),
    planEdits: async () => ({ summary: "", edits: [] }),
    repair: async (input) => ({
      summary: "no-op",
      edits: [
        {
          path: input.files[0].path,
          find: input.files[0].content.slice(0, 10),
          replace: input.files[0].content.slice(0, 10),
        },
      ],
    }),
  };
  const t = store.addTask({
    title: "Unfixable fixture",
    task_spec: {
      kind: "code_change",
      objective: "x",
      edits: [
        {
          path: "src/lib/jarvis/fixtures/broken.ts",
          create: true,
          content: 'const value: number = "BROKEN_TYPE_ERROR";\nexport { value };\n',
        },
      ],
      max_repairs: 1,
    },
  });
  await drive(store, gh, stubborn, 8);
  const row = store.taskRows.find((r) => r.id === t.id);
  assert.equal(row.status, "failed");
  assert.match(row.blocker, /still failing after 1 bounded repair/);
});

await check(
  "acceptance 4+5+11+12: session ends with ONE finalize, self-research finding and ready-for-more state",
  async () => {
    const store = new MemoryStore();
    const planner = new FakePlanner();
    store.addTask({ title: "Diag A", task_spec: { kind: "diagnostic" } });
    store.addTask({ title: "Diag B", task_spec: { kind: "diagnostic" } });
    await makeEngine(store, null, planner).tick();
    await makeEngine(store, null, planner).tick();
    assert.equal(store.sessions.length, 1);
    const s = store.sessions[0];
    assert.equal(s.status, "completed");
    assert.equal(s.completed_count, 2);
    assert.equal(s.metadata.ready_for_more_tasks, true);
    assert.ok(s.self_research_summary.length > 20);
    assert.equal(store.findings.length, 1, "exactly one self-research finding per session");
    assert.equal(store.findings[0].metadata.kind, "jarvis_self_improvement");
    assert.equal(s.metadata.capacity_review.current, 50);
  },
);

await check(
  "acceptance 6+13a: Emery capability-gap evidence → Opportunity Radar → JARVIS code_change task (deduplicated)",
  async () => {
    const store = new MemoryStore();
    const gap = (i) => ({
      event_type: "capability_gap",
      status: "error",
      action: "emery_turn",
      domain: "personal",
      metadata: {
        signal: "capability_gap",
        capability: "apple_reminders",
        request: "Add milk to my Apple Reminders",
        observed: "Emery implied it was added",
        fixture: true,
        severity: 4,
        confidence: 0.9,
      },
      created_at: new Date(clock - i * 1000).toISOString(),
    });
    store.radar.events = [gap(1), gap(2), gap(3)];
    const opps = buildOpportunities(store.radar);
    assert.equal(opps[0].signal, "capability_gap");
    assert.equal(opps[0].kind, "code_change");
    assert.ok(opps[0].score >= 6, String(opps[0].score));
    const engine = makeEngine(store, null, null, { forceRadar: true });
    await engine.runRadar(OWNER);
    await makeEngine(store, null, null, { forceRadar: true }).runRadar(OWNER);
    const radarTasks = store.taskRows.filter((r) => r.source_type === "opportunity_radar");
    assert.equal(radarTasks.length, 1, "second radar run must not duplicate");
    assert.equal(radarTasks[0].task_spec.kind, "code_change");
    assert.deepEqual(radarTasks[0].task_spec.target_paths, [
      "src/lib/execution-capabilities.ts",
      "src/lib/emery/capability-registry.ts",
    ]);
    assert.ok(radarTasks[0].metadata.radar.evidence.length >= 3);
  },
);

await check(
  "acceptance 13: closed loop — Emery gap → radar task → branch → planned edit → isolated CI → PR → candidate release",
  async () => {
    const store = new MemoryStore();
    const gh = new FakeGithub();
    const planner = new FakePlanner();
    store.radar.events = [1, 2, 3].map((i) => ({
      event_type: "capability_gap",
      status: "error",
      action: "emery_turn",
      domain: "personal",
      metadata: {
        signal: "capability_gap",
        capability: "apple_reminders",
        request: "Add milk to my Apple Reminders",
        fixture: true,
        severity: 4,
        confidence: 0.9,
      },
      created_at: new Date(clock - i).toISOString(),
    }));
    await makeEngine(store, gh, planner, { forceRadar: true }).tick();
    for (let i = 0; i < 5; i += 1) {
      advance(61_000);
      await makeEngine(store, gh, planner).tick();
    }
    const task = store.taskRows.find((r) => r.source_type === "opportunity_radar");
    assert.equal(task.status, "ready_for_release", JSON.stringify(task.stage_state.log, null, 1));
    assert.ok(
      gh.filesAt(task.branch_name)["src/lib/execution-capabilities.ts"].includes("apple_reminders"),
    );
    assert.equal(store.candidates[0].source_pr_url, task.pr_url);
    assert.equal(store.sessions[0].status, "completed");
    assert.equal(
      store.sessions[0].approval_required,
      true,
      "candidate awaits Adam's release review",
    );
  },
);

await check(
  "acceptance 7: 50-task fixture — durable intake, duplicates merged, dependencies ordered, bounded concurrency, capacity ceiling",
  async () => {
    const store = new MemoryStore();
    const base = [];
    for (let i = 0; i < 40; i += 1)
      base.push(
        store.addTask({
          title: `Fixture check ${i}`,
          priority: 3,
          task_spec: { kind: "diagnostic", checks: [{ type: "noop" }] },
        }),
      );
    for (let i = 0; i < 5; i += 1)
      store.addTask({ title: `Fixture check ${i}`, task_spec: { kind: "diagnostic" } }); // duplicates
    const deps = [];
    for (let i = 0; i < 5; i += 1)
      deps.push(
        store.addTask({
          title: `Dependent ${i}`,
          priority: 1,
          depends_on: [base[30 + i].id],
          task_spec: { kind: "diagnostic" },
        }),
      );
    // Merged duplicates free their slot, so six more distinct tasks queue behind: only five fit.
    const overs = [];
    for (let i = 0; i < 6; i += 1)
      overs.push(
        store.addTask({
          title: `Over capacity ${51 + i}`,
          priority: 5,
          task_spec: { kind: "diagnostic" },
        }),
      );
    await drive(store, null, null, 6);
    // Merged duplicates are not real tasks and never consume capacity.
    const accepted = store.taskRows.filter((r) => r.session_id && !r.merged_into);
    assert.equal(accepted.length, 50, "exactly 50 accepted today");
    assert.equal(store.taskRows.filter((r) => r.merged_into).length, 5, "5 duplicates merged");
    for (const d of deps) {
      const dep = store.taskRows.find((r) => r.id === d.depends_on[0]);
      const row = store.taskRows.find((r) => r.id === d.id);
      assert.equal(row.status, "completed");
      assert.ok(row.completed_at >= dep.completed_at, "dependent completed after its dependency");
    }
    const held = overs
      .map((t) => store.taskRows.find((r) => r.id === t.id))
      .filter((r) => !r.session_id);
    assert.equal(held.length, 1, "the 51st distinct task is held");
    assert.equal(held[0].status, "queued");
    assert.ok(Date.parse(held[0].next_attempt_at) > clock, "held until the next day");
    assert.ok(store.maxActiveSeen <= 4, `max concurrent leases ${store.maxActiveSeen}`);
    assert.equal(
      store.taskRows.filter((r) => r.session_id && !["completed", "cancelled"].includes(r.status))
        .length,
      0,
    );
  },
);

await check(
  "duplicates with identical timestamps merge one way only (parallel validation)",
  async () => {
    const store = new MemoryStore();
    const a = store.addTask({ title: "Same batch task", task_spec: { kind: "diagnostic" } });
    const b = store.addTask({ title: "Same batch task", task_spec: { kind: "diagnostic" } });
    b.created_at = a.created_at; // one multi-row insert
    await Promise.all([
      makeEngine(store, null, null, { workerId: "p1" }).tick(),
      makeEngine(store, null, null, { workerId: "p2" }).tick(),
    ]);
    advance(61_000);
    await drive(store, null, null, 2);
    const rows = [a, b].map((t) => store.taskRows.find((r) => r.id === t.id));
    const merged = rows.filter((r) => r.merged_into);
    assert.equal(merged.length, 1, JSON.stringify(rows.map((r) => [r.status, r.merged_into])));
    assert.equal(rows.filter((r) => r.status === "completed").length, 1);
  },
);

await check("capacity eligibility counts real work only, never fixtures", async () => {
  const review = async (isFixture) => {
    const store = new MemoryStore();
    for (let i = 0; i < 42; i += 1)
      store.addTask({
        title: `Capacity probe ${i}`,
        is_fixture: isFixture,
        task_spec: { kind: "diagnostic" },
      });
    await drive(store, null, null, 6);
    return store.sessions[0].metadata.capacity_review;
  };
  const fixtures = await review(true);
  assert.equal(fixtures.real_tasks, 0);
  assert.equal(fixtures.eligible_for_increase, false);
  const real = await review(false);
  assert.equal(real.real_tasks, 42);
  assert.equal(real.eligible_for_increase, true);
  assert.equal(real.recommended, 50, "eligibility alone never changes the number");
});

await check("a re-run of a failed task executes instead of merging into the failure", async () => {
  const store = new MemoryStore();
  const failed = store.addTask({
    title: "Run 2 fixture A2: controlled source change",
    status: "failed",
    task_spec: { kind: "diagnostic" },
  });
  const rerun = store.addTask({
    title: "Run 2 fixture B2: controlled source change",
    task_spec: { kind: "diagnostic" },
  });
  const twin = store.addTask({
    title: "Run 2 fixture B2: controlled source change",
    task_spec: { kind: "diagnostic" },
  });
  await drive(store, null, new FakePlanner(), 3);
  const row = (id) => store.taskRows.find((r) => r.id === id);
  assert.equal(row(rerun.id).merged_into, null);
  assert.equal(row(rerun.id).status, "completed");
  assert.equal(
    row(twin.id).merged_into,
    rerun.id,
    "a genuine duplicate of the open re-run still merges",
  );
  assert.equal(row(failed.id).status, "failed");
});

await check("dependency on a failed task blocks the dependent instead of running it", async () => {
  const store = new MemoryStore();
  const a = store.addTask({
    title: "Will fail",
    task_spec: { kind: "diagnostic", checks: [{ type: "db_count", table: "auth_users" }] },
  });
  const b = store.addTask({
    title: "Needs A",
    depends_on: [a.id],
    task_spec: { kind: "diagnostic" },
  });
  await drive(store, null, null, 3);
  assert.equal(store.taskRows.find((r) => r.id === a.id).status, "failed");
  // b waits while a runs, then is surfaced as blocked — never left silently queued.
  const row = store.taskRows.find((r) => r.id === b.id);
  assert.equal(row.status, "blocked");
  assert.match(row.blocker, /Dependency did not complete: Will fail/);
});

await check("a dependency merged as a duplicate is rewired to the surviving task", async () => {
  const store = new MemoryStore();
  const original = store.addTask({
    title: "Shared prerequisite",
    task_spec: { kind: "diagnostic" },
  });
  const twin = store.addTask({ title: "Shared prerequisite", task_spec: { kind: "diagnostic" } });
  const dependent = store.addTask({
    title: "Needs the prerequisite",
    depends_on: [twin.id],
    task_spec: { kind: "diagnostic" },
  });
  await drive(store, null, null, 4);
  const row = (id) => store.taskRows.find((r) => r.id === id);
  assert.equal(row(twin.id).merged_into, original.id);
  assert.deepEqual(row(dependent.id).depends_on, [original.id]);
  assert.equal(row(dependent.id).status, "completed");
  assert.ok(row(dependent.id).completed_at >= row(original.id).completed_at);
});

await check(
  "acceptance 8: restart/retry — crash after commit is not re-executed; stale worker is fenced; parallel ticks never double-run",
  async () => {
    const store = new MemoryStore();
    const gh = new FakeGithub();
    const t = store.addTask({
      title: "Crash fixture",
      task_spec: {
        kind: "code_change",
        objective: "x",
        edits: [{ path: "src/lib/jarvis/fixtures/controlled.ts", find: "= 1", replace: "= 4" }],
      },
    });
    await makeEngine(store, gh, null).tick(); // runs through planning + build, then waits on CI
    const row = store.taskRows.find((r) => r.id === t.id);
    assert.equal(row.status, "testing", JSON.stringify(row.stage_state.log, null, 1));
    const buildMarker = `[jarvis-task ${t.id.slice(0, 8)} build]`;
    const buildCommitsBefore = [...gh.commits.values()].filter((c) =>
      c.message.includes(buildMarker),
    ).length;
    assert.equal(buildCommitsBefore, 1);
    // Simulate: the build commit landed on GitHub but the worker crashed before recording it.
    row.status = "building";
    row.stage_state = { ...row.stage_state, ci_sha: undefined };
    row.next_attempt_at = now().toISOString();
    const restarted = makeEngine(store, gh, null, { workerId: "w2" });
    await restarted.tick();
    const after = store.taskRows.find((r) => r.id === t.id);
    const buildCommitsAfter = [...gh.commits.values()].filter((c) =>
      c.message.includes(buildMarker),
    );
    assert.equal(buildCommitsAfter.length, 1, "retry reused the existing build commit");
    assert.equal(after.status, "testing");
    assert.equal(after.stage_state.ci_sha, buildCommitsAfter[0].sha);

    // Fencing: a worker whose lease expired cannot write over the new owner.
    const s1 = new MemoryStore();
    const f = s1.addTask({ title: "Fence fixture", task_spec: { kind: "diagnostic" } });
    const [first] = await s1.claim("old", 1);
    advance(300_000); // lease expires (worker "old" froze)
    const [second] = await s1.claim("new", 1);
    assert.equal(second.id, f.id);
    assert.equal(
      await s1.update(f.id, first.lease_token, { status: "completed" }),
      false,
      "stale token rejected",
    );
    assert.equal(await s1.update(f.id, second.lease_token, { status: "validating" }), true);

    // Duplicate scheduler invocation: two engines tick concurrently.
    const s2 = new MemoryStore();
    for (let i = 0; i < 12; i += 1)
      s2.addTask({ title: `Parallel ${i}`, task_spec: { kind: "diagnostic" } });
    await Promise.all([
      makeEngine(s2, null, null, { workerId: "a" }).tick(),
      makeEngine(s2, null, null, { workerId: "b" }).tick(),
    ]);
    for (const r of s2.taskRows) {
      const completions = s2.events.filter(
        (e) => e.metadata?.task_id === r.id && e.action === "testing->completed",
      ).length;
      assert.equal(completions, 1, `task ${r.title} completed ${completions} times`);
    }
    assert.ok(s2.maxActiveSeen <= 4);
  },
);

await check(
  "acceptance 9b: paid-credit fixture stops for Adam's approval without any GitHub call",
  async () => {
    const store = new MemoryStore();
    const gh = new FakeGithub();
    const t = store.addTask({
      title: "Use Lovable AI credits to generate the new settings page",
      task_spec: {
        kind: "code_change",
        objective: "Have Lovable AI generate it",
        target_paths: ["src/routes/_authenticated/settings.tsx"],
      },
    });
    const before = gh.calls.length;
    await makeEngine(store, gh, new FakePlanner()).tick();
    const row = store.taskRows.find((r) => r.id === t.id);
    assert.equal(row.status, "blocked");
    assert.match(row.blocker, /Free-first policy/);
    assert.equal(gh.calls.length, before);
  },
);

await check("risk policy blocks protected HPO/auth/migration edits for Adam approval", () => {
  assert.ok(
    classifyRisk({
      title: "x",
      objective: "",
      task_spec: { kind: "code_change", target_paths: ["supabase/migrations/x.sql"] },
    }).approval,
  );
  assert.ok(
    classifyRisk({
      title: "x",
      objective: "",
      task_spec: { kind: "code_change", target_paths: ["src/lib/hpo-route.functions.ts"] },
    }).approval,
  );
  assert.ok(
    classifyRisk({
      title: "x",
      objective: "",
      task_spec: { kind: "code_change", target_paths: ["src/integrations/supabase/client.ts"] },
    }).approval,
  );
  assert.equal(
    classifyRisk({
      title: "x",
      objective: "",
      task_spec: { kind: "code_change", target_paths: ["src/lib/execution-capabilities.ts"] },
    }).approval,
    null,
  );
  assert.throws(
    () =>
      applyEdits(new Map([[".github/workflows/x.yml", "a"]]), [
        { path: ".github/workflows/x.yml", find: "a", replace: "b" },
      ]),
    /protected|outside/,
  );
  assert.throws(
    () =>
      applyEdits(new Map([["src/a.ts", "x"]]), [
        { path: "src/a.ts", find: "x", replace: `k="${["sk", "proj", "a".repeat(28)].join("-")}"` },
      ]),
    /credential/,
  );
});

// ------------------------------------------------------------------------
// Production capacity accounting + approval semantics.
// ------------------------------------------------------------------------

const { countsTowardCapacity } = await import("../supabase/functions/jarvis-worker/engine.ts");

await check(
  "capacity accounting: a 50-task load-test fixture never consumes production capacity, and fixture evidence is preserved",
  async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 50; i += 1)
      store.addTask({ title: `Load fixture ${i}`, task_spec: { kind: "diagnostic" } });
    await drive(store, null, null, 4);
    const fixtures = store.taskRows.filter((r) => r.is_fixture);
    assert.equal(fixtures.filter((r) => r.session_id).length, 50, "fixtures were processed");
    assert.equal(fixtures.filter((r) => r.status === "completed").length, 50, "evidence preserved");
    assert.equal(store.taskRows.filter(countsTowardCapacity).length, 0, "production counter 0/50");
    assert.equal(await store.acceptedOn(OWNER, "2026-10-06"), 0);
    // Real approved work still gets all 50 of its own slots afterwards.
    for (let i = 0; i < 3; i += 1)
      store.addTask({
        title: `Real task ${i}`,
        is_fixture: false,
        task_spec: { kind: "diagnostic" },
      });
    await drive(store, null, null, 4);
    assert.equal(store.taskRows.filter(countsTowardCapacity).length, 3);
    assert.equal(store.sessions.at(-1).accepted_count, 3, "session counts production tasks only");
    assert.equal(
      store.sessions[0].accepted_count,
      0,
      "the fixture session shows 0 production tasks",
    );
  },
);

await check(
  "capacity accounting: proposed tasks never run, never count; approval makes them eligible; cancelled/superseded do not count; midnight rollover resets",
  async () => {
    const store = new MemoryStore();
    const proposed = [];
    for (let i = 0; i < 20; i += 1)
      proposed.push(
        store.addTask({
          title: `Proposed ${i}`,
          is_fixture: false,
          approval_state: "proposed",
          task_spec: { kind: "diagnostic" },
        }),
      );
    await drive(store, null, null, 4);
    assert.equal(
      proposed.every((t) => {
        const r = store.taskRows.find((x) => x.id === t.id);
        return r.status === "queued" && !r.session_id && r.attempt_count === 0;
      }),
      true,
      "the worker cannot execute an unapproved proposed task",
    );
    assert.equal(store.taskRows.filter(countsTowardCapacity).length, 0, "20 proposed = 0/50");
    for (const t of proposed) store.taskRows.find((x) => x.id === t.id).approval_state = "approved";
    await drive(store, null, null, 6);
    assert.equal(store.taskRows.filter(countsTowardCapacity).length, 20, "approved = 20/50");
    // 5 cancelled → they stop counting (documented policy: cancelled never consumes capacity).
    for (const t of proposed.slice(0, 5))
      store.taskRows.find((x) => x.id === t.id).status = "cancelled";
    assert.equal(store.taskRows.filter(countsTowardCapacity).length, 15);
    for (const t of proposed.slice(5, 7)) {
      const r = store.taskRows.find((x) => x.id === t.id);
      r.approval_state = "superseded";
      r.status = "cancelled";
    }
    assert.equal(store.taskRows.filter(countsTowardCapacity).length, 13);
    // Midnight Eastern: tomorrow's intake starts at 0 while history is untouched.
    advance(24 * 3600_000);
    assert.equal(await store.acceptedOn(OWNER, "2026-10-07"), 0);
    assert.equal(store.taskRows.length, 20, "no history deleted");
  },
);

await check(
  "capacity accounting: Opportunity Radar findings are proposals and consume no capacity until approved",
  async () => {
    const store = new MemoryStore();
    const gap = (i) => ({
      event_type: "capability_gap",
      status: "error",
      action: "emery_turn",
      domain: "personal",
      metadata: {
        signal: "capability_gap",
        capability: "apple_notes",
        request: "Save this to Apple Notes",
        observed: "Emery implied it was saved",
        severity: 4,
        confidence: 0.9,
      },
      created_at: new Date(clock - i * 1000).toISOString(),
    });
    store.radar.events = [gap(1), gap(2), gap(3)];
    await makeEngine(store, null, null, { forceRadar: true }).runRadar(OWNER);
    const found = store.taskRows.filter((r) => r.source_type === "opportunity_radar");
    assert.equal(found.length, 1);
    assert.equal(found[0].approval_state, "proposed");
    assert.equal(found[0].is_fixture ?? false, false);
    await drive(store, null, null, 4);
    const row = store.taskRows.find((r) => r.id === found[0].id);
    assert.equal(row.session_id, null, "an unapproved radar task is never accepted");
    assert.equal(store.taskRows.filter(countsTowardCapacity).length, 0);
  },
);

console.log(`\nJARVIS worker validation: ${passed} checks passed.`);
