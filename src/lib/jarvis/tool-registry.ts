// JARVIS Engineer tool registry.
//
// Every tool JARVIS can call is declared here with a family, a risk class and a
// JSON-schema for its arguments. The gateway (tool-gateway.ts) refuses to run a
// tool whose risk class does not permit autonomous execution, so policy is
// enforced in code, not only in prompt text.

export type JarvisToolRisk = "READ" | "REVERSIBLE_WRITE" | "HIGH_RISK_WRITE" | "PROTECTED";

export type JarvisToolFamily =
  | "github"
  | "supabase"
  | "lovable"
  | "research"
  | "evaluation"
  | "capability"
  | "system"
  | "jarvis";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type JarvisToolDefinition = {
  name: string;
  family: JarvisToolFamily;
  risk: JarvisToolRisk;
  description: string;
  keywords: string[];
  parameters: JsonSchema;
  /** Uses paid AI-generation / implementation credits outside Adam's baseline. */
  paidCredit?: boolean;
  /** Server env vars the tool needs (names only — values never leave the server). */
  requiresEnv?: string[];
};

const noArgs: JsonSchema = { type: "object", properties: {}, additionalProperties: false };
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

const TASK_PROPERTIES = {
  title: str("Short task title"),
  objective: str("Desired outcome (what done looks like)"),
  why_it_matters: str("Impact on Adam/Emery"),
  priority: num("1 (highest) – 5"),
  risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
  source_type: str(
    "adam | chatgpt_batch | claude_batch | runtime | evaluation | capability_gap | user_correction | regression | research",
  ),
  kind: { type: "string", enum: ["code_change", "diagnostic"] },
  target_paths: {
    type: "array",
    items: { type: "string" },
    description: "Repo files the code change should read/edit (src/, scripts/ or docs/).",
  },
  edits: {
    type: "array",
    description:
      "Optional exact edits: {path, find, replace} or {path, create: true, content}. Validated by the worker.",
    items: { type: "object" },
  },
  checks: {
    type: "array",
    description:
      "Diagnostic checks: {type:'db_count', table, days, min} | {type:'github_file', path, contains} | {type:'radar_dry_run'}.",
    items: { type: "object" },
  },
};

function tool(def: JarvisToolDefinition): JarvisToolDefinition {
  return def;
}

const GITHUB_ENV = ["JARVIS_GITHUB_TOKEN"];

export const JARVIS_TOOLS: JarvisToolDefinition[] = [
  // ---------------------------------------------------------------- GitHub
  tool({
    name: "github.inspect_repo",
    family: "github",
    risk: "READ",
    description: "Repository metadata: default branch, visibility, latest main commit, open PRs.",
    keywords: ["github", "repo", "repository", "main", "branch", "inspect", "source", "code"],
    parameters: noArgs,
  }),
  tool({
    name: "github.search_code",
    family: "github",
    risk: "READ",
    description:
      "Search Emery source for a string/identifier. Uses GitHub code search with a token, or a tree+raw-file scan without one.",
    keywords: [
      "search",
      "code",
      "grep",
      "find",
      "where",
      "source",
      "function",
      "file",
      "implementation",
    ],
    parameters: {
      type: "object",
      properties: {
        query: str("Text or identifier to find"),
        path_prefix: str("Optional directory prefix, e.g. src/lib"),
        ref: str("Optional branch or commit (default: main)"),
      },
      required: ["query"],
    },
  }),
  tool({
    name: "github.read_file",
    family: "github",
    risk: "READ",
    description:
      "Read a file from the repository at a ref (default main). Large files are truncated.",
    keywords: ["read", "file", "source", "open", "contents", "code"],
    parameters: {
      type: "object",
      properties: {
        path: str("Repository-relative path"),
        ref: str("Branch or commit (default main)"),
        start_line: num("Optional first line (1-based)"),
        end_line: num("Optional last line"),
      },
      required: ["path"],
    },
  }),
  tool({
    name: "github.inspect_history",
    family: "github",
    risk: "READ",
    description: "Recent commits on a branch, optionally for one path.",
    keywords: ["history", "commits", "log", "changes", "recent", "changed", "upgrade", "release"],
    parameters: {
      type: "object",
      properties: {
        ref: str("Branch (default main)"),
        path: str("Optional file/directory path"),
        limit: num("Max commits (default 10, max 30)"),
      },
    },
  }),
  tool({
    name: "github.compare",
    family: "github",
    risk: "READ",
    description: "Compare two refs: ahead/behind counts, commits and changed files.",
    keywords: ["compare", "diff", "ahead", "behind", "branch", "discrepancy", "main"],
    parameters: {
      type: "object",
      properties: { base: str("Base ref"), head: str("Head ref") },
      required: ["base", "head"],
    },
  }),
  tool({
    name: "github.create_branch",
    family: "github",
    risk: "REVERSIBLE_WRITE",
    description:
      "Create an isolated candidate branch named jarvis/<slug> from main (or another ref). Never touches main.",
    keywords: ["branch", "create", "candidate", "isolate", "fix", "implement", "build"],
    parameters: {
      type: "object",
      properties: {
        name: str("Branch name; must start with jarvis/"),
        from_ref: str("Source ref (default main)"),
      },
      required: ["name"],
    },
    requiresEnv: GITHUB_ENV,
  }),
  tool({
    name: "github.edit_candidate",
    family: "github",
    risk: "REVERSIBLE_WRITE",
    description:
      "Replace one exact text occurrence in a file on a jarvis/ candidate branch and commit it as a checkpoint.",
    keywords: ["edit", "change", "modify", "fix", "patch", "replace", "update", "code"],
    parameters: {
      type: "object",
      properties: {
        branch: str("jarvis/ candidate branch"),
        path: str("File path"),
        find: str("Exact existing text (must occur exactly once)"),
        replace: str("Replacement text"),
        message: str("Commit message"),
      },
      required: ["branch", "path", "find", "replace", "message"],
    },
    requiresEnv: GITHUB_ENV,
  }),
  tool({
    name: "github.create_file",
    family: "github",
    risk: "REVERSIBLE_WRITE",
    description: "Create a new file on a jarvis/ candidate branch (fails if it already exists).",
    keywords: ["create", "new", "file", "add", "test", "doc"],
    parameters: {
      type: "object",
      properties: {
        branch: str("jarvis/ candidate branch"),
        path: str("New file path"),
        content: str("File content"),
        message: str("Commit message"),
      },
      required: ["branch", "path", "content", "message"],
    },
    requiresEnv: GITHUB_ENV,
  }),
  tool({
    name: "github.commit_candidate",
    family: "github",
    risk: "REVERSIBLE_WRITE",
    description:
      "Commit several full-file writes to a jarvis/ candidate branch as one checkpoint commit (fast-forward only, never force).",
    keywords: ["commit", "checkpoint", "save", "files", "multi", "candidate"],
    parameters: {
      type: "object",
      properties: {
        branch: str("jarvis/ candidate branch"),
        message: str("Commit message"),
        files: {
          type: "array",
          description: "Files to write",
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
      },
      required: ["branch", "message", "files"],
    },
    requiresEnv: GITHUB_ENV,
  }),
  tool({
    name: "github.inspect_ci",
    family: "github",
    risk: "READ",
    description: "CI check runs and commit statuses for a ref (default main).",
    keywords: ["ci", "checks", "build", "tests", "status", "failing", "green", "red", "verify"],
    parameters: { type: "object", properties: { ref: str("Branch or commit (default main)") } },
  }),
  tool({
    name: "github.create_pr",
    family: "github",
    risk: "REVERSIBLE_WRITE",
    description: "Open a pull request from a jarvis/ candidate branch. Never merges.",
    keywords: ["pr", "pull request", "open", "review", "propose", "ship"],
    parameters: {
      type: "object",
      properties: {
        head: str("jarvis/ candidate branch"),
        base: str("Base branch (default main)"),
        title: str("PR title"),
        body: str("PR description"),
        draft: { type: "boolean", description: "Open as draft (default true)" },
      },
      required: ["head", "title", "body"],
    },
    requiresEnv: GITHUB_ENV,
  }),
  tool({
    name: "github.update_pr",
    family: "github",
    risk: "REVERSIBLE_WRITE",
    description: "Update title/body of a PR whose head is a jarvis/ branch. Cannot merge or close.",
    keywords: ["pr", "update", "pull request", "description"],
    parameters: {
      type: "object",
      properties: {
        number: num("PR number"),
        title: str("New title"),
        body: str("New body"),
      },
      required: ["number"],
    },
    requiresEnv: GITHUB_ENV,
  }),
  tool({
    name: "github.merge_pr",
    family: "github",
    risk: "PROTECTED",
    description: "Merging into main is a production release decision. Adam approval required.",
    keywords: ["merge", "release", "ship", "deploy", "main"],
    parameters: { type: "object", properties: { number: num("PR number") }, required: ["number"] },
  }),

  // -------------------------------------------------------------- Supabase
  tool({
    name: "supabase.schema",
    family: "supabase",
    risk: "READ",
    description:
      "Database structure diagnostics: tables, RLS/policy coverage, mutable search_path functions, anon-executable SECURITY DEFINER functions, extensions in public, unindexed FKs.",
    keywords: [
      "schema",
      "database",
      "tables",
      "rls",
      "policy",
      "security",
      "advisor",
      "performance",
      "index",
      "supabase",
    ],
    parameters: noArgs,
  }),
  tool({
    name: "supabase.runtime_telemetry",
    family: "supabase",
    risk: "READ",
    description: "Recent Emery runtime events: status breakdown and recent errors/clarifications.",
    keywords: [
      "errors",
      "telemetry",
      "runtime",
      "failing",
      "problems",
      "issues",
      "events",
      "recently",
      "struggling",
      "logs",
    ],
    parameters: { type: "object", properties: { days: num("Lookback days (default 7, max 30)") } },
  }),
  tool({
    name: "supabase.execution_receipts",
    family: "supabase",
    risk: "READ",
    description: "Recent canonical execution receipts (emery_execution_runs), especially failures.",
    keywords: ["receipts", "execution", "actions", "writes", "failed", "errors", "ledger"],
    parameters: { type: "object", properties: { days: num("Lookback days (default 7)") } },
  }),
  tool({
    name: "supabase.evaluations",
    family: "supabase",
    risk: "READ",
    description: "Latest Emery self-evaluations and their findings.",
    keywords: [
      "evaluation",
      "evals",
      "self",
      "scores",
      "quality",
      "findings",
      "errors",
      "problems",
    ],
    parameters: noArgs,
  }),
  tool({
    name: "supabase.improvement_backlog",
    family: "supabase",
    risk: "READ",
    description:
      "Emery improvement backlog: observed/proposed problems with severity and evidence.",
    keywords: [
      "backlog",
      "improve",
      "improvement",
      "next",
      "problems",
      "gaps",
      "struggling",
      "issues",
    ],
    parameters: noArgs,
  }),
  tool({
    name: "supabase.capability_gaps",
    family: "supabase",
    risk: "READ",
    description:
      "Recorded capability gaps (runtime events and backlog entries flagged as missing capability).",
    keywords: ["capability", "gap", "missing", "can't", "unsupported", "unable"],
    parameters: noArgs,
  }),
  tool({
    name: "supabase.advisors",
    family: "supabase",
    risk: "READ",
    description:
      "Supabase security/performance advisors via the management API (needs JARVIS_SUPABASE_ACCESS_TOKEN).",
    keywords: ["advisor", "security", "performance", "lint", "supabase"],
    parameters: {
      type: "object",
      properties: { type: { type: "string", enum: ["security", "performance"] } },
    },
    requiresEnv: ["JARVIS_SUPABASE_ACCESS_TOKEN"],
  }),
  tool({
    name: "supabase.logs",
    family: "supabase",
    risk: "READ",
    description:
      "Supabase platform logs via the management API (needs JARVIS_SUPABASE_ACCESS_TOKEN).",
    keywords: ["logs", "postgres", "api", "auth", "errors", "supabase"],
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", enum: ["postgres", "api", "auth", "edge-function"] },
      },
    },
    requiresEnv: ["JARVIS_SUPABASE_ACCESS_TOKEN"],
  }),
  tool({
    name: "supabase.apply_migration",
    family: "supabase",
    risk: "PROTECTED",
    description:
      "Applying DDL to production is approval-gated. Candidate migrations go into a jarvis/ branch instead.",
    keywords: ["migration", "ddl", "schema change", "production"],
    parameters: { type: "object", properties: { sql: str("SQL") }, required: ["sql"] },
  }),

  // ------------------------------------------------------- JARVIS ledger
  tool({
    name: "jarvis.get_status",
    family: "jarvis",
    risk: "READ",
    description:
      "Live JARVIS engineering state: active session, today's accepted tasks vs capacity, status counts, blockers, approvals.",
    keywords: [
      "working",
      "status",
      "tasks",
      "session",
      "queue",
      "doing",
      "progress",
      "blocked",
      "approval",
    ],
    parameters: noArgs,
  }),
  tool({
    name: "jarvis.search_knowledge",
    family: "jarvis",
    risk: "READ",
    description:
      "Retrieve the most relevant JARVIS knowledge items (Adam decisions, preferences, constraints, lessons).",
    keywords: [
      "know",
      "knowledge",
      "prefer",
      "like",
      "decision",
      "built",
      "rules",
      "constraints",
      "history",
      "lessons",
    ],
    parameters: {
      type: "object",
      properties: { query: str("What to retrieve"), limit: num("Max items (default 8)") },
      required: ["query"],
    },
  }),
  tool({
    name: "jarvis.create_task",
    family: "jarvis",
    risk: "REVERSIBLE_WRITE",
    description:
      "Create one engineering task (de-duplicated, risk-classified). It is PROPOSED unless Adam approved execution in this message; proposed tasks never run or use capacity. For code changes give target_paths (find them with github.search_code) or explicit edits; for checks give diagnostic checks.",
    keywords: ["task", "queue", "add", "todo", "work", "engineering", "fix", "build"],
    parameters: { type: "object", properties: TASK_PROPERTIES, required: ["title"] },
  }),
  tool({
    name: "jarvis.create_tasks",
    family: "jarvis",
    risk: "REVERSIBLE_WRITE",
    description:
      "Create a batch of up to 50 engineering tasks (e.g. a ChatGPT- or Claude-generated batch from Adam). The batch is PROPOSED unless Adam approved execution in this message; use jarvis.approve_tasks once he does. Duplicates merge; depends_on_index orders work.",
    keywords: ["batch", "tasks", "list", "chatgpt", "claude", "queue", "many", "schedule"],
    parameters: {
      type: "object",
      properties: {
        source_type: str("adam | chatgpt_batch | claude_batch | research"),
        tasks: {
          type: "array",
          description: "Tasks in order; depends_on_index refers to earlier items in this array.",
          items: {
            type: "object",
            properties: {
              ...TASK_PROPERTIES,
              depends_on_index: { type: "array", items: { type: "integer" } },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
  }),
  tool({
    name: "jarvis.approve_tasks",
    family: "jarvis",
    risk: "REVERSIBLE_WRITE",
    description:
      'Approve + schedule PROPOSED tasks for autonomous execution. Only works when Adam\'s own message approves execution ("execute these", "I approve", "schedule them"). Approved tasks are accepted by the worker into the production intake (50/day).',
    keywords: ["approve", "execute", "schedule", "proceed", "go ahead", "run these", "batch"],
    parameters: {
      type: "object",
      properties: {
        batch_id: str("batch_id returned by jarvis.create_tasks"),
        task_ids: { type: "array", items: { type: "string" } },
        all_proposed: { type: "boolean", description: "Approve every proposed task." },
      },
    },
  }),
  tool({
    name: "jarvis.approve_release",
    family: "jarvis",
    risk: "REVERSIBLE_WRITE",
    description:
      "Record Adam's approval to release ONE ready candidate (only when his own message says 'Approve it' / 'Approve PR N' / 'Ship that'). The approval is bound to that PR's exact head commit and the current production commit and expires in an hour or if the PR changes. This does NOT merge: the release operator in the durable worker re-checks CI, the release gate and the pinned commit, merges, deploys and verifies. Never merge by any other means.",
    keywords: ["approve", "release", "ship", "merge", "publish", "candidate", "pr"],
    parameters: {
      type: "object",
      properties: { pr_number: num("PR number; omit when exactly one candidate is ready") },
    },
  }),
  tool({
    name: "jarvis.supersede_batch",
    family: "jarvis",
    risk: "REVERSIBLE_WRITE",
    description:
      'Adam replaced a task plan ("I have a new prompt instead of the previous plan"). Supersedes the previous proposed batch (and untouched approved tasks when include_approved is true); work already in progress is returned for Adam\'s decision, never cancelled silently. History is kept; superseded tasks never count toward capacity.',
    keywords: [
      "supersede",
      "replace",
      "instead",
      "new plan",
      "new prompt",
      "scrap",
      "cancel batch",
    ],
    parameters: {
      type: "object",
      properties: {
        batch_id: str("Previous batch to supersede (default: all proposed tasks)"),
        include_approved: {
          type: "boolean",
          description: "Also supersede approved tasks that have not started.",
        },
        superseded_by_batch_id: str("batch_id of the replacement batch"),
      },
    },
  }),
  tool({
    name: "jarvis.update_task",
    family: "jarvis",
    risk: "REVERSIBLE_WRITE",
    description:
      "Update an engineering task's status/result with evidence (branch, commit, PR, test results, blocker).",
    keywords: ["task", "status", "update", "progress", "blocked", "completed"],
    parameters: {
      type: "object",
      properties: {
        id: str("Task id"),
        status: {
          type: "string",
          enum: [
            "queued",
            "validating",
            "researching",
            "planning",
            "building",
            "testing",
            "repairing",
            "ready_for_release",
            "completed",
            "blocked",
            "deferred",
            "failed",
            "cancelled",
          ],
        },
        result_summary: str("Evidence-based result"),
        blocker: str("Blocker, if any"),
        branch_name: str("Candidate branch"),
        commit_sha: str("Checkpoint commit"),
        pr_url: str("PR URL"),
      },
      required: ["id"],
    },
  }),
  tool({
    name: "jarvis.record_knowledge",
    family: "jarvis",
    risk: "REVERSIBLE_WRITE",
    description:
      "Record a structured knowledge item from Adam (decision, preference, constraint, lesson…). Sensitive data is rejected.",
    keywords: ["remember", "decision", "preference", "record", "knowledge", "note"],
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "product_decision",
            "user_preference",
            "constraint",
            "failure_signal",
            "workflow_requirement",
            "acceptance_test",
            "architecture",
            "history",
            "lesson",
            "research_reference",
          ],
        },
        title: str("Short title"),
        content: str("The knowledge itself"),
        importance: num("1–5"),
        supersedes_title: str("Title of an older item this replaces, if any"),
      },
      required: ["category", "title", "content"],
    },
  }),

  // -------------------------------------------------------------- Lovable
  tool({
    name: "lovable.get_project_state",
    family: "lovable",
    risk: "READ",
    description:
      "Published app reachability, served build id and served commit stamp, plus the last recorded Lovable observation.",
    keywords: ["lovable", "project", "published", "deployment", "production", "live", "state"],
    parameters: noArgs,
  }),
  tool({
    name: "lovable.get_preview_state",
    family: "lovable",
    risk: "READ",
    description: "Lovable preview URL reachability.",
    keywords: ["preview", "lovable", "staging"],
    parameters: noArgs,
  }),
  tool({
    name: "lovable.get_production_commit",
    family: "lovable",
    risk: "READ",
    description:
      "The commit the live production bundle reports (emery-commit stamp), with fallback to the recorded release ledger.",
    keywords: ["production", "commit", "version", "deployed", "running", "live", "sha"],
    parameters: noArgs,
  }),
  tool({
    name: "lovable.verify_build",
    family: "lovable",
    risk: "READ",
    description:
      "Verify a commit's build evidence: GitHub CI/status checks and preview reachability.",
    keywords: ["verify", "build", "ci", "preview"],
    parameters: { type: "object", properties: { ref: str("Commit or branch (default main)") } },
  }),
  tool({
    name: "lovable.verify_deployment",
    family: "lovable",
    risk: "READ",
    description:
      "Reconcile GitHub main, live production commit, emery_releases and runtime health; report discrepancies.",
    keywords: [
      "verify",
      "deployment",
      "reconcile",
      "discrepancy",
      "version",
      "release",
      "production",
    ],
    parameters: noArgs,
  }),
  tool({
    name: "lovable.ai_generate",
    family: "lovable",
    risk: "PROTECTED",
    paidCredit: true,
    description:
      "Send an AI-generation request to Lovable. Consumes paid Lovable credits — requires Adam's explicit approval.",
    keywords: ["lovable", "ai", "generate", "credits", "prompt lovable"],
    parameters: { type: "object", properties: { prompt: str("Prompt") }, required: ["prompt"] },
  }),

  // ------------------------------------------------------------- Research
  tool({
    name: "research.web_search",
    family: "research",
    risk: "READ",
    description:
      "Bounded web research on one specific engineering question (official docs, APIs, frameworks). Returns sourced findings.",
    keywords: [
      "research",
      "web",
      "docs",
      "documentation",
      "search",
      "api",
      "how",
      "best practice",
      "latest",
    ],
    parameters: {
      type: "object",
      properties: { question: str("The specific engineering question") },
      required: ["question"],
    },
  }),
  tool({
    name: "research.github_search",
    family: "research",
    risk: "READ",
    description:
      "Search public GitHub repositories for implementations of a pattern. Returns repo, stars, license.",
    keywords: ["github", "open source", "library", "repo", "example", "implementation", "reuse"],
    parameters: {
      type: "object",
      properties: { query: str("Search query"), language: str("Optional language filter") },
      required: ["query"],
    },
  }),
  tool({
    name: "research.license_check",
    family: "research",
    risk: "READ",
    description:
      "Check a GitHub repository's license and whether copying code into Emery is compatible.",
    keywords: ["license", "copy", "reuse", "mit", "apache", "gpl", "agpl"],
    parameters: {
      type: "object",
      properties: { repo: str("owner/name") },
      required: ["repo"],
    },
  }),
  tool({
    name: "research.record_finding",
    family: "research",
    risk: "REVERSIBLE_WRITE",
    description:
      "Record a research outcome (ignore/watch/test/adopt/engineering_task) with source and license note.",
    keywords: ["record", "finding", "research", "classify"],
    parameters: {
      type: "object",
      properties: {
        topic: str("Topic"),
        finding: str("Finding"),
        source_url: str("Source URL"),
        license_note: str("License note"),
        recommendation: str("Recommendation"),
        classification: {
          type: "string",
          enum: ["ignore", "watch", "test", "adopt", "engineering_task"],
        },
      },
      required: ["topic", "finding", "classification"],
    },
  }),

  // ---------------------------------------------------------- Evaluations
  tool({
    name: "emery.run_evaluations",
    family: "evaluation",
    risk: "READ",
    description:
      "Run Emery's canonical deterministic evaluation corpus in-process and summarise pass/fail signals.",
    keywords: ["test", "tests", "evaluate", "evaluation", "regression", "verify", "quality"],
    parameters: noArgs,
  }),

  // ----------------------------------------------------------- Capability
  tool({
    name: "capability.search",
    family: "capability",
    risk: "READ",
    description:
      "Search the full capability catalogue (Emery runtime capabilities + JARVIS tools + system self-awareness).",
    keywords: ["capability", "tool", "can", "able", "search", "find"],
    parameters: {
      type: "object",
      properties: { query: str("What you need to do"), limit: num("Max results (default 8)") },
      required: ["query"],
    },
  }),
  tool({
    name: "capability.describe",
    family: "capability",
    risk: "READ",
    description: "Describe one capability: risk, inputs, requirements and configuration.",
    keywords: ["capability", "describe", "details"],
    parameters: {
      type: "object",
      properties: { name: str("Capability name") },
      required: ["name"],
    },
  }),
  tool({
    name: "capability.health",
    family: "capability",
    risk: "READ",
    description:
      "Health of capabilities from real evidence (receipts, runtime events, configuration).",
    keywords: ["health", "healthy", "working", "degraded", "capability"],
    parameters: { type: "object", properties: { name: str("Optional capability name") } },
  }),

  // --------------------------------------------------------------- System
  tool({
    name: "system.get_version",
    family: "system",
    risk: "READ",
    description: "The running Emery build: commit stamp, build id and latest release record.",
    keywords: ["version", "running", "build", "commit", "release"],
    parameters: noArgs,
  }),
  tool({
    name: "system.get_deployment",
    family: "system",
    risk: "READ",
    description:
      "Deployment truth: running commit vs GitHub main vs release ledger, with discrepancies.",
    keywords: ["deployment", "deployed", "production", "live", "discrepancy"],
    parameters: noArgs,
  }),
  tool({
    name: "system.get_recent_changes",
    family: "system",
    risk: "READ",
    description: "Recent releases from emery_releases and recent main commits.",
    keywords: ["recent", "changes", "upgrades", "releases", "new", "changed", "updated"],
    parameters: noArgs,
  }),
  tool({
    name: "system.get_capabilities",
    family: "system",
    risk: "READ",
    description: "Summary of Emery/JARVIS registered capabilities by family.",
    keywords: ["capabilities", "can", "abilities", "features"],
    parameters: noArgs,
  }),
  tool({
    name: "system.get_capability_health",
    family: "system",
    risk: "READ",
    description: "Capability health summary from receipts and runtime events.",
    keywords: ["health", "healthy", "degraded", "working"],
    parameters: noArgs,
  }),
  tool({
    name: "system.get_known_issues",
    family: "system",
    risk: "READ",
    description:
      "Known issues: open improvement backlog, recent runtime errors, failed receipts, release known limitations.",
    keywords: ["issues", "problems", "errors", "known", "struggling", "bugs", "broken"],
    parameters: noArgs,
  }),
  tool({
    name: "system.get_improvement_status",
    family: "system",
    risk: "READ",
    description:
      "Improvement pipeline status: JARVIS tasks by status and improvement backlog by status.",
    keywords: ["improvement", "improve", "next", "status", "pipeline", "working"],
    parameters: noArgs,
  }),
];

const BY_NAME = new Map(JARVIS_TOOLS.map((def) => [def.name, def]));

export function getJarvisTool(name: string): JarvisToolDefinition | null {
  return BY_NAME.get(name) ?? null;
}

/** Tools that are always offered to the model regardless of relevance. */
export const JARVIS_CORE_TOOLS = [
  "capability.search",
  "capability.describe",
  "jarvis.get_status",
  "jarvis.search_knowledge",
  "system.get_version",
];

/** Function-calling tool names cannot contain dots for some providers. */
export function toModelToolName(name: string) {
  return name.replace(/\./g, "__");
}

export function fromModelToolName(name: string) {
  return name.replace(/__/g, ".");
}
