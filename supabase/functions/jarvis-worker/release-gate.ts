// Release gate: decides whether a JARVIS candidate PR may be merged to main
// WITHOUT a fresh human approval ("auto low-risk release"), and what is never
// mergeable at all. Pure and dependency-free so it is unit-tested in Node and
// enforced in the worker at the one place a merge can happen.
//
// Adam's policy (2026-10-06): JARVIS auto-releases low-risk, test-covered,
// non-protected changes and reports afterwards; everything else waits for his
// explicit "Approve it". JARVIS never auto-merges changes to his own safety
// code, the release gate, the GitHub gateway, authentication, secrets, CI,
// migrations, database functions, HPO workflows or the UI shell.

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

/** Never auto-releasable (and, for the first group, never mergeable even with approval). */
const NEVER_MERGEABLE: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\.github\//, reason: "CI/workflow files" },
  { pattern: /(^|\/)\.env/, reason: "environment files" },
  { pattern: /\.(pem|key|p12|pfx)$/i, reason: "key material" },
  { pattern: /(^|\/)(secrets?|credentials?)[\w.-]*$/i, reason: "credential files" },
];

const NEEDS_ADAM: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^supabase\/migrations\//, reason: "database migration" },
  { pattern: /^supabase\/functions\//, reason: "edge function (deployed separately)" },
  { pattern: /^src\/integrations\//, reason: "generated auth/database integration" },
  { pattern: /^src\/lib\/(hpo-|hpo\/)|^src\/components\/Hpo|^src\/routes\/.*hpo/i, reason: "protected HPO workflow" },
  {
    pattern:
      /^src\/lib\/jarvis\/(policy|guards|github|request-auth|release-gate|tool-gateway|runtime|room)\.ts$/,
    reason: "JARVIS safety/policy/release code (JARVIS never auto-releases changes to his own guardrails)",
  },
  { pattern: /auth|security|rls|secret|credential|cron-auth/i, reason: "auth/security-sensitive path" },
  { pattern: /^(package(-lock)?\.json|bun\.lockb?|pnpm-lock\.yaml|vite\.config\.\w+|wrangler\.\w+|tsconfig.*\.json)$/, reason: "build/dependency configuration" },
  { pattern: /^src\/(routes|components)\//, reason: "user interface" },
];

export type ReleaseDecision = {
  /** May be merged at all (given Adam's approval or the auto policy). */
  mergeable: boolean;
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
  let auto = true;
  const changedLines = files.reduce((n, f) => n + (f.additions ?? 0) + (f.deletions ?? 0), 0);
  if (!files.length) return { mergeable: false, auto: false, reasons: ["No changed files."], changedLines: 0, files: 0 };

  for (const file of files) {
    const name = file.filename;
    const never = NEVER_MERGEABLE.find((e) => e.pattern.test(name));
    if (never) {
      mergeable = false;
      auto = false;
      reasons.push(`${name}: ${never.reason} can never be merged by JARVIS.`);
      continue;
    }
    const needs = NEEDS_ADAM.find((e) => e.pattern.test(name));
    if (needs) {
      auto = false;
      reasons.push(`${name}: ${needs.reason}.`);
      continue;
    }
    if (!AUTO_ALLOWED.some((p) => p.test(name))) {
      auto = false;
      reasons.push(`${name}: outside the low-risk auto-release scope.`);
      continue;
    }
    if (file.status === "removed" || file.status === "renamed") {
      auto = false;
      reasons.push(`${name}: deletions and renames need Adam.`);
      continue;
    }
    if (/^src\/lib\/execution-capabilities\.ts$/.test(name) && !capabilityPatchIsHonest(file)) {
      auto = false;
      reasons.push(`${name}: may only add 'not connected' entries; it must never claim a new executable capability.`);
    }
  }
  if (files.length > AUTO_RELEASE_LIMITS.maxFiles) {
    auto = false;
    reasons.push(`${files.length} files exceeds the auto-release limit (${AUTO_RELEASE_LIMITS.maxFiles}).`);
  }
  if (changedLines > AUTO_RELEASE_LIMITS.maxChangedLines) {
    auto = false;
    reasons.push(`${changedLines} changed lines exceeds the auto-release limit (${AUTO_RELEASE_LIMITS.maxChangedLines}).`);
  }
  if (!mergeable) auto = false;
  return { mergeable, auto, reasons, changedLines, files: files.length };
}

/** One-line, plain-language explanation of a decision (for the status panel and notifications). */
export function describeDecision(decision: ReleaseDecision) {
  if (decision.auto) return "Low-risk: documentation/test/capability-note change, within size limits.";
  if (!decision.mergeable) return `Blocked: ${decision.reasons[0] ?? "protected content"}`;
  return `Needs your approval: ${decision.reasons.slice(0, 2).join(" ")}`.slice(0, 300);
}
