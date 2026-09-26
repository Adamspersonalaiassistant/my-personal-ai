import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const fixtures = JSON.parse(read("scripts/fixtures/emery-regression-cases.json"));
const files = {
  calendar: read("src/lib/calendar-agent.ts"),
  emery: read("src/lib/emery.functions.ts"),
  hpo: read("src/lib/hpo-action-controller.ts"),
  hpoContext: read("src/lib/hpo-agent-context.ts"),
  voice: read("src/lib/voice.functions.ts"),
  voiceControl: read("src/components/EmeryVoiceControl.tsx"),
  shortcut: read("supabase/functions/emery-shortcut/index.ts"),
  canonicalCalendar: read("supabase/migrations/20260926221000_canonical_emery_action_execution.sql"),
  canonicalHpo: read("supabase/migrations/20260926231000_canonical_emery_hpo_actions.sql"),
  learningCore: read("supabase/migrations/20260926230000_zero_credit_research_completion_core.sql"),
};

const caseIds = new Set(fixtures.cases.map((item) => item.id));
const requiredCaseIds = [
  "calendar-explicit-range",
  "calendar-preserve-duration",
  "casual-mention-no-write",
  "explicit-task",
  "incomplete-lunch",
  "hpo-log-touch",
  "hpo-followup",
  "hpo-phi-boundary",
  "hpo-ownership",
  "route-no-invented-address",
  "working-state-reference",
  "correction-signal",
  "reversal-signal",
  "shortcut-parity",
  "voice-parity",
];

const checks = [
  ["all required Adam cases exist", requiredCaseIds.every((id) => caseIds.has(id))],
  ["Calendar controller preserves explicit durations", files.calendar.includes("Never shorten an explicit range") && files.canonicalCalendar.includes("v_duration")],
  ["Calendar controller distinguishes discussion from write permission", files.calendar.includes("Casual planning") || files.calendar.includes("not permission")],
  ["Main Emery records correction/reversal telemetry", files.emery.includes("userCorrectionSignal") && files.emery.includes("userReversalSignal")],
  ["Main Emery consumes learned memory budgets", files.emery.includes("memory_max_items") && files.emery.includes("memory_max_characters") && files.emery.includes("CURRENT LEARNED CONFIG")],
  ["Main Emery has a stable cacheable policy prefix", files.emery.includes("STABLE_RUNTIME_POLICY") && files.emery.includes("cachedInputTokens")],
  ["HPO controller blocks PHI", files.hpo.includes("contains_phi") && files.hpo.includes("patient-identifying")],
  ["HPO controller enforces explicit write authorization", files.hpo.includes("Only recognize an HPO database write when Adam clearly authorizes it")],
  ["HPO controller respects account ownership", files.hpo.includes("exclude_from_adam_route")],
  ["HPO canonical writes use database RPCs", files.hpo.includes('db.rpc("emery_hpo_log_touch"') && files.hpo.includes('db.rpc("emery_hpo_set_followup"') && files.canonicalHpo.includes("security invoker")],
  ["HPO context includes prospects, contacts, route history and route candidates", ["prospects","contacts","recent_route_history","route_candidates"].every((needle) => files.hpoContext.includes(needle))],
  ["Route candidates require stored addresses and ownership exclusions", files.learningCore.includes("p.address is not null") && files.learningCore.includes("a.address is not null") && files.learningCore.includes("exclude_from_adam_route")],
  ["Voice uses canonical HPO controller", files.voice.includes('name: "execute_hpo_action"') && files.voice.includes("executeVoiceHpoAction") && files.voiceControl.includes('name === "execute_hpo_action"')],
  ["Shortcut supports canonical HPO actions", files.shortcut.includes('"log_hpo_touch"') && files.shortcut.includes('db.rpc("emery_hpo_log_touch"') && files.shortcut.includes('db.rpc("emery_hpo_set_followup"')],
  ["Shortcut records cache/correction/reversal metrics", files.shortcut.includes("cachedInputTokens") && files.shortcut.includes("userCorrectionSignal") && files.shortcut.includes("userReversalSignal")],
  ["Safe self-tuning is evidence-gated and reversible", files.learningCore.includes("event_count >= 20") && files.learningCore.includes("rollback_state") && files.learningCore.includes("emery-safe-autotune")],
];

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}
if (failures) {
  console.error(`\n${failures} Adam-specific behavior certification check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} Adam-specific behavior certification checks passed across ${fixtures.cases.length} permanent cases.`);
