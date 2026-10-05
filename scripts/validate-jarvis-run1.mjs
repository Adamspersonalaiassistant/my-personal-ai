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

console.log(`JARVIS Run 1 end-to-end harness: complete (${passed} checks).`);
