import { readFileSync } from "node:fs";

const files = {
  improvement: readFileSync("src/lib/improvement.functions.ts", "utf8"),
  identity: readFileSync("src/lib/assistant-identity.ts", "utf8"),
  agentPolicy: readFileSync("src/lib/agent-policy.ts", "utf8"),
  emery: readFileSync("src/lib/emery.functions.ts", "utf8"),
  settings: readFileSync("src/routes/_authenticated/settings.tsx", "utf8"),
  migration: readFileSync(
    "supabase/migrations/20260912142200_emery_self_improvement_core.sql",
    "utf8",
  ),
};

const checks = [
  ["safe config allowlist exists", files.improvement.includes("SAFE_CONFIG_KEYS")],
  [
    "validated config changes require a passed evaluation",
    files.improvement.includes("validation?.passed") &&
      files.improvement.includes("criticalFailures") &&
      files.improvement.includes("zero critical failures"),
  ],
  ["rollback path exists", files.improvement.includes("rollbackImprovementChange")],
  [
    "runtime config cannot expose arbitrary settings",
    files.improvement.includes("That setting is outside Emery's safe autonomy boundary"),
  ],
  [
    "self-improvement data is protected by RLS",
    [
      "emery_improvement_backlog",
      "emery_self_evaluations",
      "emery_improvement_changes",
      "emery_config",
      "emery_agent_metrics",
    ].every((table) =>
      files.migration.includes(`alter table public.${table} enable row level security`),
    ),
  ],
  ["System Health is visible in Settings", files.settings.includes("ImprovementHealthCard")],
  [
    "Emery identity rejects secret self-modification claims",
    files.identity.includes("Do not claim secret autonomous self-modification or sentience"),
  ],
  [
    "explicit agent creation remains gated",
    files.agentPolicy.includes("isExplicitAgentCreationCommand"),
  ],
  [
    "Emery does not claim writes without confirmation",
    files.emery.includes("Do not claim any database action unless it says the action succeeded"),
  ],
  [
    "external calendar claims remain bounded",
    files.emery.includes("Do not claim external calendar sync"),
  ],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} Emery improvement regression check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} Emery improvement regression checks passed.`);
