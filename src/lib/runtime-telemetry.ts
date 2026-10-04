/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EmeryEvaluationSignal } from "@/lib/emery/evaluation";

export type RuntimeEvent = {
  channel: "chat" | "capture" | "shortcut" | "voice" | "system" | "hpo";
  eventType: string;
  domain?: string | null;
  action?: string | null;
  status?: "ok" | "error" | "clarification" | "skipped";
  durationMs?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordRuntimeEvent(
  db: any,
  userId: string,
  event: RuntimeEvent,
) {
  try {
    const { error } = await db.from("emery_runtime_events").insert({
      user_id: userId,
      channel: event.channel,
      event_type: event.eventType.slice(0, 120),
      domain: event.domain ?? null,
      action: event.action ?? null,
      status: event.status ?? "ok",
      duration_ms:
        event.durationMs == null
          ? null
          : Math.max(0, Math.min(600000, Math.round(event.durationMs))),
      model: event.model ?? null,
      metadata: event.metadata ?? {},
    });
    if (error) console.error("Emery runtime telemetry write failed", error.message);
  } catch (error) {
    console.error("Emery runtime telemetry failed", error);
  }
}

export async function recordEvaluationSignal(
  db: any,
  userId: string,
  input: {
    channel: RuntimeEvent["channel"];
    domain?: string | null;
    model?: string | null;
    signal: EmeryEvaluationSignal;
    metadata?: Record<string, unknown>;
  },
) {
  const signal = input.signal;
  const safeRequest = signal.source === "canonical_eval" ? signal.request ?? null : null;
  return recordRuntimeEvent(db, userId, {
    channel: input.channel,
    eventType: "evaluation_signal",
    domain: input.domain ?? null,
    action: signal.category,
    status: signal.passed ? "ok" : "error",
    model: input.model ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      evaluation: {
        category: signal.category,
        passed: signal.passed,
        score: signal.score,
        severity: signal.severity,
        source: signal.source,
        request: safeRequest,
        requestStored: safeRequest != null,
        expected: signal.expected ?? null,
        observed: signal.observed ?? null,
        observedAt: signal.observedAt,
        metadata: signal.metadata ?? {},
      },
    },
  });
}
