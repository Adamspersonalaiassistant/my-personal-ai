import type { CapabilityRoute } from "./capability-router.ts";

export type EmeryContextLoadPolicy = {
  loadHpoOperatingContext: boolean;
  loadPersonalMemory: boolean;
  loadCalendarContext: boolean;
  loadLocation: boolean;
  isFocusedOperationalHpo: boolean;
};

/**
 * Converts the deterministic capability-router decision into a small loading policy.
 * This does not perform reads or writes. It exists so Chat and Voice can eventually
 * share the same context-budget rules without duplicating routing logic.
 */
export function contextLoadPolicy(route: CapabilityRoute): EmeryContextLoadPolicy {
  const isFocusedOperationalHpo =
    route.needsHpoContext &&
    !route.needsPersonalMemory &&
    !route.needsCalendar &&
    route.confidence >= 0.94 &&
    route.candidateCapabilities.length > 0;

  return {
    // Focused field commands already have authoritative Current Context + canonical
    // controllers, so loading the broad HPO agent snapshot would be redundant.
    loadHpoOperatingContext: route.needsHpoContext && !isFocusedOperationalHpo,
    loadPersonalMemory: route.needsPersonalMemory,
    // Preserve Emery's existing broad Calendar/task context for general or personal
    // turns. Narrow it only for clearly deterministic HPO field operations.
    loadCalendarContext: route.needsCalendar || !isFocusedOperationalHpo,
    loadLocation: route.needsLocation,
    isFocusedOperationalHpo,
  };
}

export function emptyActionContext() {
  return {
    tasks: [],
    task_pool: [],
    scheduled_tasks: [],
    overdue_tasks: [],
    missed_time_blocks: [],
    projects: [],
    meetings: [],
    recent_execution_receipts: [],
  };
}
