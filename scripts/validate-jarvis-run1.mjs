// Focused, deterministic validation for JARVIS Engineer Run 1.
// Run: node --experimental-strip-types scripts/validate-jarvis-run1.mjs
import assert from "node:assert/strict";
import {
  assessPaidCreditRequest,
  assertCandidateBranch,
  assertSafeContent,
  assertSafeRepoPath,
  evaluateToolPolicy,
  redactSecrets,
} from "../src/lib/jarvis/policy.ts";
import { getJarvisTool, JARVIS_TOOLS } from "../src/lib/jarvis/tool-registry.ts";
import {
  extractKnowledgeCandidates,
  findSuperseded,
  rankKnowledge,
  sensitiveReason,
} from "../src/lib/jarvis/knowledge.ts";
import {
  CAPABILITY_CATALOG,
  healthFromEvidence,
  searchCapabilities,
} from "../src/lib/jarvis/capability-catalog.ts";
import { reconcileDeployment } from "../src/lib/jarvis/state.ts";
import { classifyLicense, GithubClient } from "../src/lib/jarvis/github.ts";
import { executeJarvisTool } from "../src/lib/jarvis/tool-gateway.ts";
import { isJarvisSelfAwarenessQuestion, selectJarvisTools } from "../src/lib/jarvis/runtime.ts";

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const noApproval = { paidCreditApproved: false, highRiskApproved: false };

await check("every tool has a risk class, family and schema", () => {
  for (const tool of JARVIS_TOOLS) {
    assert.ok(
      ["READ", "REVERSIBLE_WRITE", "HIGH_RISK_WRITE", "PROTECTED"].includes(tool.risk),
      tool.name,
    );
    assert.equal(tool.parameters.type, "object", tool.name);
  }
  for (const required of [
    "github.inspect_repo",
    "github.search_code",
    "github.read_file",
    "github.inspect_history",
    "github.compare",
    "github.create_branch",
    "github.edit_candidate",
    "github.create_file",
    "github.commit_candidate",
    "github.inspect_ci",
    "github.create_pr",
    "github.update_pr",
    "lovable.get_project_state",
    "lovable.get_preview_state",
    "lovable.get_production_commit",
    "lovable.verify_build",
    "lovable.verify_deployment",
    "capability.search",
    "capability.describe",
    "capability.health",
    "system.get_version",
    "system.get_deployment",
    "system.get_recent_changes",
    "system.get_capabilities",
    "system.get_capability_health",
    "system.get_known_issues",
    "system.get_improvement_status",
  ])
    assert.ok(getJarvisTool(required), `missing ${required}`);
});

await check("policy: READ/REVERSIBLE autonomous, PROTECTED and paid-credit tools refused", () => {
  assert.equal(evaluateToolPolicy(getJarvisTool("github.read_file"), noApproval).allowed, true);
  assert.equal(evaluateToolPolicy(getJarvisTool("github.create_branch"), noApproval).allowed, true);
  const merge = evaluateToolPolicy(getJarvisTool("github.merge_pr"), noApproval);
  assert.equal(merge.allowed, false);
  const paid = evaluateToolPolicy(getJarvisTool("lovable.ai_generate"), noApproval);
  assert.equal(paid.allowed, false);
  assert.equal(paid.reason, "paid_credit_approval_required");
  // Even with paid approval the tool stays PROTECTED in Run 1.
  assert.equal(
    evaluateToolPolicy(getJarvisTool("lovable.ai_generate"), {
      paidCreditApproved: true,
      highRiskApproved: false,
    }).allowed,
    false,
  );
});

await check("acceptance 12: paid-credit fixture stops for approval", () => {
  const a = assessPaidCreditRequest(
    "Jarvis, just have Lovable AI build the new settings screen with credits.",
  );
  assert.equal(a.requestsPaidPath, true);
  assert.equal(a.approved, false);
  const b = assessPaidCreditRequest("Use a premium Codex agent run to implement the queue worker.");
  assert.equal(b.requestsPaidPath, true);
  const approved = assessPaidCreditRequest(
    "I approve using Lovable credits for this settings screen.",
  );
  assert.equal(approved.approved, true);
});

await check(
  "acceptance 13: free/direct fixture does not trigger the credit gate and selects GitHub tools",
  () => {
    const message =
      "Jarvis, find where the capability router lives, create a branch and fix the typo in its comment.";
    assert.equal(assessPaidCreditRequest(message).requestsPaidPath, false);
    assert.equal(
      assessPaidCreditRequest("Fix it on GitHub directly, don't use Lovable credits.")
        .requestsPaidPath,
      false,
    );
    const tools = selectJarvisTools(message);
    assert.ok(tools.includes("github.search_code"), tools.join(","));
    assert.ok(tools.includes("github.create_branch"), tools.join(","));
    assert.ok(!tools.includes("lovable.ai_generate"));
  },
);

await check(
  "GitHub protections: main/force/foreign branches, protected paths, secrets, RLS weakening",
  () => {
    assert.equal(assertCandidateBranch("jarvis/fix-router-typo"), "jarvis/fix-router-typo");
    for (const bad of [
      "main",
      "master",
      "jarvis/main",
      "feature/x",
      "jarvis/../main",
      "jarvis/jarvis-engineer-foundation",
    ])
      assert.throws(() => assertCandidateBranch(bad), /protected|named jarvis|Invalid/, bad);
    assert.throws(() => assertSafeRepoPath(".env"), /protected/);
    assert.throws(() => assertSafeRepoPath(".env.production"), /protected/);
    assert.equal(assertSafeRepoPath(".env.example"), ".env.example");
    assert.throws(() => assertSafeRepoPath(".github/workflows/ci.yml"), /protected/);
    assert.throws(
      () => assertSafeContent("x.ts", `const k = "sk-proj-${"a".repeat(30)}";`),
      /credential/,
    );
    assert.throws(
      () => assertSafeContent("m.sql", "alter table t disable row level security;"),
      /security/,
    );
    assert.equal(redactSecrets(`token ghp_${"b".repeat(36)} ok`), "token [redacted] ok");
  },
);

await check("GitHub client never sends force updates or ref deletes", async () => {
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : null,
    });
    const u = String(url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (u.endsWith("/git/ref/heads/jarvis/t1")) return json({ object: { sha: "p1" } });
    if (u.endsWith("/git/commits/p1")) return json({ tree: { sha: "t1" } });
    if (u.endsWith("/git/trees")) return json({ sha: "t2" });
    if (u.endsWith("/git/commits")) return json({ sha: "c2", html_url: "https://github.com/x" });
    if (u.endsWith("/git/refs/heads/jarvis/t1")) return json({ ref: "refs/heads/jarvis/t1" });
    return json({ message: "not found" }, 404);
  };
  const gh = new GithubClient({ token: "test-token", repo: "o/r" }, fake);
  const out = await gh.commitFiles("jarvis/t1", "checkpoint", [
    { path: "src/a.ts", content: "export const a = 1;\n" },
  ]);
  assert.equal(out.commit_sha, "c2");
  const patch = calls.find((c) => c.method === "PATCH");
  assert.equal(patch.body.force, false);
  assert.ok(!calls.some((c) => c.method === "DELETE"));
  await assert.rejects(() => gh.commitFiles("main", "x", [{ path: "a", content: "b" }]), /jarvis/);
});

await check(
  "gateway refuses protected/paid tools before execution and reports missing GitHub token",
  async () => {
    const inserts = [];
    const db = { from: () => ({ insert: async (row) => (inserts.push(row), { error: null }) }) };
    const ctx = {
      db,
      userId: "u",
      agentId: null,
      approvals: noApproval,
      openAiKey: null,
      researchModel: "m",
      env: {},
    };
    const paid = await executeJarvisTool("lovable.ai_generate", { prompt: "build" }, ctx);
    assert.equal(paid.ok, false);
    assert.equal(paid.kind, "policy");
    const write = await executeJarvisTool(
      "github.create_branch",
      { name: "jarvis/x" },
      { ...ctx, fetcher: async () => new Response("{}", { status: 200 }) },
    );
    assert.equal(write.ok, false);
    assert.equal(write.kind, "not_configured");
    assert.match(write.error, /JARVIS_GITHUB_TOKEN/);
    assert.ok(inserts.every((row) => row.event_type === "jarvis_tool" && row.channel === "system"));
    const unknown = await executeJarvisTool("github.delete_repo", {}, ctx);
    assert.equal(unknown.kind, "unknown_tool");
  },
);

const KNOWLEDGE = [
  {
    id: "1",
    category: "constraint",
    title: "Leaflet is intentional",
    content: "Keep Leaflet as the HPO map implementation. MapLibre caused a blank production map.",
    status: "current",
    importance: 5,
    source_type: "project_chat_digest",
    created_at: "2026-10-05T00:00:00Z",
  },
  {
    id: "2",
    category: "user_preference",
    title: "Small focused changes",
    content: "Prefer the smallest high-quality change that preserves working systems.",
    status: "current",
    importance: 5,
    source_type: "project_chat_digest",
    created_at: "2026-10-05T00:00:00Z",
  },
  {
    id: "3",
    category: "product_decision",
    title: "Use MapLibre for maps",
    content: "Old plan: move HPO maps to MapLibre.",
    status: "superseded",
    importance: 3,
    source_type: "project_chat_digest",
    created_at: "2026-09-01T00:00:00Z",
  },
  {
    id: "4",
    category: "product_decision",
    title: "Planner is primary",
    content: "Planner replaces Today as the primary HPO route surface.",
    status: "current",
    importance: 5,
    source_type: "adam",
    source_timestamp: "2026-10-05T10:00:00Z",
  },
  {
    id: "5",
    category: "history",
    title: "Phase 1 history",
    content: "Emery started as a chat app.",
    status: "historical",
    importance: 2,
    source_type: "project_chat_digest",
  },
];

await check("acceptance 2: knowledge retrieval is relevant and decision-first", () => {
  const ranked = rankKnowledge(
    KNOWLEDGE,
    "Jarvis, what do you know about how I like Emery built?",
    5,
  );
  assert.ok(ranked.length >= 3);
  assert.ok(!ranked.some((item) => item.status === "superseded"));
  assert.equal(ranked[0].id, "4", "Adam's explicit decision ranks first");
  const maps = rankKnowledge(KNOWLEDGE, "should we change the HPO map library?", 3);
  assert.equal(maps[0].id, "1");
});

await check(
  "knowledge ingestion extracts categories, rejects sensitive data, supersedes decisions",
  () => {
    const found = extractKnowledgeCandidates(
      "From now on, Planner should open to the active route first. Never remove the Activity tab. My password is hunter22. The voice handoff keeps failing in the car.",
    );
    const categories = found.map((c) => c.category);
    assert.ok(categories.includes("product_decision"));
    assert.ok(categories.includes("constraint"));
    assert.ok(categories.includes("failure_signal"));
    assert.ok(!found.some((c) => /hunter22/.test(c.content)));
    assert.ok(sensitiveReason("patient John DOB 01/02/1960"));
    assert.equal(
      extractKnowledgeCandidates("I prefer the route through Main Street on Mondays.", {
        requireEngineeringSubject: true,
      }).length,
      0,
    );
    assert.equal(
      extractKnowledgeCandidates("Emery should never hide the Activity tab from me.", {
        requireEngineeringSubject: true,
      }).length,
      1,
    );
    assert.equal(
      extractKnowledgeCandidates("Pick up milk from the store today please.", {
        requireEngineeringSubject: true,
      }).length,
      0,
    );
    const sup = findSuperseded(KNOWLEDGE, {
      category: "product_decision",
      title: "Planner primary route surface",
      content:
        "Planner replaces Today as the primary HPO route surface and opens the active route.",
    });
    assert.equal(sup?.id, "4");
  },
);

await check("acceptance 9: capability.search finds relevant tools across Emery + JARVIS", () => {
  assert.ok(
    CAPABILITY_CATALOG.some((e) => e.owner === "emery") &&
      CAPABILITY_CATALOG.some((e) => e.owner === "jarvis"),
  );
  const route = searchCapabilities("add a note to the current route stop");
  assert.ok(
    route.some((r) => r.name === "hpo.route_stop.add_note"),
    JSON.stringify(route),
  );
  const prod = searchCapabilities("which commit is production running");
  assert.ok(
    prod.some((r) => r.name === "lovable.get_production_commit" || r.name === "system.get_version"),
  );
  const gcal = searchCapabilities("google calendar sync");
  assert.ok(gcal.some((r) => r.name === "emery.google_calendar" && r.executable === false));
});

await check("capability health comes from evidence, not configuration claims", () => {
  const entry = CAPABILITY_CATALOG.find((e) => e.name === "github.create_branch");
  assert.equal(
    healthFromEvidence(entry, { receipts: [], toolEvents: [], env: {} }).health,
    "not_configured",
  );
  const read = CAPABILITY_CATALOG.find((e) => e.name === "github.read_file");
  assert.equal(
    healthFromEvidence(read, { receipts: [], toolEvents: [], env: {} }).health,
    "configured_untested",
  );
  const events = [0, 1, 2, 3].map((i) => ({
    action: "github.read_file",
    status: i === 0 ? "error" : "ok",
    created_at: `2026-10-05T0${i}:00:00Z`,
  }));
  assert.equal(
    healthFromEvidence(read, { receipts: [], toolEvents: events, env: {} }).health,
    "degraded",
  );
});

await check(
  "deployment reconciliation reports discrepancies instead of inventing a release",
  () => {
    const release = {
      production_commit_sha: "c00ddc55ff075fdcb9fed27e13819962bc65bb38",
      deployment_verified: true,
    };
    const synced = reconcileDeployment({
      servedCommit: "c00ddc55ff",
      runningCommit: null,
      githubMain: "c00ddc55ff075fdcb9fed27e13819962bc65bb38",
      latestRelease: release,
    });
    assert.equal(synced.in_sync, true);
    assert.equal(synced.discrepancies.length, 0);
    const drift = reconcileDeployment({
      servedCommit: null,
      runningCommit: null,
      githubMain: "abcdef1234",
      githubMainAhead: 3,
      latestRelease: release,
    });
    assert.equal(drift.production_commit_source, "release_ledger");
    assert.ok(drift.discrepancies.some((d) => /3 commit/.test(d)));
    assert.equal(drift.in_sync, false);
    const none = reconcileDeployment({
      servedCommit: null,
      runningCommit: null,
      githubMain: null,
      latestRelease: null,
    });
    assert.equal(none.production_commit, null);
    assert.ok(none.discrepancies.some((d) => /No release/.test(d)));
  },
);

await check("license classification", () => {
  assert.equal(classifyLicense("MIT").verdict, "compatible");
  assert.equal(classifyLicense("Apache-2.0").verdict, "compatible");
  assert.equal(classifyLicense("AGPL-3.0").verdict, "incompatible");
  assert.equal(classifyLicense("GPL-3.0").verdict, "caution");
  assert.equal(classifyLicense(null).verdict, "unknown");
});

await check("acceptance 10/11: Emery self-awareness questions are detected", () => {
  for (const q of [
    "What version are you running?",
    "What upgrades have you had recently?",
    "what changed in your last release",
    "are you up to date?",
  ])
    assert.ok(isJarvisSelfAwarenessQuestion(q), q);
  for (const q of ["What's on my calendar today?", "Add a note to Macri Law"])
    assert.ok(!isJarvisSelfAwarenessQuestion(q), q);
});

console.log(`\nJARVIS Run 1 validation: ${passed} checks passed.`);

// ------------------------------------------------------------------------
// End-to-end room turn with stubbed Supabase / OpenAI / GitHub transports.
// Proves: Adam ↔ JARVIS only (no Emery speaker), knowledge + live status are
// read, the model's tool call is executed through the gateway, receipts are
// written, and the paid-credit fixture stops before any model call.
// ------------------------------------------------------------------------

function fakeDb(fixtures) {
  const log = { inserts: [], updates: [] };
  const db = {
    log,
    rpc: async () => ({ data: fixtures.rpc ?? {}, error: null }),
    from(table) {
      let mode = "select";
      let payload = null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        in: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        insert(row) {
          mode = "insert";
          payload = row;
          log.inserts.push({ table, row });
          return builder;
        },
        update(row) {
          mode = "update";
          payload = row;
          log.updates.push({ table, row });
          return builder;
        },
        maybeSingle: () => Promise.resolve(single()),
        single: () => Promise.resolve(single()),
        then(resolve, reject) {
          return Promise.resolve(many()).then(resolve, reject);
        },
      };
      function row() {
        return {
          id: `${table}-${log.inserts.length}`,
          created_at: new Date().toISOString(),
          ...payload,
        };
      }
      function single() {
        if (mode === "insert") return { data: row(), error: null };
        const list = fixtures[table] ?? [];
        return { data: list[0] ?? null, error: null };
      }
      function many() {
        if (mode !== "select") return { data: null, error: null };
        return { data: fixtures[table] ?? [], error: null };
      }
      return builder;
    },
  };
  return db;
}

const { handleJarvisTurn } = await import("../src/lib/jarvis/room.ts");

await check(
  "acceptance 1/3/5/6/13: room turn = Adam ↔ JARVIS, live state read, GitHub tool executed",
  async () => {
    const db = fakeDb({
      agent_threads: [{ id: "thread-1" }],
      agent_messages: [],
      jarvis_knowledge_items: KNOWLEDGE,
      jarvis_engineering_sessions: [
        {
          id: "s1",
          status: "completed",
          session_date: "2026-10-05",
          intake_limit: 50,
          accepted_count: 7,
          summary: "Foundation bootstrap",
          approval_required: false,
          updated_at: "2026-10-05T03:00:00Z",
        },
      ],
      jarvis_engineering_tasks: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          title: "Create JARVIS research ledger",
          status: "completed",
          created_at: "2026-10-05T03:00:00Z",
          updated_at: "2026-10-05T03:00:00Z",
        },
      ],
      jarvis_research_findings: [
        {
          id: "f1",
          topic: "Durable queue for JARVIS",
          classification: "test",
          created_at: "2026-10-05T03:00:00Z",
        },
      ],
    });
    const modelBodies = [];
    const githubCalls = [];
    const realFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.JARVIS_GITHUB_TOKEN = "test-github";
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.startsWith("https://api.openai.com")) {
        const body = JSON.parse(init.body);
        modelBodies.push(body);
        if (modelBodies.length === 1)
          return new Response(
            JSON.stringify({
              id: "r1",
              output: [
                {
                  type: "function_call",
                  name: "github__search_code",
                  call_id: "c1",
                  arguments: '{"query":"routeEmeryCapabilities"}',
                },
              ],
            }),
          );
        return new Response(
          JSON.stringify({
            id: "r2",
            output_text:
              "routeEmeryCapabilities lives in src/lib/emery/capability-router.ts. No paid credits needed — I'll branch from main.",
          }),
        );
      }
      if (u.startsWith("https://api.github.com/search/code")) {
        githubCalls.push(u);
        return new Response(
          JSON.stringify({
            total_count: 1,
            items: [
              { path: "src/lib/emery/capability-router.ts", html_url: "https://github.com/x" },
            ],
          }),
        );
      }
      return new Response("{}", { status: 404 });
    };
    try {
      const turn = await handleJarvisTurn(
        db,
        "u1",
        { id: "jarvis-agent", slug: "jarvis-engineer" },
        "Jarvis, where does routeEmeryCapabilities live in the code? Then plan the fix.",
      );
      assert.equal(turn.error, null);
      const messageInserts = db.log.inserts.filter((i) => i.table === "agent_messages");
      assert.deepEqual(
        messageInserts.map((i) => i.row.speaker),
        ["user", "agent"],
        "only Adam and JARVIS speak",
      );
      assert.ok(!messageInserts.some((i) => i.row.speaker === "emery"));
      assert.equal(githubCalls.length, 1, "GitHub search executed");
      const system = modelBodies[0].input[0].content;
      assert.match(system, /LIVE JARVIS ENGINEERING STATE/);
      assert.match(system, /Foundation bootstrap/);
      assert.ok(modelBodies[0].tools.some((t) => t.name === "github__search_code"));
      assert.ok(
        !modelBodies[0].tools.some((t) => t.name === "lovable__ai_generate"),
        "paid tool never exposed",
      );
      assert.equal(modelBodies[1].previous_response_id, "r1");
      assert.equal(modelBodies[1].input[0].type, "function_call_output");
      const trace = messageInserts[1].row.metadata.tool_trace;
      assert.ok(trace.some((t) => t.tool === "github.search_code" && t.ok));
      const receipts = db.log.inserts.filter(
        (i) => i.table === "emery_runtime_events" && i.row.event_type === "jarvis_tool",
      );
      assert.ok(
        receipts.some((r) => r.row.action === "github.search_code" && r.row.status === "ok"),
      );
      assert.ok(
        !JSON.stringify(modelBodies).includes("test-github"),
        "GitHub token never reaches the model",
      );

      // Paid-credit fixture: stops with an approval request and makes no model call.
      modelBodies.length = 0;
      const paid = await handleJarvisTurn(
        db,
        "u1",
        { id: "jarvis-agent", slug: "jarvis-engineer" },
        "Have Lovable AI generate the new settings page using credits.",
      );
      assert.equal(modelBodies.length, 0);
      assert.equal(paid.agentMessage.metadata.gate, "paid_credit");
      assert.match(paid.agentMessage.content, /approval/i);

      // Error-intent prefetch pulls real telemetry/receipts/evaluations.
      await handleJarvisTurn(
        db,
        "u1",
        { id: "jarvis-agent", slug: "jarvis-engineer" },
        "Jarvis, what errors has Emery had recently?",
      );
      const prefetchSystem = modelBodies[0].input[0].content;
      assert.match(prefetchSystem, /supabase\.runtime_telemetry →/);
      assert.match(prefetchSystem, /supabase\.execution_receipts →/);
      assert.match(prefetchSystem, /supabase\.evaluations →/);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.JARVIS_GITHUB_TOKEN;
    }
  },
);

const { buildEmerySelfAwarenessBlock } = await import("../src/lib/jarvis/runtime.ts");

await check(
  "acceptance 10/11: Emery version/upgrade answers come from emery_releases + live deployment",
  async () => {
    const baseline = {
      release_name: "Pre-JARVIS production baseline",
      production_commit_sha: "c00ddc55ff075fdcb9fed27e13819962bc65bb38",
      deployed_at: "2026-10-05T02:42:25Z",
      summary: "Authoritative production baseline",
      deployment_verified: true,
      known_limitations: [],
    };
    const db = fakeDb({
      emery_releases: [baseline],
      emery_runtime_events: [],
      emery_execution_runs: [],
      emery_improvement_backlog: [],
    });
    const fetcher = async (url) => {
      const u = String(url);
      if (u.includes("emery-build.json"))
        return new Response(JSON.stringify({ buildId: "2026-10-05-phase9" }));
      if (u.startsWith("https://emery-personal-ai.lovable.app"))
        return new Response('<html><head><meta name="emery-build" content="x"/></head></html>', {
          status: 200,
        });
      return new Response("{}", { status: 404 });
    };
    const block = await buildEmerySelfAwarenessBlock({
      db,
      userId: "u1",
      agentId: null,
      approvals: noApproval,
      openAiKey: null,
      researchModel: "m",
      fetcher,
      env: {},
    });
    assert.match(block, /c00ddc55ff/);
    assert.match(block, /Pre-JARVIS production baseline/);
    assert.match(block, /release_ledger/, "production commit source is reported");
    assert.match(block, /do not|rather than inventing/i);
  },
);

const { handleGithubProxy } = await import("../supabase/functions/jarvis-github/proxy.ts");
const { createEdgeGithubFetcher } = await import("../src/lib/jarvis/edge-transport.ts");
const { readFileSync } = await import("node:fs");

const SECRET = "ghp_" + "S".repeat(36);

function stubGithub(log) {
  return async (url, init = {}) => {
    const u = String(url);
    log.push({
      url: u,
      method: init.method ?? "GET",
      auth: init.headers?.Authorization ?? null,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (u.endsWith("/pulls/7"))
      return new Response(JSON.stringify({ head: { ref: "jarvis/fix-x" } }));
    if (u.endsWith("/pulls/8"))
      return new Response(JSON.stringify({ head: { ref: "feature/other" } }));
    // A hostile upstream echoing the credential must still be redacted.
    return new Response(JSON.stringify({ ok: true, echoed: SECRET }), { status: 200 });
  };
}

await check("edge function guards stay byte-identical to the app guards", () => {
  assert.equal(
    readFileSync("src/lib/jarvis/guards.ts", "utf8"),
    readFileSync("supabase/functions/jarvis-github/guards.ts", "utf8"),
  );
});

await check(
  "edge proxy: allowlisted reads/writes pass, everything dangerous is refused before the token is used",
  async () => {
    const log = [];
    const deps = { token: SECRET, fetcher: stubGithub(log) };
    const R = "/repos/Adamspersonalaiassistant/my-personal-ai";
    const ok = async (req) => (await handleGithubProxy(req, deps)).status;
    assert.equal(await ok({ method: "GET", path: R }), 200);
    assert.equal(
      await ok({ method: "GET", path: `${R}/contents/src/lib/emery.functions.ts?ref=main` }),
      200,
    );
    assert.equal(
      await ok({
        method: "GET",
        path: `/search/code?q=${encodeURIComponent("foo repo:Adamspersonalaiassistant/my-personal-ai")}`,
      }),
      200,
    );
    assert.equal(
      await ok({
        method: "POST",
        path: `${R}/git/refs`,
        body: { ref: "refs/heads/jarvis/fix-x", sha: "abc" },
      }),
      200,
    );
    assert.equal(
      await ok({
        method: "PATCH",
        path: `${R}/git/refs/heads/jarvis/fix-x`,
        body: { sha: "abc", force: false },
      }),
      200,
    );
    assert.equal(
      await ok({
        method: "POST",
        path: `${R}/git/trees`,
        body: {
          base_tree: "t",
          tree: [{ path: "src/a.ts", mode: "100644", type: "blob", content: "export {};" }],
        },
      }),
      200,
    );
    assert.equal(
      await ok({
        method: "POST",
        path: `${R}/pulls`,
        body: { head: "jarvis/fix-x", base: "main", title: "t" },
      }),
      200,
    );
    assert.equal(await ok({ method: "PATCH", path: `${R}/pulls/7`, body: { title: "new" } }), 200);
    const sentBefore = log.length;
    const refused = [
      { method: "PUT", path: `${R}/pulls/7/merge`, body: {} },
      { method: "POST", path: `${R}/merges`, body: { base: "main", head: "x" } },
      { method: "DELETE", path: `${R}/git/refs/heads/jarvis/fix-x` },
      { method: "PATCH", path: `${R}/git/refs/heads/main`, body: { sha: "abc" } },
      {
        method: "PATCH",
        path: `${R}/git/refs/heads/jarvis/fix-x`,
        body: { sha: "abc", force: true },
      },
      { method: "POST", path: `${R}/git/refs`, body: { ref: "refs/heads/main", sha: "abc" } },
      { method: "POST", path: `${R}/git/refs`, body: { ref: "refs/tags/v1", sha: "abc" } },
      { method: "POST", path: `${R}/pulls`, body: { head: "feature/x", base: "main" } },
      { method: "POST", path: `${R}/pulls`, body: { head: "jarvis/x", base: "production" } },
      { method: "PATCH", path: `${R}/pulls/7`, body: { state: "closed" } },
      { method: "PATCH", path: `${R}/pulls/8`, body: { title: "x" } },
      {
        method: "POST",
        path: `${R}/git/trees`,
        body: {
          base_tree: "t",
          tree: [{ path: ".github/workflows/ci.yml", mode: "100644", content: "x" }],
        },
      },
      {
        method: "POST",
        path: `${R}/git/trees`,
        body: { base_tree: "t", tree: [{ path: ".env", mode: "100644", content: "x" }] },
      },
      {
        method: "POST",
        path: `${R}/git/trees`,
        body: {
          base_tree: "t",
          tree: [{ path: "a.ts", mode: "100644", content: `k="${SECRET}"` }],
        },
      },
      {
        method: "POST",
        path: `${R}/git/trees`,
        body: {
          base_tree: "t",
          tree: [
            { path: "m.sql", mode: "100644", content: "alter table x disable row level security;" },
          ],
        },
      },
      {
        method: "POST",
        path: `${R}/git/trees`,
        body: { tree: [{ path: "a.ts", mode: "100644", content: "x" }] },
      },
      { method: "GET", path: "/repos/someone-else/private-repo/contents/x" },
      { method: "GET", path: `/search/code?q=${encodeURIComponent("password")}` },
      { method: "GET", path: `${R}/actions/secrets` },
      { method: "POST", path: `${R}/actions/workflows/ci.yml/dispatches`, body: {} },
      { method: "GET", path: `${R}/../../user` },
    ];
    for (const req of refused) {
      const out = await handleGithubProxy(req, deps);
      assert.equal(
        out.status,
        403,
        `${req.method} ${req.path} should be refused (got ${out.status})`,
      );
    }
    assert.ok(
      log.slice(sentBefore).every((c) => c.url.endsWith("/pulls/8")),
      "only the PR inspection lookup happened for refused calls",
    );
  },
);

await check(
  "edge proxy never returns the token (even if upstream echoes it) and reports missing secret",
  async () => {
    const log = [];
    const out = await handleGithubProxy(
      { method: "GET", path: "/repos/Adamspersonalaiassistant/my-personal-ai" },
      { token: SECRET, fetcher: stubGithub(log) },
    );
    assert.ok(!out.body.includes(SECRET));
    assert.ok(
      log[0].auth.startsWith("Bearer "),
      "token is attached only on the outbound GitHub call",
    );
    const none = await handleGithubProxy(
      { method: "GET", path: "/repos/Adamspersonalaiassistant/my-personal-ai" },
      { token: null, fetcher: stubGithub([]) },
    );
    assert.equal(none.status, 412);
  },
);

await check(
  "app transport: GithubClient works through the edge function and never holds the token",
  async () => {
    const log = [];
    const proxyFetch = stubGithub(log);
    const sentToEdge = [];
    const edgeFetch = async (url, init) => {
      const body = JSON.parse(init.body);
      sentToEdge.push({ url: String(url), headers: init.headers, body });
      const result = await handleGithubProxy(body, { token: SECRET, fetcher: proxyFetch });
      return new Response(JSON.stringify(result), { status: 200 });
    };
    const fetcher = createEdgeGithubFetcher({
      supabaseUrl: "https://x.supabase.co",
      publishableKey: "pub",
      accessToken: "owner.jwt.token",
      fetcher: edgeFetch,
    });
    const gh = new GithubClient(
      { token: null, repo: "Adamspersonalaiassistant/my-personal-ai", edge: true },
      fetcher,
    );
    assert.equal(gh.configuredForWrites, true);
    const branch = await gh.createBranch("jarvis/edge-test", "main").catch((e) => e);
    assert.ok(
      sentToEdge.every((c) => c.url === "https://x.supabase.co/functions/v1/jarvis-github"),
    );
    assert.ok(sentToEdge.every((c) => c.headers.Authorization === "Bearer owner.jwt.token"));
    assert.ok(
      !JSON.stringify(sentToEdge).includes(SECRET),
      "token never crosses the app/edge boundary",
    );
    assert.ok(
      sentToEdge.some((c) => c.body.method === "POST" && c.body.path.endsWith("/git/refs")) ||
        branch instanceof Error,
    );
    // policy still enforced client-side too
    await assert.rejects(() => gh.createBranch("main"), /jarvis/);
  },
);

await check(
  "code search falls back to a tree scan when GitHub's private-repo code index returns nothing",
  async () => {
    const fetcher = async (url) => {
      const u = String(url);
      if (u.includes("/search/code"))
        return new Response(JSON.stringify({ total_count: 0, items: [] }));
      if (u.includes("/git/trees/"))
        return new Response(
          JSON.stringify({
            tree: [{ type: "blob", size: 100, path: "src/lib/emery/capability-router.ts" }],
          }),
        );
      if (u.startsWith("https://raw.githubusercontent.com/"))
        return new Response("line one\nexport function routeEmeryCapabilities() {}\n");
      return new Response("{}", { status: 404 });
    };
    const gh = new GithubClient({ token: "t", repo: "o/r" }, fetcher);
    const out = await gh.searchCode("routeEmeryCapabilities");
    assert.equal(out.method, "tree_scan");
    assert.equal(out.results[0].path, "src/lib/emery/capability-router.ts");
    assert.equal(out.results[0].line, 2);
  },
);

await check(
  "Run 2 intake: batch tasks reach the worker executable — no pre-assigned session, specs kept, duplicates merged, dependencies wired",
  async () => {
    const db = fakeDb({
      jarvis_engineering_tasks: [
        {
          id: "open-1",
          title: "Existing open task",
          status: "queued",
          session_id: "s1",
          created_at: "2026-10-06T01:00:00Z",
          updated_at: "2026-10-06T01:00:00Z",
        },
      ],
      jarvis_engineering_sessions: [],
    });
    const ctx = {
      db,
      userId: "u",
      agentId: null,
      approvals: noApproval,
      openAiKey: null,
      researchModel: "m",
      env: {},
    };
    const out = await executeJarvisTool(
      "jarvis.create_tasks",
      {
        source_type: "chatgpt_batch",
        tasks: [
          { title: "Existing open task" },
          {
            title: "Tighten capability registry wording",
            target_paths: ["src/lib/execution-capabilities.ts"],
          },
          {
            title: "Verify registry wording in telemetry",
            checks: [{ type: "db_count", table: "emery_runtime_events", days: 1 }],
            depends_on_index: [1],
          },
          { title: "Make Emery better somehow" },
        ],
      },
      ctx,
    );
    assert.equal(out.ok, true, out.error);
    const r = out.result;
    assert.equal(r.created, 3);
    assert.equal(r.results[0].duplicate_of, "open-1");
    const inserted = db.log.inserts.filter((i) => i.table === "jarvis_engineering_tasks");
    assert.equal(inserted.length, 3);
    assert.ok(
      inserted.every((i) => !("session_id" in i.row)),
      "worker assigns the session",
    );
    assert.equal(inserted[0].row.source_type, "chatgpt_batch");
    assert.equal(inserted[0].row.task_spec.kind, "code_change");
    assert.deepEqual(inserted[0].row.task_spec.target_paths, ["src/lib/execution-capabilities.ts"]);
    assert.equal(inserted[1].row.task_spec.kind, "diagnostic");
    assert.equal(inserted[1].row.depends_on.length, 1);
    assert.equal(inserted[1].row.depends_on[0], r.results[1].task.id);
    assert.ok(r.results[3].needs_spec, "an unexecutable task is flagged, not silently queued");
    assert.ok(
      !db.log.inserts.some((i) => i.table === "jarvis_engineering_sessions"),
      "no session created outside the worker",
    );
  },
);

const { jarvisVoiceProfile, jarvisRealtimeInstructions, DEFAULT_JARVIS_VOICE } =
  await import("../src/lib/jarvis/voice.ts");

await check(
  "Run 2 voice: JARVIS has its own persistent voice, never Emery's, and routes speech into the shared JARVIS thread",
  () => {
    assert.equal(jarvisVoiceProfile(null, "shimmer").voice, DEFAULT_JARVIS_VOICE.voice);
    assert.notEqual(jarvisVoiceProfile(null, "shimmer").voice, "shimmer");
    // Even if Emery's voice later becomes JARVIS's default, they stay distinct.
    assert.notEqual(jarvisVoiceProfile(null, "cedar").voice, "cedar");
    const stored = jarvisVoiceProfile({ voice_profile: { voice: "ash", speed: 1.05 } }, "shimmer");
    assert.equal(stored.voice, "ash");
    assert.equal(stored.speed, 1.05);
    assert.equal(jarvisVoiceProfile({ voice_profile: { voice: "bogus", speed: 9 } }).speed, 1);
    const text = jarvisRealtimeInstructions(DEFAULT_JARVIS_VOICE, "STATE");
    assert.match(text, /British-English/);
    assert.match(text, /never imitate any actor/i);
    assert.match(text, /jarvis_turn/);
    assert.match(text, /You are NOT Emery/);
  },
);

await check(
  "Run 2 readiness: intake counts only tasks accepted into today's sessions; a full day is reported as not ready",
  async () => {
    const state = await import("../src/lib/jarvis/state.ts");
    const today = state.easternDate();
    const at = new Date().toISOString();
    const session = (id, n) => ({
      id,
      status: "completed",
      session_date: today,
      intake_limit: 50,
      self_research_summary: id === "s2" ? "Self-research (watch): test selection." : null,
      self_research_classification: "watch",
      metadata: { metrics: { completion_rate: 1 } },
      updated_at: at,
      accepted_count: n,
    });
    const task = (id, sessionId, status = "completed") => ({
      id,
      session_id: sessionId,
      title: id,
      status,
      created_at: at,
      updated_at: at,
    });
    const accepted = (n, sid) => Array.from({ length: n }, (_, i) => task(`${sid}-${i}`, sid));
    const status = async (tasks) =>
      state.getJarvisStatus(
        fakeDb({
          jarvis_engineering_sessions: [session("s2", 10), session("s1", 5)],
          jarvis_engineering_tasks: tasks,
          jarvis_research_findings: [],
        }),
        "u",
      );
    const partial = await status([
      ...accepted(5, "s1"),
      ...accepted(10, "s2"),
      task("ledger-note", null, "deferred"),
      task("tomorrow", null, "queued"),
    ]);
    assert.equal(partial.accepted_today, 15, "ledger notes and unaccepted tasks do not count");
    assert.equal(partial.ready_for_more_tasks.ready, true);
    assert.equal(partial.ready_for_more_tasks.remaining_capacity_today, 35);
    assert.equal(partial.latest_session_self_improvement.session_id, "s2");
    const full = await status([...accepted(25, "s1"), ...accepted(25, "s2")]);
    assert.equal(full.ready_for_more_tasks.ready, false);
    assert.match(full.ready_for_more_tasks.note, /intake is full/);
  },
);

console.log(`JARVIS Run 1 end-to-end harness: complete (${passed} checks).`);
