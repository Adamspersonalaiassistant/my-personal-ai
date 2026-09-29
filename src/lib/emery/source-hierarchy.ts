export type SourceAuthority =
  | "explicit_correction"
  | "live_structured"
  | "relationship_history"
  | "verified_research"
  | "durable_memory"
  | "inference";

const SOURCE_RANK: Record<SourceAuthority, number> = {
  explicit_correction: 600,
  live_structured: 500,
  relationship_history: 400,
  verified_research: 300,
  durable_memory: 200,
  inference: 100,
};

export type SourcedValue<T> = {
  value: T;
  source: SourceAuthority;
  observedAt?: string | null;
};

export type SourceDecision<T> =
  | { status: "accepted"; value: SourcedValue<T>; reason: string }
  | { status: "preserved"; value: SourcedValue<T>; reason: string }
  | {
      status: "requires_review";
      value: SourcedValue<T>;
      incoming: SourcedValue<T>;
      reason: string;
    };

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function chooseAuthoritativeValue<T>(
  current: SourcedValue<T> | null,
  incoming: SourcedValue<T>,
): SourceDecision<T> {
  if (!current) return { status: "accepted", value: incoming, reason: "No current value exists." };
  if (Object.is(current.value, incoming.value))
    return {
      status: "preserved",
      value: timestamp(incoming.observedAt) > timestamp(current.observedAt) ? incoming : current,
      reason: "The sources agree.",
    };

  const currentRank = SOURCE_RANK[current.source];
  const incomingRank = SOURCE_RANK[incoming.source];
  if (incomingRank > currentRank)
    return {
      status: "accepted",
      value: incoming,
      reason: `${incoming.source} outranks ${current.source}.`,
    };
  if (incomingRank < currentRank)
    return {
      status: "requires_review",
      value: current,
      incoming,
      reason: `${current.source} is authoritative over ${incoming.source}.`,
    };
  if (timestamp(incoming.observedAt) > timestamp(current.observedAt))
    return {
      status: "accepted",
      value: incoming,
      reason: "The equally authoritative incoming value is newer.",
    };
  return {
    status: "requires_review",
    value: current,
    incoming,
    reason: "Conflicting equally authoritative evidence is not newer.",
  };
}
