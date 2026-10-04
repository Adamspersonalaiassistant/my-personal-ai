import type { CapabilityRoute } from "./capability-router.ts";
import {
  EMERY_CANONICAL_EVAL_CORPUS,
  type EmeryCanonicalEvalCase,
} from "./evaluation-corpus.ts";
import { runCanonicalEvalCase } from "./evaluation-runner.ts";
import {
  createEvaluationSignal,
  type EmeryEvaluationSignal,
} from "./evaluation.ts";
import type { ExecutionReceipt, RequestContext } from "./orchestration.types.ts";

function normalized(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findCanonicalEvalCase(message: string): EmeryCanonicalEvalCase | null {
  const target = normalized(message);
  if (!target) return null;
  return (
    EMERY_CANONICAL_EVAL_CORPUS.find((test) => normalized(test.prompt) === target) ?? null
  );
}

export function buildRuntimeTurnEvaluationSignals(input: {
  message: string;
  capabilityRoute?: CapabilityRoute | null;
  context?: RequestContext | null;
  selectedMemoryCount?: number | null;
  receipts?: ExecutionReceipt[];
  durationMs?: number | null;
  correctionDetected?: boolean;
  correctionApplied?: boolean;
  entityResolution?: "resolved" | "ambiguous" | "not_found" | null;
  duplicateWriteDetected?: boolean;
  retrievalExpected?: boolean;
}) {
  const signals: EmeryEvaluationSignal[] = [];
  const canonical = findCanonicalEvalCase(input.message);
  if (canonical) signals.push(...runCanonicalEvalCase(canonical));

  if (typeof input.durationMs === "number") {
    const passed = input.durationMs <= 8_000;
    signals.push(
      createEvaluationSignal({
        category: "latency",
        passed,
        score: passed ? 1 : Math.max(0, 1 - (input.durationMs - 8_000) / 20_000),
        severity: passed ? "info" : input.durationMs > 20_000 ? "high" : "medium",
        source: "runtime",
        request: input.message,
        expected: "<=8000ms",
        observed: `${Math.round(input.durationMs)}ms`,
      }),
    );
  }

  if (input.entityResolution) {
    const passed = input.entityResolution === "resolved";
    signals.push(
      createEvaluationSignal({
        category: "entity_resolution",
        passed,
        score: passed ? 1 : input.entityResolution === "ambiguous" ? 0.5 : 0,
        severity: passed ? "info" : "medium",
        source: "runtime",
        request: input.message,
        expected: "resolved entity or truthful clarification",
        observed: input.entityResolution,
      }),
    );
  }

  if (input.correctionDetected) {
    signals.push(
      createEvaluationSignal({
        category: "voice_correction",
        passed: input.correctionApplied === true,
        severity: input.correctionApplied === true ? "info" : "high",
        source: "user_correction",
        request: input.message,
        expected: "correction supersedes the prior intended action without duplication",
        observed: input.correctionApplied === true ? "correction applied" : "correction not confirmed",
      }),
    );
  }

  if (input.retrievalExpected) {
    const selected = Math.max(0, Number(input.selectedMemoryCount ?? 0));
    signals.push(
      createEvaluationSignal({
        category: "memory_retrieval",
        passed: selected > 0,
        severity: selected > 0 ? "info" : "medium",
        source: "runtime",
        request: input.message,
        expected: "at least one relevant durable memory",
        observed: `${selected} selected memory item(s)`,
      }),
    );
  }

  if (input.receipts?.length) {
    for (const receipt of input.receipts) {
      const passed =
        receipt.status === "success" ||
        receipt.status === "partial_success" ||
        receipt.status === "recovered_failure" ||
        receipt.status === "clarification_required" ||
        receipt.status === "safe_noop";
      signals.push(
        createEvaluationSignal({
          category: "action_execution",
          passed,
          severity: passed ? "info" : "high",
          source: "runtime",
          request: input.message,
          expected: "canonical receipt succeeds, safely clarifies, or safely no-ops",
          observed: `${receipt.action}:${receipt.status}:performed=${receipt.performed}`,
          metadata: {
            receiptId: receipt.id,
            action: receipt.action,
            capability: receipt.capability,
            failureCode: receipt.error?.failureCode ?? null,
          },
        }),
      );
    }
  }

  if (input.duplicateWriteDetected === true) {
    signals.push(
      createEvaluationSignal({
        category: "duplicate_write",
        passed: false,
        severity: "critical",
        source: "runtime",
        request: input.message,
        expected: "zero duplicate writes",
        observed: "duplicate write detected",
      }),
    );
  }

  return signals;
}
