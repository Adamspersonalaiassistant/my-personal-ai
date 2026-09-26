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
