/* eslint-disable @typescript-eslint/no-explicit-any */

export type ExecutionSourceChannel =
  | "text"
  | "voice"
  | "shortcut"
  | "capture"
  | "ui"
  | "agent"
  | "automation"
  | "unknown";

export type CanonicalTaskCreateInput = {
  db: any;
  userId: string;
  idempotencyKey: string;
  title: string;
  details?: string | null;
  dueAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  reminderAt?: string | null;
  priority?: number;
  projectId?: string | null;
  sourceChannel?: ExecutionSourceChannel | string;
  sourceMessageId?: string | null;
  parentRunId?: string | null;
  executionRunId?: string | null;
  source?: string;
};

export type CanonicalTaskCreateReceipt = {
  ok: boolean;
  status: "completed" | "failed" | "needs_clarification" | string;
  action: "task.create" | string;
  reused: boolean;
  executionRunId: string | null;
  idempotencyKey?: string | null;
  targetType?: "task" | string | null;
  targetId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  task?: {
    id: string;
    title: string;
    details: string | null;
    status: string;
    priority: number;
    due_at: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
    reminder_at: string | null;
    estimated_minutes: number | null;
    project_id: string | null;
    created_at: string;
  };
};

function cleanIso(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid task date/time");
  return date.toISOString();
}

export async function executeCanonicalTaskCreate(
  input: CanonicalTaskCreateInput,
): Promise<CanonicalTaskCreateReceipt> {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("Task title is required");

  const idempotencyKey = String(input.idempotencyKey ?? "").trim();
  if (!idempotencyKey && !input.executionRunId) {
    throw new Error("Task creation requires an idempotency key");
  }

  const dueAt = cleanIso(input.dueAt);
  const scheduledStartAt = cleanIso(input.scheduledStartAt);
  const scheduledEndAt = cleanIso(input.scheduledEndAt);
  const reminderAt = cleanIso(input.reminderAt);

  if (scheduledEndAt && !scheduledStartAt) {
    throw new Error("Scheduled task start is required");
  }
  if (
    scheduledStartAt &&
    scheduledEndAt &&
    Date.parse(scheduledEndAt) <= Date.parse(scheduledStartAt)
  ) {
    throw new Error("Scheduled task end must be after start");
  }

  const { data, error } = await input.db.rpc("emery_kernel_task_create", {
    p_user_id: input.userId,
    p_idempotency_key: idempotencyKey || null,
    p_title: title,
    p_details: String(input.details ?? "").trim() || null,
    p_due_at: dueAt,
    p_scheduled_start_at: scheduledStartAt,
    p_scheduled_end_at: scheduledEndAt,
    p_reminder_at: reminderAt,
    p_priority: Math.min(5, Math.max(1, Number(input.priority ?? 3))),
    p_project_id: input.projectId || null,
    p_source_channel: input.sourceChannel || "unknown",
    p_source_message_id: input.sourceMessageId || null,
    p_parent_run_id: input.parentRunId || null,
    p_execution_run_id: input.executionRunId || null,
    p_source: input.source || "emery",
  });

  if (error) throw error;

  const receipt = data as CanonicalTaskCreateReceipt | null;
  if (!receipt || typeof receipt !== "object") {
    throw new Error("Task creation returned no execution receipt");
  }

  if (receipt.ok) {
    if (receipt.status !== "completed" || !receipt.executionRunId || !receipt.task?.id) {
      throw new Error("Task creation verification was incomplete");
    }
    return receipt;
  }

  return receipt;
}
