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

export type CapabilityDefinition<TInput extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  action: string;
  description: string;
  mode: CapabilityMode;
  risk: ActionRisk;
  idempotent: boolean;
  confirmation: "never" | "when_ambiguous" | "when_destructive";
  healthKey: CapabilityHealthKey;
  validate: (value: unknown) => TInput;
};

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Capability input must be an object");
  return value as Record<string, unknown>;
}

function definition(input: Omit<CapabilityDefinition, "risk" | "validate"> & { risk?: ActionRisk }): CapabilityDefinition {
  return {
    ...input,
    risk: input.risk ?? "medium",
    validate: objectInput,
  };
}

export const CAPABILITY_REGISTRY = {
  "calendar.read": definition({
    name: "Calendar read",
    action: "calendar.read",
    description: "Read scheduled commitments without mutating Calendar.",
    mode: "read",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "calendar.read",
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
  }),
  "hpo.route.set_stops": definition({
    name: "Set remaining route stops",
    action: "hpo.route.set_stops",
    description: "Atomically replace only unfinished route stops while preserving completed history.",
    mode: "write",
    risk: "high",
    idempotent: true,
    confirmation: "when_destructive",
    healthKey: "hpo.route.write",
  }),
  "hpo.field_session.arm_note_target": definition({
    name: "Arm expected field note target",
    action: "hpo.field_session.arm_note_target",
    description: "Persist the route stop or relationship expected to receive the next field report.",
    mode: "write",
    risk: "low",
    idempotent: true,
    confirmation: "never",
    healthKey: "hpo.field_session",
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
  }),
} satisfies Record<string, CapabilityDefinition>;

export type RegisteredCapabilityAction = keyof typeof CAPABILITY_REGISTRY;

export function getCapability(action: string): CapabilityDefinition | null {
  return action in CAPABILITY_REGISTRY
    ? CAPABILITY_REGISTRY[action as RegisteredCapabilityAction]
    : null;
}
