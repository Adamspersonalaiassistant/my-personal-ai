// Release gate: decides whether a JARVIS candidate PR may be merged to main
// WITHOUT a fresh human approval ("auto low-risk release"), and what is never
// mergeable at all. Pure and dependency-free so it is unit-tested in Node and
// enforced in the worker at the one place a merge can happen.
//
// Adam's policy (2026-10-06), four tiers:
//   AUTO        docs, validation scripts, honest "not connected" capability notes
//               within size limits: released without a fresh approval.
//   NEEDS ADAM  normal Emery/JARVIS source, UI, HPO, edge functions, config:
//               merged only after Adam's approval bound to the exact head sha.
//   MANUAL ONLY JARVIS's own release guardrails (gate, operator, gateway, guards,
//               policy), CI workflows and database migrations: JARVIS never
//               merges these, even with approval; a person merges them.
//   NEVER       secrets, keys and environment/credential files.

export type PrFile = {
  filename: string;
  status: string; // added | modified | removed | renamed | ...
  additions: number;
  deletions: number;
  patch?: string | null;
};

export const AUTO_RELEASE_LIMITS = {
  maxFiles: 8,
  maxChangedLines: 200,
  maxAutoReleasesPerDay: 3,
};

/** Paths a low-risk auto release may touch. Everything else needs Adam. */
const AUTO_ALLOWED: RegExp[] = [
  /^docs\//,
  /^scripts\/validate-[\w.-]+\.mjs$/,
  /^src\/lib\/execution-capabilities\.ts$/,
];

/** Never mergeable by anyone through JARVIS. */
const NEVER_MERGEABLE: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\/)\.env/, reason: "environment files" },
  { pattern: /\.(pem|key|p12|pfx)$/i, reason: "key material" },
  { pattern: /(^|\/)(secrets?|credentials?)[\w.-]*$/i, reason: "credential files" },
];

/** JARVIS may not merge these even with approval: a person reviews and merges them. */
const MANUAL_ONLY: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\.github\//, reason: "CI/deploy workflows" },
  {
    pattern: /^supabase\/migrations\//,
    reason: "database migrations (must be applied by a person)",
  },
  {
    pattern:
      /^supabase\/functions\/(jarvis-worker|jarvis-github)\/(release-gate|release|proxy|guards)\.ts$/,
    reason: "JARVIS release guardrails and GitHub gateway",
  },
  {
    pattern: /^src\/lib\/jarvis\/(policy|guards|github|request-auth)\.ts$/,
    reason: "JARVIS safety policy",
  },
  { pattern: /^supabase\/config\.toml$/, reason: "function auth configuration" },
];

/** Mergeable after Adam's sha-bound approval, never automatically. */
const NEEDS_ADAM: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^supabase\/functions\//, reason: "edge function (auto-deployed after merge)" },
  { pattern: /^src\/integrations\//, reason: "generated auth/database integration" },
  {
    pattern: /^src\/lib\/(hpo-|hpo\/)|^src\/components\/Hpo|^src\/routes\/.*hpo/i,
    reason: "protected HPO workflow",
  },
  { pattern: /^src\/lib\/jarvis\//, reason: "JARVIS runtime code" },
  { pattern: /auth|security|rls|cron-auth/i, reason: "auth/security-sensitive path" },
  {
    pattern:
      /^(package(-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|vite\.config\.\w+|wrangler\.\w+|tsconfig.*\.json)$/,
    reason: "build/dependency configuration",
  },
  { pattern: /^src\/(routes|components)\//, reason: "user interface" },
  { pattern: /^src\//, reason: "Emery runtime behaviour" },
];

export type ReleaseDecision = {
  /** JARVIS may merge it at all (given Adam's approval or the auto policy). */
  mergeable: boolean;
  /** A person must merge it outside JARVIS (guardrails, workflows, migrations). */
  manualOnly: boolean;
  /** May be merged without a fresh human approval. */
  auto: boolean;
  reasons: string[];
  changedLines: number;
  files: number;
};

/** The execution-capabilities file may only GAIN "not connected" entries: never claim a new executable ability. */
function capabilityPatchIsHonest(file: PrFile) {
  const patch = String(file.patch ?? "");
  if (!patch) return false;
  const lines = patch.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
  if (removed.length) return false;
  return !added.some((l) => /canExecute:\s*true/.test(l) || /externalSync:\s*true/.test(l));
}

export function evaluateReleaseGate(files: PrFile[]): ReleaseDecision {
  const reasons: string[] = [];
  let mergeable = true;
  let manualOnly = false;
  let auto = true;
  const changedLines = files.reduce((n, f) => n + (f.additions ?? 0) + (f.deletions ?? 0), 0);
  if (!files.length)
    return {
      mergeable: false,
      manualOnly: false,
      auto: false,
      reasons: ["No changed files."],
      changedLines: 0,
      files: 0,
    };

  for (const file of files) {
    const name = file.filename;
    const never = NEVER_MERGEABLE.find((e) => e.pattern.test(name));
    if (never) {
      mergeable = false;
      auto = false;
      reasons.push(`${name}: ${never.reason} can never be merged by JARVIS.`);
      continue;
    }
    const manual = MANUAL_ONLY.find((e) => e.pattern.test(name));
    if (manual) {
      mergeable = false;
      manualOnly = true;
      auto = false;
      reasons.push(`${name}: ${manual.reason} — a person merges this, never JARVIS.`);
      continue;
    }
    if (AUTO_ALLOWED.some((p) => p.test(name))) {
      if (file.status === "removed" || file.status === "renamed") {
        auto = false;
        reasons.push(`${name}: deletions and renames need Adam.`);
      } else if (
        /^src\/lib\/execution-capabilities\.ts$/.test(name) &&
        !capabilityPatchIsHonest(file)
      ) {
        auto = false;
        reasons.push(
          `${name}: may only add 'not connected' entries automatically; claiming a new executable capability needs Adam.`,
        );
      }
      continue;
    }
    const needs = NEEDS_ADAM.find((e) => e.pattern.test(name));
    auto = false;
    reasons.push(
      needs ? `${name}: ${needs.reason}.` : `${name}: outside the low-risk auto-release scope.`,
    );
  }
  if (files.length > AUTO_RELEASE_LIMITS.maxFiles) {
    auto = false;
    reasons.push(
      `${files.length} files exceeds the auto-release limit (${AUTO_RELEASE_LIMITS.maxFiles}).`,
    );
  }
  if (changedLines > AUTO_RELEASE_LIMITS.maxChangedLines) {
    auto = false;
    reasons.push(
      `${changedLines} changed lines exceeds the auto-release limit (${AUTO_RELEASE_LIMITS.maxChangedLines}).`,
    );
  }
  if (!mergeable) auto = false;
  return { mergeable, manualOnly, auto, reasons, changedLines, files: files.length };
}

/** One-line, plain-language explanation of a decision (for the status panel and notifications). */
export function describeDecision(decision: ReleaseDecision) {
  if (decision.auto)
    return "Low risk: documentation, validation or capability-note change within size limits.";
  if (decision.manualOnly)
    return `Manual release only: ${decision.reasons[0] ?? "guardrail change"}`;
  if (!decision.mergeable) return `Blocked: ${decision.reasons[0] ?? "protected content"}`;
  return `Needs your approval: ${decision.reasons.slice(0, 2).join(" ")}`.slice(0, 300);
}

/** What a merged change needs before it is live. */
export function deploymentNeeds(files: PrFile[]) {
  const functions = [
    ...new Set(
      files
        .map((f) => /^supabase\/functions\/([\w-]+)\//.exec(f.filename)?.[1])
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  // Anything Lovable builds (outside docs/, scripts/, supabase/, .github/) needs a frontend publish.
  const frontend = files.some((f) => !/^(docs|scripts|supabase|\.github)\//.test(f.filename));
  return { functions, frontend };
}
