export type EmeryEvaluationCategory =
  | "intent_accuracy"
  | "entity_resolution"
  | "context_accuracy"
  | "capability_selection"
  | "voice_correction"
  | "action_execution"
  | "duplicate_write"
  | "memory_retrieval"
  | "latency"
  | "regression";

export type EmeryEvaluationSeverity = "info" | "low" | "medium" | "high" | "critical";

export type EmeryEvaluationSignal = {
  id?: string | null;
  category: EmeryEvaluationCategory;
  passed: boolean;
  score: number;
  severity: EmeryEvaluationSeverity;
  observedAt: string;
  source: "runtime" | "canonical_eval" | "user_correction" | "regression";
  request?: string | null;
  expected?: string | null;
  observed?: string | null;
  metadata?: Record<string, unknown>;
};

export type EmeryCategorySummary = {
  category: EmeryEvaluationCategory;
  samples: number;
  passed: number;
  failed: number;
  score: number;
  failureRate: number;
  criticalFailures: number;
};

export type EmeryEvaluationSummary = {
  samples: number;
  passed: number;
  failed: number;
  score: number;
  criticalFailures: number;
  categories: EmeryCategorySummary[];
};

export type EmeryWeakness = {
  category: EmeryEvaluationCategory;
  severity: EmeryEvaluationSeverity;
  samples: number;
  failures: number;
  score: number;
  failureRate: number;
  reason: string;
};

const CATEGORY_ORDER: EmeryEvaluationCategory[] = [
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

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function createEvaluationSignal(
  input: Omit<EmeryEvaluationSignal, "score" | "observedAt"> & {
    score?: number;
    observedAt?: string;
  },
): EmeryEvaluationSignal {
  return {
    ...input,
    score: clampScore(input.score ?? (input.passed ? 1 : 0)),
    observedAt: input.observedAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
  };
}

function summarizeCategory(
  category: EmeryEvaluationCategory,
  signals: EmeryEvaluationSignal[],
): EmeryCategorySummary | null {
  const rows = signals.filter((signal) => signal.category === category);
  if (!rows.length) return null;
  const passed = rows.filter((signal) => signal.passed).length;
  const failed = rows.length - passed;
  const score = rows.reduce((sum, signal) => sum + clampScore(signal.score), 0) / rows.length;
  return {
    category,
    samples: rows.length,
    passed,
    failed,
    score,
    failureRate: failed / rows.length,
    criticalFailures: rows.filter((signal) => !signal.passed && signal.severity === "critical").length,
  };
}

export function summarizeEvaluationSignals(
  signals: EmeryEvaluationSignal[],
): EmeryEvaluationSummary {
  const categories = CATEGORY_ORDER.flatMap((category) => {
    const summary = summarizeCategory(category, signals);
    return summary ? [summary] : [];
  });
  const passed = signals.filter((signal) => signal.passed).length;
  const failed = signals.length - passed;
  const score = signals.length
    ? signals.reduce((sum, signal) => sum + clampScore(signal.score), 0) / signals.length
    : 1;
  return {
    samples: signals.length,
    passed,
    failed,
    score,
    criticalFailures: signals.filter(
      (signal) => !signal.passed && signal.severity === "critical",
    ).length,
    categories,
  };
}

function weaknessSeverity(summary: EmeryCategorySummary): EmeryEvaluationSeverity {
  if (summary.criticalFailures > 0) return "critical";
  if (summary.category === "duplicate_write" && summary.failed > 0) return "critical";
  if (summary.category === "regression" && summary.failed > 0) return "high";
  if (summary.failureRate >= 0.5) return "high";
  if (summary.failureRate >= 0.25) return "medium";
  return "low";
}

export function rankEvaluationWeaknesses(
  summary: EmeryEvaluationSummary,
  options: { minSamples?: number; minimumFailureRate?: number } = {},
): EmeryWeakness[] {
  const minSamples = Math.max(1, options.minSamples ?? 3);
  const minimumFailureRate = Math.max(0, Math.min(1, options.minimumFailureRate ?? 0.2));

  return summary.categories
    .filter((category) => {
      if (category.category === "duplicate_write" || category.category === "regression") {
        return category.failed > 0;
      }
      return category.samples >= minSamples && category.failureRate >= minimumFailureRate;
    })
    .map((category) => ({
      category: category.category,
      severity: weaknessSeverity(category),
      samples: category.samples,
      failures: category.failed,
      score: category.score,
      failureRate: category.failureRate,
      reason:
        category.category === "duplicate_write"
          ? `${category.failed} duplicate-write failure(s) detected. Duplicate writes are a zero-tolerance regression.`
          : category.category === "regression"
            ? `${category.failed} canonical regression failure(s) detected.`
            : `${Math.round(category.failureRate * 100)}% failure rate across ${category.samples} observations.`,
    }))
    .sort((left, right) => {
      const severityRank: Record<EmeryEvaluationSeverity, number> = {
        info: 0,
        low: 1,
        medium: 2,
        high: 3,
        critical: 4,
      };
      return (
        severityRank[right.severity] - severityRank[left.severity] ||
        right.failureRate - left.failureRate ||
        right.failures - left.failures
      );
    });
}

export type EmeryEvaluationGate = {
  eligibleForProposal: boolean;
  targetCategory: EmeryEvaluationCategory;
  baselineScore: number;
  candidateScore: number;
  improvement: number;
  regressions: Array<{
    category: EmeryEvaluationCategory;
    baselineScore: number;
    candidateScore: number;
    delta: number;
  }>;
  reason: string;
};

function categoryScore(summary: EmeryEvaluationSummary, category: EmeryEvaluationCategory) {
  return summary.categories.find((item) => item.category === category)?.score ?? 1;
}

export function compareEvaluationSummaries(input: {
  baseline: EmeryEvaluationSummary;
  candidate: EmeryEvaluationSummary;
  targetCategory: EmeryEvaluationCategory;
  minimumImprovement?: number;
  maximumNonTargetRegression?: number;
}): EmeryEvaluationGate {
  const minimumImprovement = Math.max(0, input.minimumImprovement ?? 0.05);
  const maximumNonTargetRegression = Math.max(0, input.maximumNonTargetRegression ?? 0.03);
  const baselineScore = categoryScore(input.baseline, input.targetCategory);
  const candidateScore = categoryScore(input.candidate, input.targetCategory);
  const improvement = candidateScore - baselineScore;

  const regressions = CATEGORY_ORDER.filter((category) => category !== input.targetCategory)
    .map((category) => {
      const baselineCategoryScore = categoryScore(input.baseline, category);
      const candidateCategoryScore = categoryScore(input.candidate, category);
      return {
        category,
        baselineScore: baselineCategoryScore,
        candidateScore: candidateCategoryScore,
        delta: candidateCategoryScore - baselineCategoryScore,
      };
    })
    .filter((item) => item.delta < -maximumNonTargetRegression);

  const duplicateWorse =
    categoryScore(input.candidate, "duplicate_write") <
    categoryScore(input.baseline, "duplicate_write");
  const criticalRegression = input.candidate.criticalFailures > input.baseline.criticalFailures;
  const targetAlreadyExcellent = baselineScore >= 0.95 && candidateScore >= baselineScore;
  const targetImproved = improvement >= minimumImprovement || targetAlreadyExcellent;
  const eligibleForProposal =
    targetImproved && !regressions.length && !duplicateWorse && !criticalRegression;

  return {
    eligibleForProposal,
    targetCategory: input.targetCategory,
    baselineScore,
    candidateScore,
    improvement,
    regressions,
    reason: eligibleForProposal
      ? "Candidate clears the evaluation gate and may be proposed for human review."
      : !targetImproved
        ? "Candidate did not improve the target category enough."
        : duplicateWorse
          ? "Candidate worsened duplicate-write safety."
          : criticalRegression
            ? "Candidate introduced a new critical failure."
            : `Candidate regressed ${regressions.length} non-target evaluation category/categories beyond tolerance.`,
  };
}
