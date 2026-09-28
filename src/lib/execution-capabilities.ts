export const EMERY_EXECUTION_CAPABILITIES = {
  task_list: {
    canExecute: true,
    actions: [
      "create task",
      "complete task",
      "set task deadline",
      "schedule task on Emery Calendar",
      "unschedule task back to Task List",
      "batch schedule tasks",
    ],
  },
  calendar: {
    canExecute: true,
    actions: [
      "create Emery Calendar event",
      "reschedule Emery Calendar event",
      "attach reminder to task/event",
      "create standalone Emery reminder",
    ],
    externalSync: false,
  },
  notifications: {
    canExecute: true,
    actions: ["schedule Emery push notification", "dispatch while app is closed"],
    requiresPushSubscriptionForDeviceAlert: true,
  },
  hpo_relationships: {
    canExecute: true,
    actions: ["create/map explicit HPO account", "log non-PHI account touch", "set account follow-up"],
  },
  hpo_routes: {
    canExecute: true,
    actions: [
      "create route in Route Planner UI",
      "add offices to an existing route in HPO UI",
      "remove an unfinished route stop in HPO UI",
      "manually reorder route stops in HPO UI",
      "optimize full route",
      "reoptimize remaining unfinished route",
      "record arrival",
      "set route-stop outcome",
      "save field visit notes",
      "set route-stop follow-up",
      "find deterministic nearby backup offices",
      "complete a route after every stop has an outcome",
      "export completed route visits in tracker-ready format",
      "sync route block to Emery Calendar with verified execution",
      "read next stop / resume context / current account context in Text or Voice",
      "create and edit routes conversationally through Text or Voice",
    ],
    conversationalRouteCreation: true,
  },
  voice: {
    canExecute: true,
    actions: [
      "Calendar actions",
      "HPO account creation/mapping",
      "HPO relationship actions",
      "HPO route notes",
      "read HPO next stop / resume context / account brief",
    ],
  },
  recurring_automations: {
    canExecute: false,
    note: "General recurring background agent jobs are not enabled yet.",
  },
  apple_calendar: {
    canExecute: false,
    note: "Apple Calendar is not connected.",
  },
  google_calendar: {
    canExecute: false,
    note: "Google Calendar is not connected.",
  },
} as const;

export function executionCapabilityPrompt() {
  return JSON.stringify(EMERY_EXECUTION_CAPABILITIES);
}
