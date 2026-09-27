/* eslint-disable @typescript-eslint/no-explicit-any */

export type ExecutionStatus =
  | "requested"
  | "validated"
  | "running"
  | "completed"
  | "needs_clarification"
  | "failed"
  | "cancelled";

export type ExecutionRun = {
  id: string;
  status: ExecutionStatus;
  resultPayload: Record<string, unknown>;
  reused: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function beginExecution(input: {
  db: any;
  userId: string;
  domain: string;
  action: string;
  sourceMessageId?: string | null;
  parentRunId?: string | null;
  idempotencyKey?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  requestPayload?: Record<string, unknown>;
}): Promise<ExecutionRun> {
  const {
    db,
    userId,
    domain,
    action,
    sourceMessageId = null,
    parentRunId = null,
    idempotencyKey = null,
    targetType = null,
    targetId = null,
    requestPayload = {},
  } = input;

  if (idempotencyKey) {
    const { data: existing, error: existingError } = await db
      .from("emery_execution_runs")
      .select("id,status,result_payload")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return {
        id: existing.id,
        status: existing.status as ExecutionStatus,
        resultPayload: asObject(existing.result_payload),
        reused: true,
      };
    }
  }

  const { data, error } = await db
    .from("emery_execution_runs")
    .insert({
      user_id: userId,
      source_message_id: sourceMessageId,
      parent_run_id: parentRunId,
      domain,
      action,
      status: "running",
      idempotency_key: idempotencyKey,
      target_type: targetType,
      target_id: targetId,
      request_payload: requestPayload,
      started_at: new Date().toISOString(),
    })
    .select("id,status,result_payload")
    .single();

  if (error) {
    if (idempotencyKey && String(error.code ?? "") === "23505") {
      const { data: raced, error: raceError } = await db
        .from("emery_execution_runs")
        .select("id,status,result_payload")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .single();
      if (raceError) throw raceError;
      return {
        id: raced.id,
        status: raced.status as ExecutionStatus,
        resultPayload: asObject(raced.result_payload),
        reused: true,
      };
    }
    throw error;
  }

  return {
    id: data.id,
    status: data.status as ExecutionStatus,
    resultPayload: asObject(data.result_payload),
    reused: false,
  };
}

async function finishExecution(input: {
  db: any;
  userId: string;
  runId: string;
  status: ExecutionStatus;
  resultPayload?: Record<string, unknown>;
  targetType?: string | null;
  targetId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
}) {
  const { error } = await input.db
    .from("emery_execution_runs")
    .update({
      status: input.status,
      result_payload: input.resultPayload ?? {},
      target_type: input.targetType ?? undefined,
      target_id: input.targetId ?? undefined,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ?? null,
      retryable: Boolean(input.retryable),
      completed_at:
        input.status === "completed" ||
        input.status === "failed" ||
        input.status === "needs_clarification" ||
        input.status === "cancelled"
          ? new Date().toISOString()
          : null,
    })
    .eq("id", input.runId)
    .eq("user_id", input.userId);
  if (error) throw error;
}

export async function completeExecution(input: {
  db: any;
  userId: string;
  runId: string;
  resultPayload: Record<string, unknown>;
  targetType?: string | null;
  targetId?: string | null;
}) {
  await finishExecution({
    ...input,
    status: "completed",
  });
}

export async function clarifyExecution(input: {
  db: any;
  userId: string;
  runId: string;
  question: string;
  resultPayload?: Record<string, unknown>;
}) {
  await finishExecution({
    db: input.db,
    userId: input.userId,
    runId: input.runId,
    status: "needs_clarification",
    resultPayload: {
      ...(input.resultPayload ?? {}),
      question: input.question,
    },
  });
}

export async function failExecution(input: {
  db: any;
  userId: string;
  runId: string;
  errorCode: string;
  errorMessage?: string | null;
  retryable?: boolean;
  resultPayload?: Record<string, unknown>;
}) {
  await finishExecution({
    db: input.db,
    userId: input.userId,
    runId: input.runId,
    status: "failed",
    resultPayload: input.resultPayload ?? {},
    errorCode: input.errorCode,
    errorMessage: input.errorMessage ?? null,
    retryable: Boolean(input.retryable),
  });
}

export async function recentExecutionReceipts(input: {
  db: any;
  userId: string;
  limit?: number;
}) {
  const { data, error } = await input.db
    .from("emery_execution_runs")
    .select(
      "id,domain,action,status,target_type,target_id,result_payload,error_code,retryable,created_at,completed_at",
    )
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(30, input.limit ?? 12)));
  if (error) throw error;
  return data ?? [];
}
