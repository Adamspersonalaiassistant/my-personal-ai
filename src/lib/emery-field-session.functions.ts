/* eslint-disable @typescript-eslint/no-explicit-any */
import { beginExecution, completeExecution, failExecution } from "@/lib/execution-ledger";

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

export async function getActiveFieldSessionCore(input: {
  db: any;
  userId: string;
  sessionDate: string;
}) {
  const { data, error } = await input.db
    .from("emery_field_sessions")
    .select("*")
    .eq("user_id", input.userId)
    .eq("session_date", input.sessionDate)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function armExpectedFieldNoteTargetCore(input: {
  db: any;
  userId: string;
  sessionDate: string;
  routeId?: string | null;
  stopId?: string | null;
  accountId?: string | null;
  prospectId?: string | null;
  meetingId?: string | null;
  label?: string | null;
  idempotencyKey: string;
  sourceMessageId?: string | null;
  sourceChannel: string;
}) {
  const targetId = input.stopId ?? input.accountId ?? input.prospectId ?? input.meetingId ?? null;
  if (!targetId) throw new Error("A canonical field-note target is required");
  const run = await beginExecution({
    db: input.db,
    userId: input.userId,
    domain: "hpo_field_session",
    action: "hpo.field_session.arm_note_target",
    sourceMessageId: input.sourceMessageId ?? null,
    idempotencyKey: input.idempotencyKey,
    targetType: "emery_field_session",
    targetId,
    requestPayload: {
      sessionDate: input.sessionDate,
      routeId: input.routeId ?? null,
      stopId: input.stopId ?? null,
      accountId: input.accountId ?? null,
      prospectId: input.prospectId ?? null,
      meetingId: input.meetingId ?? null,
      sourceChannel: input.sourceChannel,
    },
  });
  if (run.reused && run.status === "completed" && run.resultPayload["fieldSession"])
    return run.resultPayload["fieldSession"];

  try {
    const { data, error } = await input.db
      .from("emery_field_sessions")
      .upsert(
        {
          user_id: input.userId,
          session_date: input.sessionDate,
          status: "active",
          route_id: input.routeId ?? null,
          expected_note_stop_id: input.stopId ?? null,
          expected_note_account_id: input.accountId ?? null,
          expected_note_prospect_id: input.prospectId ?? null,
          expected_note_meeting_id: input.meetingId ?? null,
          metadata: {
            expected_note_label: input.label ?? null,
            expected_note_armed_at: new Date().toISOString(),
            source_channel: input.sourceChannel,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,session_date" },
      )
      .select("*")
      .single();
    if (error) throw error;
    const result = { session: data, executionRunId: run.id, reused: run.reused };
    await completeExecution({
      db: input.db,
      userId: input.userId,
      runId: run.id,
      resultPayload: { fieldSession: result },
      targetType: "emery_field_session",
      targetId: data.id,
    });
    return result;
  } catch (error) {
    await failExecution({
      db: input.db,
      userId: input.userId,
      runId: run.id,
      errorCode: "hpo_field_session_arm_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
    }).catch(() => undefined);
    throw error;
  }
}

export function fieldSessionFromRouteMetadata(route: unknown) {
  const row = object(route);
  return object(object(row["metadata"])["field_session"]);
}
