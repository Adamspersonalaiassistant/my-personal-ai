import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compareEvaluationSummaries,
  createEvaluationSignal,
  summarizeEvaluationSignals,
} from "../src/lib/emery/evaluation.ts";
import { EMERY_CANONICAL_EVAL_CORPUS } from "../src/lib/emery/evaluation-corpus.ts";
import { runCanonicalEmeryEvaluations } from "../src/lib/emery/evaluation-runner.ts";
import {
  EMERY_SELF_IMPROVEMENT_POLICY,
  buildSelfImprovementReport,
} from "../src/lib/emery/self-improvement.ts";

const canonical = runCanonicalEmeryEvaluations();
assert.equal(canonical.cases, EMERY_CANONICAL_EVAL_CORPUS.length);
assert(canonical.cases >= 15, "Phase 7 canonical corpus should cover the real Emery/Jarvis workflows");
assert.equal(
  canonical.summary.failed,
  0,
  `Canonical Emery evaluation corpus has ${canonical.summary.failed} failure(s)`,
);
assert.equal(canonical.summary.score, 1);
assert(canonical.summary.categories.some((item) => item.category === "capability_selection"));
assert(canonical.summary.categories.some((item) => item.category === "context_accuracy"));
assert(canonical.summary.categories.some((item) => item.category === "voice_correction"));
assert(canonical.summary.categories.some((item) => item.category === "memory_retrieval"));

const runtimeReport = buildSelfImprovementReport({
  canonicalSignals: canonical.signals,
  runtimeEvents: [
    {
      id: "slow-1",
      event_type: "emery_turn",
      channel: "chat",
      action: "respond",
      status: "ok",
      duration_ms: 12_000,
      created_at: "2026-10-04T18:00:00.000Z",
      metadata: {},
    },
    {
      id: "dup-1",
      event_type: "hpo_action",
      channel: "voice",
      action: "hpo.follow_up.create",
      status: "ok",
      duration_ms: 1200,
      created_at: "2026-10-04T18:01:00.000Z",
      metadata: { duplicateWrite: true },
    },
  ],
});
assert(runtimeReport.weaknesses.some((item) => item.category === "duplicate_write"));
assert.equal(runtimeReport.weaknesses[0]?.category, "duplicate_write");
assert.equal(runtimeReport.proposal?.status, "proposal_only");
assert.equal(runtimeReport.proposal?.nextStep, "create_isolated_branch_after_approval");
assert(runtimeReport.proposal?.protectedConstraints.some((rule) => rule.includes("No autonomous production")));

const baselineSignals = [
  createEvaluationSignal({
    category: "entity_resolution",
    passed: true,
    score: 0.72,
    severity: "info",
    source: "canonical_eval",
  }),
  createEvaluationSignal({
    category: "duplicate_write",
    passed: true,
    score: 1,
    severity: "info",
    source: "canonical_eval",
  }),
];
const candidateSignals = [
  createEvaluationSignal({
    category: "entity_resolution",
    passed: true,
    score: 0.94,
    severity: "info",
    source: "canonical_eval",
  }),
  createEvaluationSignal({
    category: "duplicate_write",
    passed: true,
    score: 1,
    severity: "info",
    source: "canonical_eval",
  }),
];
const gate = compareEvaluationSummaries({
  baseline: summarizeEvaluationSignals(baselineSignals),
  candidate: summarizeEvaluationSignals(candidateSignals),
  targetCategory: "entity_resolution",
});
assert.equal(gate.eligibleForProposal, true);
assert(gate.improvement > 0.2);
assert.equal(gate.regressions.length, 0);

const unsafeCandidate = compareEvaluationSummaries({
  baseline: summarizeEvaluationSignals(baselineSignals),
  candidate: summarizeEvaluationSignals([
    candidateSignals[0],
    createEvaluationSignal({
      category: "duplicate_write",
      passed: false,
      score: 0,
      severity: "critical",
      source: "regression",
    }),
  ]),
  targetCategory: "entity_resolution",
});
assert.equal(unsafeCandidate.eligibleForProposal, false);

assert(EMERY_SELF_IMPROVEMENT_POLICY.includes("must not modify production"));
assert(EMERY_SELF_IMPROVEMENT_POLICY.includes("Adam's approval"));
assert(EMERY_SELF_IMPROVEMENT_POLICY.includes("Ambient speech is not self-improvement training data"));

const telemetrySource = fs.readFileSync(
  new URL("../src/lib/runtime-telemetry.ts", import.meta.url),
  "utf8",
);
const reportSource = fs.readFileSync(
  new URL("../src/lib/emery/self-improvement.functions.ts", import.meta.url),
  "utf8",
);
const observerSource = fs.readFileSync(
  new URL("../src/lib/emery/evaluation-observer.ts", import.meta.url),
  "utf8",
);
assert(telemetrySource.includes("recordEvaluationSignal"));
assert(telemetrySource.includes('eventType: "evaluation_signal"'));
assert(reportSource.includes('from("emery_runtime_events")'));
assert(reportSource.includes("readOnly: true"));
assert(reportSource.includes("autonomousProductionChangesAllowed: false"));
assert(observerSource.includes("buildRuntimeTurnEvaluationSignals"));
assert(observerSource.includes("duplicateWriteDetected"));
assert(observerSource.includes("correctionApplied"));

console.log("Emery Phase 7 self-improvement validation passed.");
