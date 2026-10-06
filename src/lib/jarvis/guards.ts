// JARVIS repository guards: pure functions with no imports so the SAME file can
// run inside the Supabase Edge Function (supabase/functions/jarvis-github/guards.ts
// must stay byte-identical; scripts/validate-jarvis-run1.mjs enforces this).

const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "production",
  "prod",
  "release",
  "gh-pages",
  "HEAD",
]);
// The PR #10 working branch belongs to the engineering session that created it.
const FOREIGN_BRANCH_PREFIXES = ["jarvis-engineer-foundation"];

export function assertCandidateBranch(name: string): string {
  const branch = String(name ?? "")
    .trim()
    .replace(/^refs\/heads\//, "");
  if (!branch.startsWith("jarvis/"))
    throw new PolicyError(
      "Candidate branches must be named jarvis/<slug>. main and other branches are protected.",
    );
  if (!/^jarvis\/[a-z0-9][a-z0-9._\-/]{1,80}$/i.test(branch) || branch.includes(".."))
    throw new PolicyError("Invalid candidate branch name.");
  const bare = branch.slice("jarvis/".length);
  if (PROTECTED_BRANCHES.has(bare) || FOREIGN_BRANCH_PREFIXES.some((p) => bare.startsWith(p)))
    throw new PolicyError("That branch name is protected.");
  return branch;
}

const BLOCKED_PATHS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|\/)\.env($|\.(?!example$))/,
    reason: "environment files hold configuration/secrets",
  },
  { pattern: /^\.github\/workflows\//, reason: "CI workflow changes can disable security checks" },
  {
    pattern: /^src\/integrations\/supabase\/(client|client\.server|auth-middleware|cron-auth)\.ts$/,
    reason: "generated auth/client integration",
  },
  { pattern: /(^|\/)(\.git|node_modules)\//, reason: "repository internals" },
  { pattern: /\.(pem|key|p12|pfx)$/i, reason: "key material" },
];

export function assertSafeRepoPath(path: string): string {
  const clean = String(path ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.length > 300)
    throw new PolicyError("Invalid repository path.");
  const blocked = BLOCKED_PATHS.find((entry) => entry.pattern.test(clean));
  if (blocked) throw new PolicyError(`Writing ${clean} is protected (${blocked.reason}).`);
  return clean;
}

const SECRET_CONTENT_PATTERNS = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /sb_secret_[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
];

const SECURITY_WEAKENING_PATTERNS = [
  /disable\s+row\s+level\s+security/i,
  /drop\s+policy/i,
  /grant\s+(all|insert|update|delete)[^;]*\bto\s+anon\b/i,
  /security\s+definer[\s\S]{0,400}grant\s+execute[^;]*\bto\s+(anon|public)\b/i,
];

export function assertSafeContent(path: string, content: string) {
  const text = String(content ?? "");
  if (text.length > 400_000) throw new PolicyError("Candidate file is too large.");
  if (SECRET_CONTENT_PATTERNS.some((p) => p.test(text)))
    throw new PolicyError(`Refusing to commit ${path}: it appears to contain a credential.`);
  if (SECURITY_WEAKENING_PATTERNS.some((p) => p.test(text)))
    throw new PolicyError(
      `Refusing to commit ${path}: it weakens database security (RLS/grants). Needs Adam's review.`,
    );
}

export class PolicyError extends Error {
  readonly policy = true;
}

/** Remove anything that looks like a credential before text reaches a model or a log. */
export function redactSecrets(text: string): string {
  let out = String(text ?? "");
  for (const pattern of SECRET_CONTENT_PATTERNS)
    out = out.replace(new RegExp(pattern.source, "g"), "[redacted]");
  return out.replace(/(authorization:\s*bearer\s+)\S+/gi, "$1[redacted]");
}
