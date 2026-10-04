/* eslint-disable @typescript-eslint/no-explicit-any */
import { recordEvaluationSignal, type RuntimeEvent } from "@/lib/runtime-telemetry";
import type { CapabilityRoute } from "./capability-router.ts";
import { buildRuntimeTurnEvaluationSignals } from "./evaluation-observer.ts";
import type { ExecutionReceipt, RequestContext } from "./orchestration.types.ts";

export function isExplicitMemoryRecallRequest(message: string) {
  const text = String(message ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(remember|do you remember|what did i tell you|what did i say|what i told you|last time we talked|my preference|my preferences|about me)\b/.test(
    text,
  );
}

export async function recordTurnEvaluation(input: {
  db: any;
  userId: string;
  channel: RuntimeEvent["channel"];
  domain?: string | null;
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
}) {
  const signals = buildRuntimeTurnEvaluationSignals({
    message: input.message,
    capabilityRoute: input.capabilityRoute,
    context: input.context,
    selectedMemoryCount: input.selectedMemoryCount,
    receipts: input.receipts,
    durationMs: input.durationMs,
    correctionDetected: input.correctionDetected,
    correctionApplied: input.correctionApplied,
    entityResolution: input.entityResolution,
    duplicateWriteDetected: input.duplicateWriteDetected,
    retrievalExpected: isExplicitMemoryRecallRequest(input.message),
  });

  for (const signal of signals) {
    await recordEvaluationSignal(input.db, input.userId, {
      channel: input.channel,
      domain: input.domain ?? null,
      signal,
    });
  }

  return signals;
}
