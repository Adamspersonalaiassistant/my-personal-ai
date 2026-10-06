/* eslint-disable @typescript-eslint/no-explicit-any */
// JARVIS Engineer conversation runtime.
//
// Turn flow:
//   paid-credit gate (deterministic) → retrieve relevant knowledge + live status
//   → prefetch evidence for the detected intent → expose only relevant tools
//   → bounded tool loop (execute → verify → replan, capability.search widens
//   the exposed set) → answer from evidence.
// Every tool call goes through tool-gateway.ts, which enforces policy and writes
// a jarvis_tool receipt.

import { searchCapabilities } from "./capability-catalog.ts";
import { formatKnowledgeForPrompt, rankKnowledge } from "./knowledge.ts";
import { assessPaidCreditRequest, paidCreditApprovalMessage, redactSecrets } from "./policy.ts";
import { JARVIS_TYPED_FORMAT_POLICY } from "../response-format-policy.ts";
import { JARVIS_CHARACTER } from "./character.ts";
import * as state from "./state.ts";
import { executeJarvisTool, type GatewayContext, type ToolOutcome } from "./tool-gateway.ts";
import {
  fromModelToolName,
  getJarvisTool,
  JARVIS_CORE_TOOLS,
  JARVIS_TOOLS,
  toModelToolName,
} from "./tool-registry.ts";

export const JARVIS_PERSONA = `${JARVIS_CHARACTER}

Emery remains Adam's primary assistant everywhere else. In this room you talk with Adam directly; there is no Emery commander here.

Your three permanent jobs:
1. Make Emery better for Adam.
2. Make JARVIS better at making Emery better for Adam.
3. Execute Adam's engineering tasks reliably.

Operating rules (enforced in code as well):
- Free-first: inspect code, use GitHub directly, Supabase, existing tests, Lovable observability. Never use Lovable AI-generation or premium credits without Adam's explicit approval; if you think paid credits are warranted, say what, why the free path is insufficient, expected benefit, expected cost, and what you can still do free — then stop.
- GitHub is the source of truth. Candidate code goes on an isolated jarvis/<slug> branch created early, with checkpoint commits. main, force-push, ref deletion, merges, CI workflows, .env and credential files are protected.
- Supabase: diagnostic reads; writes only to the JARVIS ledger (tasks, findings, knowledge). Never weaken RLS.
- "Published" does not mean working. Distinguish code-complete, tested, deployed and verified-live.
- Preserve Emery, HPO (Planner/Maps/Accounts/Activity, Leaflet), Calendar, Voice, memory, receipts. No parallel systems.
- When a tool fails: verify, replan, search the broader capability registry (capability.search), try a safe alternative, research if needed — only then record a capability gap as an engineering task.
- ENGINEERING REQUESTS ("Emery is doing X wrong, fix it"): you do the engineering; Adam never needs another tool or person to write the code. In this turn: (1) find evidence (telemetry, receipts, evaluations); (2) locate the responsible code with github.search_code / read files; (3) state the root cause you found; (4) create ONE executable jarvis.create_task (kind code_change, the exact target_paths, a precise objective and acceptance checks). The durable worker then branches (jarvis/*), edits, runs isolated CI, repairs failures and opens the PR even if Adam closes the app; Adam gets one notification when the session finishes. Do not hand Adam a prompt for another assistant, and do not stop at a recommendation when he asked for a fix.
- RELEASES: you never merge. When a candidate is ready, tell Adam plainly: what changed, files, CI result, release risk, the production commit and the candidate commit, and what approving does, then ask "Approve release?". When he says "Approve it" / "Approve PR N" / "Ship that", call jarvis.approve_release; it binds to that exact PR + head commit + current production and the worker's release operator merges, deploys, verifies and notifies. Low-risk docs/test/capability-note changes release on their own. If a PR changes after approval, the approval is void: say so and ask again. Frontend changes may end with one remaining action for Adam: tapping Publish in Lovable; say so exactly once.
- APPROVALS: when something needs Adam, say WHAT changed, WHY, the EVIDENCE, the RISK and WHAT approving does — briefly. Candidate PRs are never merged by you; production release stays Adam's decision.
- Task approval: "give me ideas / what should we do" PROPOSES (nothing runs, 0 capacity used). Only Adam's explicit "execute / approve / schedule these" approves tasks for the worker. Capacity ("X of 50 production tasks accepted today") counts only real, approved, accepted production tasks — never proposals, validation fixtures or cancelled work. When Adam replaces a plan ("instead of the previous plan"), supersede the old batch rather than adding to it, and never cancel work already in progress without asking.
- Answer from the evidence returned by tools and the context below. If evidence is missing or a tool is not configured, say exactly that.
- Answer from evidence; cite the real numbers, commits and PRs you saw.

${JARVIS_TYPED_FORMAT_POLICY}`;

const SELF_AWARENESS =
  /\b(what|which)\s+(version|build|release|commit)\b|\bversion (are|is) (you|emery)\b|\b(upgrades?|updates?|improvements?|changes?|new features?)\b[^?]{0,40}\b(recent(ly)?|lately|latest|last|had|got|since)\b|\b(recent(ly)?|latest|last)\b[^?]{0,30}\b(upgrades?|updates?|releases?|changes?)\b|\bwhat('s| has| have)?\s+changed\b|\bup to date\b|\b(are you|is emery) (running|deployed)\b/i;

export function isJarvisSelfAwarenessQuestion(text: string) {
  return SELF_AWARENESS.test(String(text ?? ""));
}

const ERROR_INTENT =
  /\b(errors?|fail(ed|ing|ures?)?|problems?|issues?|broken|bugs?|struggl\w*|wrong|regress\w*)\b/i;
const STATUS_INTENT =
  /\b(working on|status|queue|tasks?|progress|session|doing|blocked|approval)\b/i;
const NEXT_INTENT =
  /\b(improve next|what should you (improve|fix|build|work on)|priorit\w*|next)\b/i;
const BUILD_INTENT = /\b(fix|implement|build|change|edit|refactor|add|create|patch|update)\b/i;
const CODE_INTENT =
  /\b(code|source|file|function|component|repo|repository|where (is|does)|search|grep|branch|commit|pr|pull request)\b/i;
const DEPLOY_INTENT =
  /\b(version|deploy\w*|production|commit|release|lovable|published|live|running)\b/i;
const DB_INTENT =
  /\b(supabase|database|schema|rls|policy|policies|advisor|security|migration|table)\b/i;
const RESEARCH_INTENT =
  /\b(research|docs?|documentation|best practice|library|open source|github search|how do (others|people))\b/i;

export function selectJarvisTools(message: string, extra: string[] = []): string[] {
  const selected = new Set<string>(JARVIS_CORE_TOOLS);
  for (const hit of searchCapabilities(message, { owner: "jarvis", limit: 10 }))
    selected.add(hit.name);
  if (CODE_INTENT.test(message) || BUILD_INTENT.test(message))
    [
      "github.inspect_repo",
      "github.search_code",
      "github.read_file",
      "github.inspect_history",
    ].forEach((t) => selected.add(t));
  if (BUILD_INTENT.test(message))
    [
      "github.create_branch",
      "github.edit_candidate",
      "github.create_file",
      "github.commit_candidate",
      "github.inspect_ci",
      "github.create_pr",
      "jarvis.create_task",
      "jarvis.create_tasks",
      "jarvis.approve_tasks",
      "jarvis.approve_release",
      "jarvis.supersede_batch",
      "jarvis.update_task",
      "emery.run_evaluations",
    ].forEach((t) => selected.add(t));
  if (ERROR_INTENT.test(message))
    [
      "supabase.runtime_telemetry",
      "supabase.execution_receipts",
      "supabase.evaluations",
      "supabase.improvement_backlog",
      "system.get_known_issues",
    ].forEach((t) => selected.add(t));
  if (DEPLOY_INTENT.test(message))
    [
      "system.get_deployment",
      "lovable.get_production_commit",
      "lovable.verify_deployment",
      "system.get_recent_changes",
    ].forEach((t) => selected.add(t));
  if (DB_INTENT.test(message))
    ["supabase.schema", "supabase.advisors"].forEach((t) => selected.add(t));
  if (RESEARCH_INTENT.test(message))
    [
      "research.web_search",
      "research.github_search",
      "research.license_check",
      "research.record_finding",
    ].forEach((t) => selected.add(t));
  if (NEXT_INTENT.test(message))
    [
      "system.get_improvement_status",
      "supabase.improvement_backlog",
      "system.get_known_issues",
    ].forEach((t) => selected.add(t));
  for (const name of extra) if (getJarvisTool(name)) selected.add(name);
  // Never expose paid/protected tools to the model; the gateway would refuse them anyway.
  return [...selected].filter((name) => {
    const tool = getJarvisTool(name);
    return tool && tool.risk !== "PROTECTED" && !tool.paidCredit;
  });
}

function prefetchPlan(message: string): Array<{ tool: string; args: Record<string, unknown> }> {
  const plan: Array<{ tool: string; args: Record<string, unknown> }> = [];
  if (ERROR_INTENT.test(message)) {
    plan.push({ tool: "supabase.runtime_telemetry", args: { days: 14 } });
    plan.push({ tool: "supabase.execution_receipts", args: { days: 14 } });
    plan.push({ tool: "supabase.evaluations", args: {} });
  }
  if (isJarvisSelfAwarenessQuestion(message) || /\bversion\b/i.test(message))
    plan.push({ tool: "system.get_deployment", args: {} });
  if (NEXT_INTENT.test(message)) plan.push({ tool: "system.get_improvement_status", args: {} });
  return plan;
}

export type ToolTraceEntry = {
  tool: string;
  ok: boolean;
  ms: number;
  summary: string;
  error?: string;
};

function traceEntry(outcome: ToolOutcome): ToolTraceEntry {
  if (outcome.ok)
    return {
      tool: outcome.tool,
      ok: true,
      ms: outcome.durationMs,
      summary: summarize(outcome.result),
    };
  return {
    tool: outcome.tool,
    ok: false,
    ms: outcome.durationMs,
    summary: outcome.kind,
    error: outcome.error.slice(0, 240),
  };
}

function summarize(result: unknown) {
  const text = JSON.stringify(result ?? null);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function toolOutputText(outcome: ToolOutcome) {
  const payload = outcome.ok
    ? { ok: true, result: outcome.result }
    : { ok: false, kind: outcome.kind, error: outcome.error };
  const text = redactSecrets(JSON.stringify(payload));
  return text.length > 14_000 ? `${text.slice(0, 14_000)}… [truncated]` : text;
}

function modelTools(names: string[]) {
  return names
    .map((name) => getJarvisTool(name))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
    .map((tool) => ({
      type: "function",
      name: toModelToolName(tool.name),
      description: `[${tool.risk}] ${tool.description}`,
      parameters: tool.parameters,
      strict: false,
    }));
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim())
    return payload.output_text.trim();
  const parts: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : [])
    for (const content of Array.isArray(item?.content) ? item.content : [])
      if (content?.type === "output_text" && content.text) parts.push(content.text);
  return parts.join("\n\n").trim();
}

export type JarvisTurnInput = {
  gateway: GatewayContext;
  message: string;
  history: Array<{ speaker: string; content: string }>;
  apiKey: string;
  model: string;
  fetcher?: typeof fetch;
  maxRounds?: number;
};

export type JarvisTurnResult = {
  text: string;
  toolTrace: ToolTraceEntry[];
  approvalRequired: boolean;
  gate: "paid_credit" | null;
  knowledgeUsed: string[];
};

export async function runJarvisTurn(input: JarvisTurnInput): Promise<JarvisTurnResult> {
  const { gateway, message } = input;
  const fetcher = input.fetcher ?? fetch;

  // 1. Free-first policy is enforced before any model or tool call.
  const credit = assessPaidCreditRequest(message);
  if (credit.requestsPaidPath && !credit.approved) {
    return {
      text: paidCreditApprovalMessage(credit, message),
      toolTrace: [],
      approvalRequired: true,
      gate: "paid_credit",
      knowledgeUsed: [],
    };
  }

  // 2. Relevant knowledge + live state.
  const [knowledge, status] = await Promise.all([
    state.loadKnowledge(gateway.db, gateway.userId).catch(() => []),
    state.getJarvisStatus(gateway.db, gateway.userId).catch(() => null),
  ]);
  const ranked = rankKnowledge(knowledge, message, 8);
  const trace: ToolTraceEntry[] = [];
  if (ranked.length)
    trace.push({
      tool: "jarvis.search_knowledge",
      ok: true,
      ms: 0,
      summary: `${ranked.length} relevant of ${knowledge.length} items`,
    });

  // 3. Deterministic evidence prefetch for the detected intent.
  const prefetched: string[] = [];
  for (const step of prefetchPlan(message)) {
    const outcome = await executeJarvisTool(step.tool, step.args, gateway);
    trace.push(traceEntry(outcome));
    prefetched.push(`${step.tool} → ${toolOutputText(outcome).slice(0, 6000)}`);
  }

  const statusBlock = status
    ? JSON.stringify({
        today: status.today,
        accepted_today: status.accepted_today,
        capacity: status.capacity,
        capacity_meaning:
          "real approved production tasks accepted today (excludes proposals and validation fixtures)",
        proposed_count: status.proposed_count,
        release_queue: status.release_queue,
        validation_fixtures: status.validation_fixtures,
        active_session: status.active_session
          ? {
              id: status.active_session.id,
              status: status.active_session.status,
              summary: status.active_session.summary,
            }
          : null,
        latest_session: status.latest_session
          ? {
              status: status.latest_session.status,
              date: status.latest_session.session_date,
              summary: status.latest_session.summary,
            }
          : null,
        status_counts: status.status_counts,
        open_tasks: status.open_tasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          blocker: t.blocker,
        })),
        recently_completed: status.recently_completed.map((t: any) => t.title),
        approvals_required: status.approvals_required,
        latest_self_research: status.self_improvement_research[0]
          ? {
              topic: status.self_improvement_research[0].topic,
              classification: status.self_improvement_research[0].classification,
            }
          : null,
      })
    : "unavailable";

  let exposed = selectJarvisTools(message);
  const system = [
    JARVIS_PERSONA,
    `RELEVANT JARVIS KNOWLEDGE (priority: Adam's latest explicit decision → current contract → live/source → history):\n${formatKnowledgeForPrompt(ranked)}`,
    `LIVE JARVIS ENGINEERING STATE (authoritative, from jarvis_engineering_sessions/tasks):\n${statusBlock}`,
    prefetched.length ? `EVIDENCE ALREADY GATHERED THIS TURN:\n${prefetched.join("\n\n")}` : "",
    `Today (America/New_York): ${state.easternDate()}. Tool names use "__" in place of ".".`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const history = input.history.slice(-12).map((turn) => ({
    role: turn.speaker === "user" ? "user" : "assistant",
    content: [
      {
        type: turn.speaker === "user" ? "input_text" : "output_text",
        text: turn.content.slice(0, 4000),
      },
    ],
  }));

  // 4. Bounded tool loop.
  let previousId: string | null = null;
  let nextInput: unknown[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: message },
  ];
  const maxRounds = input.maxRounds ?? 7;
  let toolCalls = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const response: Response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        input: nextInput,
        tools: modelTools(exposed),
        tool_choice: round === maxRounds - 1 || toolCalls >= 14 ? "none" : "auto",
        ...(previousId ? { previous_response_id: previousId } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `JARVIS model call failed (${response.status}): ${redactSecrets(detail).slice(0, 200)}`,
      );
    }
    const payload: any = await response.json();
    previousId = payload.id ?? null;
    const calls = (Array.isArray(payload.output) ? payload.output : []).filter(
      (item: any) => item?.type === "function_call",
    );
    if (!calls.length) {
      const text = responseText(payload);
      if (!text) throw new Error("JARVIS returned an empty response.");
      return {
        text,
        toolTrace: trace,
        approvalRequired: /approv/i.test(text) && trace.some((t) => t.summary === "policy"),
        gate: null,
        knowledgeUsed: ranked.map((k) => k.id),
      };
    }
    const outputs: unknown[] = [];
    for (const call of calls) {
      toolCalls += 1;
      const name = fromModelToolName(String(call.name ?? ""));
      let args: unknown = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        args = {};
      }
      const outcome = await executeJarvisTool(name, args, gateway);
      trace.push(traceEntry(outcome));
      // Replan step: capability.search widens the exposed tool set for the next round.
      if (name === "capability.search" && outcome.ok) {
        const found = ((outcome.result as any)?.results ?? [])
          .map((r: any) => r.name)
          .filter((n: string) => JARVIS_TOOLS.some((t) => t.name === n));
        exposed = selectJarvisTools(message, [...exposed, ...found]);
      }
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: toolOutputText(outcome),
      });
    }
    nextInput = outputs;
  }
  throw new Error("JARVIS reached its tool-round limit without a final answer.");
}

// ------------------------------------------------- Emery self-awareness block

/**
 * Authoritative release/deployment context for Emery's main conversation. Only
 * loaded when Adam asks a self-awareness question, so normal turns pay nothing.
 */
export async function buildEmerySelfAwarenessBlock(gateway: GatewayContext) {
  const [deployment, changes, issues] = await Promise.all([
    executeJarvisTool("system.get_deployment", {}, gateway),
    executeJarvisTool("system.get_recent_changes", {}, gateway),
    executeJarvisTool("system.get_known_issues", {}, gateway),
  ]);
  const payload = {
    deployment: deployment.ok
      ? (deployment.result as any)?.reconciliation
      : { error: deployment.error },
    served_build_id: deployment.ok ? (deployment.result as any)?.served?.build_id : null,
    recent_changes: changes.ok ? changes.result : { error: changes.error },
    known_issues: issues.ok
      ? {
          runtime_problems: ((issues.result as any)?.recent_runtime_problems ?? []).length,
          failed_receipts: ((issues.result as any)?.failed_receipts ?? []).length,
          open_backlog: ((issues.result as any)?.open_backlog ?? [])
            .map((b: any) => b.title)
            .slice(0, 5),
        }
      : { error: issues.error },
  };
  return `EMERY SELF-AWARENESS (authoritative: emery_releases ledger + live deployment observation + GitHub main + runtime health):
${redactSecrets(JSON.stringify(payload)).slice(0, 9000)}
Answer version/upgrade questions ONLY from this block. Report the production commit (short SHA) and where it came from. List only releases that are actually recorded; if only a baseline exists, say no detailed changelog has been recorded yet rather than inventing upgrades. Items under candidate_upgrades_not_deployed are JARVIS-prepared PRs awaiting Adam's release review: describe them as pending, never as live. If there are discrepancies, mention them plainly.`;
}
