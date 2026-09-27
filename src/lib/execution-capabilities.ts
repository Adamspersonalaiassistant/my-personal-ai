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
    actions: ["log non-PHI account touch", "set account follow-up"],
  },
  hpo_routes: {
    canExecute: true,
    actions: [
      "create route in Route Planner UI",
      "optimize route",
      "save field notes",
      "sync route block to Emery Calendar",
    ],
    conversationalRouteCreation: false,
  },
  voice: {
    canExecute: true,
    actions: ["Calendar actions", "HPO relationship actions", "HPO route notes"],
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
