/* eslint-disable @typescript-eslint/no-explicit-any */

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
