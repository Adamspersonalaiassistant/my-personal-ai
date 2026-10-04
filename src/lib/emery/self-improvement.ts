import {
  createEvaluationSignal,
  rankEvaluationWeaknesses,
  summarizeEvaluationSignals,
  type EmeryEvaluationCategory,
  type EmeryEvaluationSignal,
  type EmeryEvaluationSummary,
  type EmeryWeakness,
} from "./evaluation.ts";

export const EMERY_SELF_IMPROVEMENT_POLICY = `EMERY SELF-IMPROVEMENT POLICY:
- Emery may measure outcomes, find recurring weaknesses, run canonical evaluations, and propose a tested improvement.
- Emery must not modify production, deploy, merge, run destructive database operations, rotate credentials, or change protected HPO behavior on her own.
- A software improvement must be isolated to a branch or patch, evaluated against the canonical corpus and relevant regression validators, and presented for Adam's approval before production deployment.
- A target improvement never justifies regressions in duplicate-write safety, execution receipts, canonical CRM truth, current-context authority, privacy boundaries, Voice safety, or protected HPO workflows.
- Inferred performance signals are evidence, not truth. User corrections and deterministic regression tests outrank heuristic runtime signals.
- Ambient speech is not self-improvement training data unless Adam explicitly turns it into feedback in an addressed request.`;

export type RuntimeEvaluationEvent = {
  id?: string | null;
  channel?: string | null;
  event_type?: string | null;
  domain?: string | null;
  action?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type EmeryImprovementProposal = {
  status: "proposal_only";
  targetCategory: EmeryEvaluationCategory;
  title: string;
  problem: string;
  evidence: {
    samples: number;
    failures: number;
    score: number;
    failureRate: number;
    severity: EmeryWeakness["severity"];
  };
  acceptanceCriteria: string[];
  protectedConstraints: string[];
  nextStep: "create_isolated_branch_after_approval";
};

export type EmerySelfImprovementReport = {
  generatedAt: string;
  summary: EmeryEvaluationSummary;
  weaknesses: EmeryWeakness[];
  proposal: EmeryImprovementProposal | null;
  policy: string;
  observationsUsed: number;
};

function metadata(event: RuntimeEvaluationEvent) {
  return event.metadata && typeof event.metadata === "object" ? event.metadata : {};
}

function explicitEvaluationSignal(event: RuntimeEvaluationEvent): EmeryEvaluationSignal | null {
  if (event.event_type !== "evaluation_signal") return null;
  const raw = (metadata(event) as any).evaluation ?? metadata(event);
  const category = String(raw.category ?? "") as EmeryEvaluationCategory;
  const allowed: EmeryEvaluationCategory[] = [
    "intent_accuracy",
    "entity_resolution",
    "context_accuracy",
    "capability_selection",
    "voice_correction",
    "action_execution",
    "duplicate_write",
    "memory_retrieval",
    "latency",
    "regression",
  ];
  if (!allowed.includes(category)) return null;
  const passed = Boolean(raw.passed);
  return createEvaluationSignal({
    id: event.id ?? null,
    category,
    passed,
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : passed ? 1 : 0,
    severity: ["info", "low", "medium", "high", "critical"].includes(String(raw.severity))
      ? raw.severity
      : passed
        ? "info"
        : "medium",
    observedAt: event.created_at ?? new Date().toISOString(),
    source: raw.source === "user_correction" ? "user_correction" : "runtime",
    request: typeof raw.request === "string" ? raw.request : null,
    expected: typeof raw.expected === "string" ? raw.expected : null,
    observed: typeof raw.observed === "string" ? raw.observed : null,
    metadata: { ...metadata(event), runtimeEventType: event.event_type },
  });
}

export function deriveRuntimeEvaluationSignals(
  events: RuntimeEvaluationEvent[],
): EmeryEvaluationSignal[] {
  const signals: EmeryEvaluationSignal[] = [];

  for (const event of events) {
    const explicit = explicitEvaluationSignal(event);
    if (explicit) {
      signals.push(explicit);
      continue;
    }

    const meta = metadata(event) as any;
    if (typeof event.duration_ms === "number" && event.duration_ms >= 0) {
      const passed = event.duration_ms <= 8_000;
      signals.push(
        createEvaluationSignal({
          id: event.id ? `${event.id}:latency` : null,
          category: "latency",
          passed,
          score: passed ? 1 : Math.max(0, 1 - (event.duration_ms - 8_000) / 20_000),
          severity: passed ? "info" : event.duration_ms > 20_000 ? "high" : "medium",
          observedAt: event.created_at ?? new Date().toISOString(),
          source: "runtime",
          expected: "<=8000ms",
          observed: `${Math.round(event.duration_ms)}ms`,
          metadata: { eventType: event.event_type, channel: event.channel, model: event.model },
        }),
      );
    }

    if (meta.duplicateWrite === true || meta.duplicate_write === true) {
      signals.push(
        createEvaluationSignal({
          id: event.id ? `${event.id}:duplicate_write` : null,
          category: "duplicate_write",
          passed: false,
          severity: "critical",
          observedAt: event.created_at ?? new Date().toISOString(),
          source: "runtime",
          expected: "no duplicate write",
          observed: "duplicate write detected",
          metadata: { eventType: event.event_type, action: event.action },
        }),
      );
    } else if (meta.duplicateSuppressed === true || meta.idempotentReplay === true) {
      signals.push(
        createEvaluationSignal({
          id: event.id ? `${event.id}:duplicate_write` : null,
          category: "duplicate_write",
          passed: true,
          severity: "info",
          observedAt: event.created_at ?? new Date().toISOString(),
          source: "runtime",
          expected: "duplicate safely suppressed",
          observed: "duplicate safely suppressed",
          metadata: { eventType: event.event_type, action: event.action },
        }),
      );
    }

    if (event.status === "error" && event.action && event.action !== "respond") {
      signals.push(
        createEvaluationSignal({
          id: event.id ? `${event.id}:action_execution` : null,
          category: "action_execution",
          passed: false,
          severity: "high",
          observedAt: event.created_at ?? new Date().toISOString(),
          source: "runtime",
          expected: "canonical action succeeds or safely clarifies",
          observed: `runtime error in ${event.action}`,
          metadata: { eventType: event.event_type, domain: event.domain, channel: event.channel },
        }),
      );
    }

    if (meta.userCorrection === true || meta.voiceCorrection === true) {
      signals.push(
        createEvaluationSignal({
          id: event.id ? `${event.id}:voice_correction` : null,
          category: "voice_correction",
          passed: meta.correctionApplied === true,
          severity: meta.correctionApplied === true ? "info" : "high",
          observedAt: event.created_at ?? new Date().toISOString(),
          source: "user_correction",
          expected: "prior intent corrected without duplicate action",
          observed: meta.correctionApplied === true ? "correction applied" : "correction missed",
          metadata: { eventType: event.event_type, channel: event.channel },
        }),
      );
    }

    if (meta.memoryExpected === true) {
      const count = Number(meta.selectedMemoryCount ?? 0);
      signals.push(
        createEvaluationSignal({
          id: event.id ? `${event.id}:memory_retrieval` : null,
          category: "memory_retrieval",
          passed: count > 0,
          severity: count > 0 ? "info" : "medium",
          observedAt: event.created_at ?? new Date().toISOString(),
          source: "runtime",
          expected: "at least one relevant durable memory",
          observed: `${count} selected memory item(s)`,
          metadata: { eventType: event.event_type, channel: event.channel },
        }),
      );
    }
  }

  return signals;
}

function proposalForWeakness(weakness: EmeryWeakness): EmeryImprovementProposal {
  const label = weakness.category.replace(/_/g, " ");
  return {
    status: "proposal_only",
    targetCategory: weakness.category,
    title: `Improve Emery ${label}`,
    problem: weakness.reason,
    evidence: {
      samples: weakness.samples,
      failures: weakness.failures,
      score: weakness.score,
      failureRate: weakness.failureRate,
      severity: weakness.severity,
    },
    acceptanceCriteria: [
      `Improve ${label} on the canonical evaluation corpus or a focused reproducible regression set.`,
      "Introduce zero new critical failures.",
      "Introduce zero duplicate-write regressions.",
      "Do not weaken canonical execution-receipt or current-context authority rules.",
      "Run the relevant existing regression validators before a PR is proposed.",
    ],
    protectedConstraints: [
      "No autonomous production modification or deployment.",
      "No direct model writes around canonical controllers.",
      "No replacement of Planner, Supabase, CRM, Leaflet, Field Session, or execution ledger.",
      "No ambient speech promoted into durable memory or CRM truth without explicit user action.",
    ],
    nextStep: "create_isolated_branch_after_approval",
  };
}

export function buildSelfImprovementReport(input: {
  runtimeEvents?: RuntimeEvaluationEvent[];
  canonicalSignals?: EmeryEvaluationSignal[];
  minSamples?: number;
}): EmerySelfImprovementReport {
  const runtimeSignals = deriveRuntimeEvaluationSignals(input.runtimeEvents ?? []);
  const signals = [...(input.canonicalSignals ?? []), ...runtimeSignals];
  const summary = summarizeEvaluationSignals(signals);
  const weaknesses = rankEvaluationWeaknesses(summary, {
    minSamples: input.minSamples ?? 3,
    minimumFailureRate: 0.2,
  });
  return {
    generatedAt: new Date().toISOString(),
    summary,
    weaknesses,
    proposal: weaknesses[0] ? proposalForWeakness(weaknesses[0]) : null,
    policy: EMERY_SELF_IMPROVEMENT_POLICY,
    observationsUsed: signals.length,
  };
}
