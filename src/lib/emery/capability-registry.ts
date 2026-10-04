import type { ActionRisk } from "./risk-policy.ts";

export type CapabilityMode = "read" | "write";
export type CapabilityHealthKey =
  | "calendar.read"
  | "calendar.write"
  | "hpo.route.read"
  | "hpo.route.write"
  | "hpo.crm.write"
  | "hpo.field_session"
  | "memory.retrieve"
  | "voice.session";

export type CapabilityRequirement =
  | "current_route"
  | "current_stop"
  | "selected_account"
  | "selected_prospect"
  | "field_session"
  | "expected_note_target"
  | "recent_receipt"
  | "location"
  | "resolved_entity";

export type CapabilityFallback =
  | "clarify"
  | "preserve_state"
  | "safe_noop"
  | "structured_read_only";

export type CapabilityRetryPolicy = {
  maxAttempts: number;
  retryOn: Array<"network_failure" | "timeout" | "routing_failure">;
};

export type CapabilityDefinition<TInput extends Record<string, unknown> = Record<string, unknown>> =
  {
    name: string;
    action: string;
    description: string;
    mode: CapabilityMode;
    risk: ActionRisk;
    idempotent: boolean;
    confirmation: "never" | "when_ambiguous" | "when_destructive";
    healthKey: CapabilityHealthKey;
    requires: CapabilityRequirement[];
    optional: CapabilityRequirement[];
    fallback: CapabilityFallback;
    timeoutMs: number;
    retryPolicy: CapabilityRetryPolicy;
    degradedBehavior: string;
    validate: (value: unknown) => TInput;
  };

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Capability input must be an object");
  return value as Record<string, unknown>;
}

function definition(
  input: Omit<
    CapabilityDefinition,
    | "risk"
    | "validate"
    | "requires"
    | "optional"
    | "fallback"
    | "timeoutMs"
    | "retryPolicy"
    | "degradedBehavior"
  > & {
    risk?: ActionRisk;
    requires?: CapabilityRequirement[];
    optional?: CapabilityRequirement[];
    fallback?: CapabilityFallback;
    timeoutMs?: number;
    retryPolicy?: CapabilityRetryPolicy;
    degradedBehavior?: string;
  },
): CapabilityDefinition {
  return {
    ...input,
    risk: input.risk ?? "medium",
    requires: input.requires ?? [],
    optional: input.optional ?? [],
    fallback: input.fallback ?? "safe_noop",
    timeoutMs: input.timeoutMs ?? 8000,
    retryPolicy: input.retryPolicy ?? { maxAttempts: 1, retryOn: [] },
    degradedBehavior:
      input.degradedBehavior ?? "Do not claim success; preserve current state and explain the limitation.",
    validate: objectInput,
  };
}

const NETWORK_READ_RETRY: CapabilityRetryPolicy = {
  maxAttempts: 2,
  retryOn: ["network_failure", "timeout"],
};

export const CAPABILITY_REGISTRY = {
  "entity.resolve": definition({
    name: "Entity resolution",
    action: "entity.resolve",
    description: "Resolve people and offices from structured Calendar and HPO evidence.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "when_ambiguous",
    healthKey: "hpo.route.read",
    optional: ["current_route", "selected_account"],
    fallback: "clarify",
    timeoutMs: 5000,
    retryPolicy: NETWORK_READ_RETRY,
    degradedBehavior: "Ask one short clarification instead of guessing the person or office.",
  }),
  "calendar.read": definition({
    name: "Calendar read",
    action: "calendar.read",
    description: "Read scheduled commitments without mutating Calendar.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "calendar.read",
    fallback: "structured_read_only",
    timeoutMs: 6000,
    retryPolicy: NETWORK_READ_RETRY,
    degradedBehavior: "Answer without inventing Calendar state and say live Calendar context is unavailable.",
  }),
  "memory.retrieve": definition({
    name: "Memory retrieval",
    action: "memory.retrieve",
    description: "Retrieve bounded personal memory only when the request benefits from durable personal context.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "memory.retrieve",
    fallback: "safe_noop",
    timeoutMs: 5000,
    retryPolicy: NETWORK_READ_RETRY,
    degradedBehavior: "Continue from live and recent context without pretending a memory was found.",
  }),
  "hpo.route.read": definition({
    name: "HPO route read",
    action: "hpo.route.read",
    description: "Read today's route, completed stops, and remaining stops.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "hpo.route.read",
    optional: ["current_route", "current_stop"],
    fallback: "structured_read_only",
    timeoutMs: 6000,
    retryPolicy: NETWORK_READ_RETRY,
    degradedBehavior: "Preserve the saved route and explain that current route state could not be refreshed.",
  }),
  "hpo.route.get_next_stop": definition({
    name: "Get next HPO stop",
    action: "hpo.route.get_next_stop",
    description: "Read the next unfinished stop from authoritative HPO route state.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "hpo.route.read",
    optional: ["current_route", "current_stop"],
    fallback: "clarify",
    timeoutMs: 5000,
    retryPolicy: NETWORK_READ_RETRY,
    degradedBehavior: "Say that the next stop cannot be confirmed rather than inferring from memory.",
  }),
  "hpo.account.get_context": definition({
    name: "Get HPO account context",
    action: "hpo.account.get_context",
    description: "Read current account relationship history, contacts and latest interaction context.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "hpo.route.read",
    optional: ["current_stop", "selected_account"],
    fallback: "clarify",
    timeoutMs: 6000,
    retryPolicy: NETWORK_READ_RETRY,
    degradedBehavior: "Ask which account Adam means if authoritative current-account context is unavailable.",
  }),
  "hpo.account.get_current": definition({
    name: "Get current HPO account",
    action: "hpo.account.get_current",
    description: "Identify the account or prospect bound to the authoritative current route stop.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "hpo.route.read",
    optional: ["current_stop", "selected_account", "selected_prospect"],
    fallback: "clarify",
    timeoutMs: 5000,
    retryPolicy: NETWORK_READ_RETRY,
    degradedBehavior: "Ask for the office name rather than guessing the current account.",
  }),
  "hpo.route_stop.arrive": definition({
    name: "Arrive at HPO route stop",
    action: "hpo.route_stop.arrive",
    description: "Mark the authoritative current route stop arrived through the canonical route-stop controller.",
    mode: "write",
    risk: "low",
    idempotent: true,
    confirmation: "when_ambiguous",
    healthKey: "hpo.route.write",
    requires: ["current_stop"],
    optional: ["current_route", "location"],
    fallback: "clarify",
    timeoutMs: 8000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout"] },
    degradedBehavior: "Do not mark arrival unless the canonical controller confirms the exact stop.",
  }),
  "hpo.route_stop.log_visit": definition({
    name: "Log HPO route visit",
    action: "hpo.route_stop.log_visit",
    description: "Capture a field visit against the authoritative route stop using canonical CRM write paths.",
    mode: "write",
    risk: "low",
    idempotent: true,
    confirmation: "when_ambiguous",
    healthKey: "hpo.crm.write",
    optional: ["current_route", "current_stop", "expected_note_target"],
    fallback: "clarify",
    timeoutMs: 10000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout"] },
    degradedBehavior: "Preserve the unsaved report and ask for the target if it cannot be bound safely.",
  }),
  "hpo.route_stop.add_note": definition({
    name: "Add HPO route note",
    action: "hpo.route_stop.add_note",
    description: "Add a non-PHI field note to the authoritative route stop and account history.",
    mode: "write",
    risk: "low",
    idempotent: true,
    confirmation: "when_ambiguous",
    healthKey: "hpo.crm.write",
    optional: ["current_stop", "expected_note_target"],
    fallback: "clarify",
    timeoutMs: 8000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout"] },
    degradedBehavior: "Keep the note unsaved and identify the missing target instead of attaching it elsewhere.",
  }),
  "hpo.route.set_stops": definition({
    name: "Set remaining route stops",
    action: "hpo.route.set_stops",
    description:
      "Atomically replace only unfinished route stops while preserving completed history.",
    mode: "write",
    risk: "high",
    idempotent: true,
    confirmation: "when_destructive",
    healthKey: "hpo.route.write",
    optional: ["current_route", "resolved_entity"],
    fallback: "preserve_state",
    timeoutMs: 12000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout", "routing_failure"] },
    degradedBehavior: "Keep the existing route order and never remove completed history on failure.",
  }),
  "hpo.field_session.arm_note_target": definition({
    name: "Arm expected field note target",
    action: "hpo.field_session.arm_note_target",
    description:
      "Persist the route stop or relationship expected to receive the next field report.",
    mode: "write",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "hpo.field_session",
    optional: ["current_route", "current_stop", "resolved_entity"],
    fallback: "clarify",
    timeoutMs: 8000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout"] },
    degradedBehavior: "Do not arm a target until one authoritative route/account target can be identified.",
  }),
  "hpo.interaction.create": definition({
    name: "Create HPO interaction",
    action: "hpo.interaction.create",
    description: "Save a supported non-PHI relationship interaction against a resolved HPO record.",
    mode: "write",
    risk: "low",
    idempotent: true,
    confirmation: "when_ambiguous",
    healthKey: "hpo.crm.write",
    optional: ["selected_account", "current_stop", "resolved_entity"],
    fallback: "clarify",
    timeoutMs: 9000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout"] },
    degradedBehavior: "Do not attach an interaction to an inferred account when the target is ambiguous.",
  }),
  "hpo.follow_up.create": definition({
    name: "Create HPO follow-up",
    action: "hpo.follow_up.create",
    description: "Create a dated relationship follow-up against a resolved HPO record.",
    mode: "write",
    risk: "medium",
    idempotent: true,
    confirmation: "when_ambiguous",
    healthKey: "hpo.crm.write",
    optional: ["selected_account", "current_stop", "resolved_entity"],
    fallback: "clarify",
    timeoutMs: 9000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout"] },
    degradedBehavior: "Do not create a follow-up until the account and date are authoritative.",
  }),
  "execution.undo": definition({
    name: "Undo latest reversible action",
    action: "execution.undo",
    description:
      "Restore the bounded before-state stored by the latest eligible execution receipt.",
    mode: "write",
    risk: "medium",
    idempotent: true,
    confirmation: "when_ambiguous",
    healthKey: "hpo.route.write",
    optional: ["recent_receipt"],
    fallback: "safe_noop",
    timeoutMs: 8000,
    retryPolicy: { maxAttempts: 1, retryOn: ["network_failure", "timeout"] },
    degradedBehavior: "Leave current state unchanged if no eligible reversible receipt can be verified.",
  }),
} satisfies Record<string, CapabilityDefinition>;

export type RegisteredCapabilityAction = keyof typeof CAPABILITY_REGISTRY;

export function getCapability(action: string): CapabilityDefinition | null {
  return action in CAPABILITY_REGISTRY
    ? CAPABILITY_REGISTRY[action as RegisteredCapabilityAction]
    : null;
}
