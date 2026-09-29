/* eslint-disable @typescript-eslint/no-explicit-any */
import { beginExecution, completeExecution, failExecution } from "@/lib/execution-ledger";

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

export async function undoLatestEligibleExecutionCore(input: {
  db: any;
  userId: string;
  sourceMessageId: string;
  sourceChannel: string;
}) {
  const { data: latest, error: latestError } = await input.db
    .from("emery_execution_runs")
    .select("id,action,target_id,result_payload,completed_at")
    .eq("user_id", input.userId)
    .eq("status", "completed")
    .eq("action", "hpo.route.set_stops")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest?.target_id)
    return {
      performed: false,
      needsClarification: true,
      reply: "I couldn't find a recent reversible route change to undo.",
      executionRunId: null,
      routeId: null,
    };

  const snapshot = object(object(latest.result_payload)["setStops"]);
  const previousOpenStops = Array.isArray(snapshot["previous_open_stops"])
    ? snapshot["previous_open_stops"]
    : null;
  const currentOpenStopIds = Array.isArray(snapshot["current_open_stop_ids"])
    ? snapshot["current_open_stop_ids"].map(String)
    : null;
  if (!previousOpenStops || !currentOpenStopIds)
    return {
      performed: false,
      needsClarification: true,
      reply: "That route change predates safe undo, so I left the current route unchanged.",
      executionRunId: null,
      routeId: latest.target_id,
    };

  const run = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "emery",
    action: "execution.undo",
    sourceMessageId: input.sourceMessageId,
    idempotencyKey: `message:${input.sourceMessageId}:execution.undo:${latest.id}`,
    parentRunId: latest.id,
    targetType: "hpo_route",
    targetId: latest.target_id,
    requestPayload: {
      sourceRunId: latest.id,
      sourceChannel: input.sourceChannel,
    },
  });
  if (run.reused && run.status === "completed" && run.resultPayload["undo"])
    return run.resultPayload["undo"];

  try {
    const { data, error } = await input.db.rpc("emery_hpo_restore_remaining_route_stops", {
      p_route_id: latest.target_id,
      p_previous_open_stops: previousOpenStops,
      p_expected_current_stop_ids: currentOpenStopIds,
      p_previous_field_session: snapshot["previous_field_session"] ?? null,
    });
    if (error) throw error;
    const result = {
      performed: true,
      needsClarification: false,
      reply: "Undone. I restored the previous remaining route without changing completed visits.",
      executionRunId: run.id,
      routeId: latest.target_id,
      restored: data,
    };
    await completeExecution({
      db: input.db,
      userId: input.userId,
      runId: run.id,
      resultPayload: { undo: result },
      targetType: "hpo_route",
      targetId: latest.target_id,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: run.id,
      errorCode: message.includes("undo_conflict_route_changed")
        ? "undo_conflict_route_changed"
        : "execution_undo_failed",
      errorMessage: message,
      retryable: false,
      resultPayload: { sourceRunId: latest.id, routeId: latest.target_id },
    }).catch(() => undefined);
    return {
      performed: false,
      needsClarification: false,
      reply: message.includes("undo_conflict_route_changed")
        ? "I didn't undo that because the route changed afterward. I left the current route intact."
        : "I couldn't safely restore the previous route, so I left the current route unchanged.",
      executionRunId: run.id,
      routeId: latest.target_id,
    };
  }
}
