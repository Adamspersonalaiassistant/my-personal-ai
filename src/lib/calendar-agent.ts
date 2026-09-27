/* eslint-disable @typescript-eslint/no-explicit-any */
import { MODEL_POLICY } from "@/lib/model-policy";

type CalendarActionInput = {
  db: any;
  userId: string;
  apiKey: string;
  message: string;
  recent: Array<{ role: string; text: string }>;
  timezone: string;
  openTasks: any[];
  upcomingMeetings: any[];
};

export type CalendarActionName =
  | "none"
  | "batch"
  | "create_task"
  | "create_event"
  | "complete_task"
  | "schedule_task"
  | "unschedule_task"
  | "set_task_deadline"
  | "reschedule_event"
  | "create_reminder";

export type CalendarActionItemResult = {
  action: Exclude<CalendarActionName, "none" | "batch">;
  performed: boolean;
  recordId: string | null;
  title: string | null;
  scheduledFor: string | null;
  endsAt: string | null;
  dueAt: string | null;
  reminderAt: string | null;
  eventType: string | null;
  error?: string | null;
};

export type CalendarActionResult = {
  recognized: boolean;
  performed: boolean;
  partialSuccess: boolean;
  needsClarification: boolean;
  question: string | null;
  action: CalendarActionName;
  recordId: string | null;
  title: string | null;
  scheduledFor: string | null;
  endsAt: string | null;
  dueAt: string | null;
  eventType: string | null;
  items: CalendarActionItemResult[];
  notificationScheduled: boolean;
  pushConnected: boolean | null;
  error?: string | null;
};

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item?.text ?? "")
    .join("")
    .trim();
}

function rpcRow(result: any) {
  const data = result?.data;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

function isoOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyResult(error?: string | null): CalendarActionResult {
  return {
    recognized: false,
    performed: false,
    partialSuccess: false,
    needsClarification: false,
    question: null,
    action: "none",
    recordId: null,
    title: null,
    scheduledFor: null,
    endsAt: null,
    dueAt: null,
    eventType: null,
    items: [],
    notificationScheduled: false,
    pushConnected: null,
    error: error ?? null,
  };
}

async function upsertEventReminder(input: {
  db: any;
  userId: string;
  eventId: string;
  title: string;
  reminderAt: string;
}) {
  const { error } = await input.db.from("app_notifications").upsert(
    {
      user_id: input.userId,
      title: input.title,
      body: "Calendar reminder from Emery.",
      scheduled_for: input.reminderAt,
      status: "pending",
      source_type: "calendar_event_reminder",
      source_ref: input.eventId,
      metadata: { event_id: input.eventId, workflow: "calendar_event_reminder" },
      delivered_at: null,
      read_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,source_type,source_ref" },
  );
  if (error) throw error;
}

async function performOperation(input: CalendarActionInput, operation: any): Promise<CalendarActionItemResult> {
  const { db, userId, openTasks, upcomingMeetings } = input;
  const action = String(operation.action ?? "") as CalendarActionItemResult["action"];
  const title = typeof operation.title === "string" ? operation.title.trim() : "";
  const details = typeof operation.details === "string" ? operation.details.trim() : "";
  const dueAt = isoOrNull(operation.due_at);
  const scheduledStart = isoOrNull(operation.scheduled_start_at);
  const scheduledEnd = isoOrNull(operation.scheduled_end_at);
  const reminderAt = isoOrNull(operation.reminder_at);
  const eventType = operation.event_type ?? null;
  const targetId = typeof operation.target_id === "string" ? operation.target_id.trim() : "";

  try {
    if (action === "create_task") {
      if (!title) throw new Error("Task title missing");
      if (scheduledEnd && !scheduledStart) throw new Error("Scheduled task start missing");
      if (scheduledStart && scheduledEnd && Date.parse(scheduledEnd) <= Date.parse(scheduledStart)) {
        throw new Error("Task schedule end must be after start");
      }
      const created = await db.rpc("emery_action_create_task_v2", {
        p_user_id: userId,
        p_title: title,
        p_details: details || null,
        p_due_at: dueAt,
        p_scheduled_start_at: scheduledStart,
        p_scheduled_end_at: scheduledEnd,
        p_reminder_at: reminderAt,
        p_priority: Math.min(5, Math.max(1, Number(operation.priority ?? 3))),
        p_source: "emery",
      });
      if (created.error) throw created.error;
      const row = rpcRow(created);
      if (!row?.id) throw new Error("Task creation returned no record");
      return {
        action,
        performed: true,
        recordId: row.id,
        title: row.title,
        scheduledFor: row.scheduled_start_at ?? null,
        endsAt: row.scheduled_end_at ?? null,
        dueAt: row.due_at ?? null,
        reminderAt: row.reminder_at ?? null,
        eventType: "task",
      };
    }

    if (action === "create_event") {
      const startAt = scheduledStart ?? dueAt;
      if (!title || !startAt) throw new Error("Event title and start required");
      const resolvedEnd =
        scheduledEnd && Date.parse(scheduledEnd) > Date.parse(startAt)
          ? scheduledEnd
          : new Date(Date.parse(startAt) + 60 * 60 * 1000).toISOString();
      const created = await db.rpc("emery_action_create_event", {
        p_user_id: userId,
        p_title: title,
        p_start_at: startAt,
        p_end_at: resolvedEnd,
        p_participants: Array.isArray(operation.participants)
          ? operation.participants.map(String).slice(0, 20)
          : [],
        p_event_type: eventType || "event",
        p_source: "emery",
      });
      if (created.error) throw created.error;
      const row = rpcRow(created);
      if (!row?.id) throw new Error("Event creation returned no record");
      if (reminderAt) {
        await upsertEventReminder({
          db,
          userId,
          eventId: row.id,
          title: row.title || title,
          reminderAt,
        });
      }
      return {
        action,
        performed: true,
        recordId: row.id,
        title: row.title,
        scheduledFor: row.meeting_at,
        endsAt: row.end_at,
        dueAt: null,
        reminderAt,
        eventType: (row.metadata ?? {}).event_type ?? eventType ?? "event",
      };
    }

    if (action === "create_reminder") {
      if (!title || !reminderAt) throw new Error("Reminder title and time required");
      const { data: row, error } = await db
        .from("app_notifications")
        .insert({
          user_id: userId,
          title,
          body: details || "Reminder from Emery.",
          scheduled_for: reminderAt,
          status: "pending",
          source_type: "emery_reminder",
          metadata: { workflow: "emery_reminder" },
        })
        .select("id,title,scheduled_for")
        .single();
      if (error) throw error;
      return {
        action,
        performed: true,
        recordId: row.id,
        title: row.title,
        scheduledFor: null,
        endsAt: null,
        dueAt: null,
        reminderAt: row.scheduled_for,
        eventType: null,
      };
    }

    if (!targetId) throw new Error("Target id missing");

    if (action === "complete_task") {
      const target = openTasks.find((task: any) => task.id === targetId);
      if (!target) throw new Error("Task not found");
      const updated = await db.rpc("emery_action_complete_task", {
        p_user_id: userId,
        p_task_id: targetId,
      });
      if (updated.error) throw updated.error;
      const row = rpcRow(updated);
      return {
        action,
        performed: Boolean(row?.id),
        recordId: row?.id ?? null,
        title: row?.title ?? target.title,
        scheduledFor: null,
        endsAt: null,
        dueAt: row?.due_at ?? target.due_at ?? null,
        reminderAt: null,
        eventType: "task",
      };
    }

    if (action === "schedule_task") {
      const target = openTasks.find((task: any) => task.id === targetId);
      if (!target) throw new Error("Task not found");
      if (!scheduledStart) throw new Error("Task schedule time missing");
      const updated = await db.rpc("emery_action_schedule_task_v2", {
        p_user_id: userId,
        p_task_id: targetId,
        p_start_at: scheduledStart,
        p_end_at: scheduledEnd,
        p_reminder_at: reminderAt,
      });
      if (updated.error) throw updated.error;
      const row = rpcRow(updated);
      return {
        action,
        performed: Boolean(row?.id),
        recordId: row?.id ?? null,
        title: row?.title ?? target.title,
        scheduledFor: row?.scheduled_start_at ?? scheduledStart,
        endsAt: row?.scheduled_end_at ?? scheduledEnd,
        dueAt: row?.due_at ?? target.due_at ?? null,
        reminderAt: row?.reminder_at ?? reminderAt,
        eventType: "task",
      };
    }

    if (action === "unschedule_task") {
      const target = openTasks.find((task: any) => task.id === targetId);
      if (!target) throw new Error("Task not found");
      const updated = await db.rpc("emery_action_unschedule_task", {
        p_user_id: userId,
        p_task_id: targetId,
      });
      if (updated.error) throw updated.error;
      const row = rpcRow(updated);
      return {
        action,
        performed: Boolean(row?.id),
        recordId: row?.id ?? null,
        title: row?.title ?? target.title,
        scheduledFor: null,
        endsAt: null,
        dueAt: row?.due_at ?? target.due_at ?? null,
        reminderAt: null,
        eventType: "task",
      };
    }

    if (action === "set_task_deadline") {
      const target = openTasks.find((task: any) => task.id === targetId);
      if (!target) throw new Error("Task not found");
      const updated = await db.rpc("emery_action_set_task_deadline", {
        p_user_id: userId,
        p_task_id: targetId,
        p_due_at: dueAt,
      });
      if (updated.error) throw updated.error;
      const row = rpcRow(updated);
      return {
        action,
        performed: Boolean(row?.id),
        recordId: row?.id ?? null,
        title: row?.title ?? target.title,
        scheduledFor: row?.scheduled_start_at ?? target.scheduled_start_at ?? null,
        endsAt: row?.scheduled_end_at ?? target.scheduled_end_at ?? null,
        dueAt: row?.due_at ?? null,
        reminderAt: row?.reminder_at ?? target.reminder_at ?? null,
        eventType: "task",
      };
    }

    if (action === "reschedule_event") {
      const target = upcomingMeetings.find((meeting: any) => meeting.id === targetId);
      if (!target) throw new Error("Event not found");
      const startAt = scheduledStart ?? dueAt;
      if (!startAt) throw new Error("Event start missing");
      const updated = await db.rpc("emery_action_reschedule_event", {
        p_user_id: userId,
        p_event_id: targetId,
        p_start_at: startAt,
        p_end_at: scheduledEnd,
      });
      if (updated.error) throw updated.error;
      const row = rpcRow(updated);
      if (!row?.id) throw new Error("Event reschedule returned no record");
      if (reminderAt) {
        await upsertEventReminder({
          db,
          userId,
          eventId: row.id,
          title: row.title || target.title || "Calendar event",
          reminderAt,
        });
      }
      return {
        action,
        performed: true,
        recordId: row.id,
        title: row.title,
        scheduledFor: row.meeting_at,
        endsAt: row.end_at,
        dueAt: null,
        reminderAt,
        eventType: (row.metadata ?? {}).event_type ?? eventType,
      };
    }

    throw new Error("Unsupported calendar action");
  } catch (error) {
    console.error("Calendar operation failed", action, error);
    return {
      action,
      performed: false,
      recordId: null,
      title: title || null,
      scheduledFor: scheduledStart,
      endsAt: scheduledEnd,
      dueAt,
      reminderAt,
      eventType,
      error: "calendar_write_failed",
    };
  }
}

export async function processCalendarAction(input: CalendarActionInput): Promise<CalendarActionResult> {
  const { db, userId, apiKey, message, recent, timezone, openTasks, upcomingMeetings } = input;
  const now = new Date();
  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/New_York",
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);

  const context = JSON.stringify({
    task_model: {
      rule: "A task can exist without a Calendar time block. due_at is a deadline; scheduled_start_at/scheduled_end_at are the Calendar block.",
    },
    open_tasks: openTasks.slice(0, 60).map((task: any) => ({
      id: task.id,
      title: task.title,
      details: task.details,
      due_at: task.due_at,
      scheduled_start_at: task.scheduled_start_at,
      scheduled_end_at: task.scheduled_end_at,
      reminder_at: task.reminder_at,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
    })),
    upcoming_events: upcomingMeetings.slice(0, 40).map((meeting: any) => ({
      id: meeting.id,
      title: meeting.title,
      meeting_at: meeting.meeting_at,
      end_at: meeting.end_at,
      participants: meeting.participants,
      metadata: meeting.metadata,
    })),
  }).slice(0, 18000);

  const previous = recent.slice(-12).map((turn) => ({
    role: turn.role,
    content: [{ type: turn.role === "assistant" ? "output_text" : "input_text", text: turn.text }],
  }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_POLICY.action,
      input: [
        {
          role: "system",
          content: `You are Emery's canonical Calendar + Task action controller.

Current local time: ${localNow}
Timezone: ${timezone || "America/New_York"}

CORE MODEL
- Task List and Calendar are intentionally different.
- A task does NOT need to be scheduled. Unscheduled tasks remain available in Adam's Task List for free-time work.
- due_at is an optional DEADLINE. It means when the task must be finished by. It is not automatically a Calendar block.
- scheduled_start_at and scheduled_end_at are an optional TIME BLOCK on Emery Calendar.
- reminder_at is an optional notification time.
- Events/meetings/lunches are Calendar commitments and need a start time.
- If Adam says he has free time, asks what tasks he can do, asks what is overdue, or asks for planning advice without authorizing a write, recognized=false. The main Emery model will answer using current task context.

WRITE PERMISSION
- Casual discussion is not permission to write. Only write when Adam clearly authorizes it: add, create, schedule, put this on my calendar, move, complete, unschedule, set a deadline, remind me, send me a notification, or equivalent.
- "Add this", "schedule these", "put that into my schedule", and similar references MAY resolve against the recent conversation. If the recent assistant message contains a concrete list/times and Adam explicitly approves it, carry out the whole approved set.
- Never treat an assistant suggestion as authorization by itself.
- Never invent a task, date, time, duration, person, or id.

BATCH ACTIONS
- One user turn may authorize MANY operations. Return every requested operation in operations[].
- Do not stop after the first task.
- If Adam approves a schedule containing four tasks, create/schedule all four.
- Do not shorten an explicitly stated range or duration. Preserve the exact start/end or duration Adam approved.
- Existing tasks MUST use their exact target_id from CURRENT RECORDS.
- If a task discussed in the conversation does not exist in CURRENT RECORDS and Adam explicitly asks to add it, use create_task.
- If the user says a task should be 15 minutes and the others 30 minutes, preserve those exact durations in scheduled_start_at/scheduled_end_at.
- If Adam asks for a notification 30 minutes before the first block, put reminder_at on that first task or event. For a standalone reminder, use create_reminder.

ACTION RULES
- create_task: title required. due_at may be null. scheduled_start_at/end may both be null. If scheduled_start exists and end is omitted, default to 30 minutes.
- schedule_task: target_id from CURRENT RECORDS + scheduled_start_at. Preserve an explicitly stated duration/end.
- unschedule_task: removes the Calendar block but keeps the task in the Task List.
- set_task_deadline: target_id + due_at. The task need not be scheduled.
- complete_task: exact target_id.
- create_event: title + scheduled_start_at required; default to 60 minutes only when Adam gives no end/duration.
- reschedule_event: exact target_id + new scheduled_start_at. Preserve existing duration if no new end is supplied.
- create_reminder: use only for a standalone notification not naturally attached to a task/event.
- For lunch events, event_type=lunch.
- Resolve relative dates using the supplied current local time.
- All timestamps must be ISO-8601 with an explicit UTC offset.
- If an essential detail is genuinely missing or multiple existing records could match, needs_clarification=true and ask ONE concise question. In that case operations must be empty.
- Do not claim success. Your output is only an execution plan; the server will verify each write.

CURRENT RECORDS:
${context}`,
        },
        ...previous,
        { role: "user", content: [{ type: "input_text", text: message }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "calendar_actions",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              recognized: { type: "boolean" },
              needs_clarification: { type: "boolean" },
              clarification_question: { type: ["string", "null"] },
              operations: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    action: {
                      type: "string",
                      enum: [
                        "create_task",
                        "create_event",
                        "complete_task",
                        "schedule_task",
                        "unschedule_task",
                        "set_task_deadline",
                        "reschedule_event",
                        "create_reminder"
                      ],
                    },
                    title: { type: ["string", "null"] },
                    details: { type: ["string", "null"] },
                    due_at: { type: ["string", "null"] },
                    scheduled_start_at: { type: ["string", "null"] },
                    scheduled_end_at: { type: ["string", "null"] },
                    reminder_at: { type: ["string", "null"] },
                    priority: { type: "integer", minimum: 1, maximum: 5 },
                    participants: { type: "array", items: { type: "string" }, maxItems: 20 },
                    target_id: { type: ["string", "null"] },
                    event_type: {
                      type: ["string", "null"],
                      enum: ["lunch", "meeting", "appointment", "event", "task", null],
                    },
                  },
                  required: [
                    "action",
                    "title",
                    "details",
                    "due_at",
                    "scheduled_start_at",
                    "scheduled_end_at",
                    "reminder_at",
                    "priority",
                    "participants",
                    "target_id",
                    "event_type"
                  ],
                },
              },
            },
            required: [
              "recognized",
              "needs_clarification",
              "clarification_question",
              "operations"
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    console.error("Calendar controller failed", response.status, await response.text());
    return emptyResult("calendar_controller_failed");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(responseText(await response.json()));
  } catch {
    return emptyResult("calendar_controller_unreadable");
  }

  if (!parsed.recognized) return emptyResult();

  if (parsed.needs_clarification) {
    return {
      ...emptyResult(),
      recognized: true,
      needsClarification: true,
      question: String(parsed.clarification_question ?? "What detail should I use?"),
    };
  }

  const operations = Array.isArray(parsed.operations) ? parsed.operations.slice(0, 20) : [];
  if (!operations.length) {
    return {
      ...emptyResult(),
      recognized: true,
      error: "calendar_action_empty",
    };
  }

  const items: CalendarActionItemResult[] = [];
  for (const operation of operations) {
    items.push(await performOperation(input, operation));
  }

  const successful = items.filter((item) => item.performed);
  const notificationScheduled = successful.some(
    (item) => Boolean(item.reminderAt) || item.action === "create_reminder",
  );

  let pushConnected: boolean | null = null;
  if (notificationScheduled) {
    const { count } = await db
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    pushConnected = Number(count ?? 0) > 0;
  }

  const first = successful[0] ?? items[0] ?? null;
  return {
    recognized: true,
    performed: successful.length > 0,
    partialSuccess: successful.length > 0 && successful.length < items.length,
    needsClarification: false,
    question: null,
    action: items.length > 1 ? "batch" : (first?.action ?? "none"),
    recordId: first?.recordId ?? null,
    title: first?.title ?? null,
    scheduledFor: first?.scheduledFor ?? null,
    endsAt: first?.endsAt ?? null,
    dueAt: first?.dueAt ?? null,
    eventType: first?.eventType ?? null,
    items,
    notificationScheduled,
    pushConnected,
    error:
      successful.length === 0
        ? "calendar_write_failed"
        : successful.length < items.length
          ? "calendar_partial_write"
          : null,
  };
}
