import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const files = {
  emery: read("src/lib/emery.functions.ts"),
  intelligence: read("src/lib/emery-intelligence.ts"),
  calendar: read("src/lib/calendar-agent.ts"),
  voice: read("src/lib/voice.functions.ts"),
  voiceControl: read("src/components/EmeryVoiceControl.tsx"),
  memory: read("src/lib/chat.functions.ts"),
  telemetry: read("src/lib/runtime-telemetry.ts"),
  modelPolicy: read("src/lib/model-policy.ts"),
  os: read("src/lib/os.functions.ts"),
  hpo: read("src/lib/hpo.functions.ts"),
  migration: read("supabase/migrations/20260926220000_phase0_zero_credit_foundation.sql"),
  canonicalMigration: read("supabase/migrations/20260926221000_canonical_emery_action_execution.sql"),
  proactiveMigration: read("supabase/migrations/20260926222000_emery_proactive_zero_credit_routines.sql"),
  shortcut: read("supabase/functions/emery-shortcut/index.ts"),
  hpoAction: read("src/lib/hpo-action-controller.ts"),
  hpoContext: read("src/lib/hpo-agent-context.ts"),
  completionCore: read("supabase/migrations/20260926230000_zero_credit_research_completion_core.sql"),
  canonicalHpo: read("supabase/migrations/20260926231000_canonical_emery_hpo_actions.sql"),
  authMiddleware: read("src/integrations/supabase/auth-middleware.ts"),
};

const checks = [
  ["rolling conversation state is wired", files.emery.includes("refreshRollingConversationState") && files.emery.includes("WORKING STATE")],
  ["runtime telemetry is wired", files.emery.includes("recordRuntimeEvent") && files.telemetry.includes("emery_runtime_events")],
  ["model policy is centralized", files.calendar.includes("MODEL_POLICY.action") && files.memory.includes("MODEL_POLICY.memory") && files.emery.includes("MODEL_POLICY.primary")],
  ["memory extraction skips low-signal turns", files.memory.includes("shouldAnalyzeAutomaticMemory")],
  ["voice exposes calendar action tool", files.voice.includes('name: "execute_calendar_action"')],
  ["voice client handles calendar action tool", files.voiceControl.includes("executeVoiceCalendarAction")],
  ["push status is observable", files.os.includes("getPushNotificationStatus")],
  ["HPO import staging remains available", files.hpo.includes("stageHpoImport")],
  ["security definer RPC execution is revoked", files.migration.includes("revoke execute on function public.sync_lunch_confirmation_workflow") && files.migration.includes("validate_internal_cron_token")],
  ["runtime telemetry table uses RLS", files.migration.includes("alter table public.emery_runtime_events enable row level security")],
  ["main Calendar writes use canonical action RPCs", (files.calendar.includes('db.rpc("emery_action_create_task_v2"') || files.calendar.includes('db.rpc("emery_action_create_task"')) && files.calendar.includes('db.rpc("emery_action_reschedule_event"')],
  ["canonical action RPCs run as invoker", files.canonicalMigration.includes("security invoker") && !files.canonicalMigration.includes("security definer")],
  ["Shortcut uses canonical action RPCs", (files.shortcut.includes('db.rpc("emery_action_create_task_v2"') || files.shortcut.includes('db.rpc("emery_action_create_task"')) && files.shortcut.includes('db.rpc("emery_action_reschedule_event"')],
  ["Shortcut loads rolling working state", files.shortcut.includes("rollingState") && files.shortcut.includes("WORKING STATE")],
  ["server-side proactive routines are scheduled", files.proactiveMigration.includes("run_emery_proactive_checks") && files.proactiveMigration.includes("emery-proactive-checks")],
  ["nightly self-review writes evaluations", files.proactiveMigration.includes("emery_self_evaluations") && files.proactiveMigration.includes("nightly_self_review")],
  ["proactivity is idempotent", files.proactiveMigration.includes("emery_routine_runs") && files.proactiveMigration.includes("on conflict(user_id,routine_key,run_key) do nothing")],
  ["learned config is consumed at runtime", files.emery.includes("memory_max_items") && files.emery.includes("CURRENT LEARNED CONFIG")],
  ["prompt cache usage is measured", files.emery.includes("cachedInputTokens") && files.shortcut.includes("cachedInputTokens")],
  ["HPO actions are canonical across Main Emery and Shortcut", files.emery.includes("processHpoAction") && files.shortcut.includes('db.rpc("emery_hpo_log_touch"') && files.canonicalHpo.includes("security invoker")],
  ["HPO context includes real route intelligence", files.hpoContext.includes("route_candidates") && files.hpoContext.includes("recent_route_history") && files.completionCore.includes("get_hpo_route_candidates")],
  ["bounded self-adaptation is active", files.completionCore.includes("run_emery_safe_autotune") && files.completionCore.includes("event_count >= 20") && files.completionCore.includes("rollback_state")],
  ["runtime events populate agent metrics", files.completionCore.includes("emery_runtime_event_to_agent_metric")],
  ["private instance enforces owner gate", files.authMiddleware.includes("is_emery_owner") && files.completionCore.includes("emery_owner_registry")],
  ["security event ledger exists", files.completionCore.includes("emery_security_events")],
];

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
}
if (failures) {
  console.error(`\n${failures} Phase 0 certification check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} Phase 0 certification checks passed.`);
