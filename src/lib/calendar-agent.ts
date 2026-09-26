/* eslint-disable @typescript-eslint/no-explicit-any */

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

export type CalendarActionResult = {
  recognized: boolean;
  performed: boolean;
  needsClarification: boolean;
  question: string | null;
  action:
    | "none"
    | "create_task"
    | "create_event"
    | "complete_task"
    | "schedule_task"
    | "reschedule_event";
  recordId: string | null;
  title: string | null;
  scheduledFor: string | null;
  eventType: string | null;
  error?: string | null;
};

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item?.text ?? "")
    .join("")
    .trim();
}

function isoOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    open_tasks: openTasks.slice(0, 30).map((task: any) => ({
      id: task.id,
      title: task.title,
      due_at: task.due_at,
      status: task.status,
      priority: task.priority,
    })),
    upcoming_events: upcomingMeetings.slice(0, 30).map((meeting: any) => ({
      id: meeting.id,
      title: meeting.title,
      meeting_at: meeting.meeting_at,
      participants: meeting.participants,
      metadata: meeting.metadata,
    })),
  }).slice(0, 12000);

  const previous = recent.slice(-10).map((turn) => ({
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
      model: "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content: `You are Emery's calendar action controller. Determine whether Adam is explicitly asking Emery to create, schedule, move, or complete something in Emery's internal Calendar/Tasks.

Current local time: ${localNow}
Timezone: ${timezone || "America/New_York"}

Rules:
- Only choose a write action when Adam clearly authorizes it with words such as add, create, put on my calendar, schedule, move, mark complete, finished, done, remind me, or equivalent.
- Casual discussion or asking what he should do is action=none.
- create_task may be unscheduled if Adam asks to add a task but gives no time.
- create_event requires a clear event/lunch/meeting identity plus a date and time. If one is missing, needs_clarification=true and ask ONE short question.
- If Adam says he "has lunch with X Tuesday at noon", and the conversational context shows he is trying to add/capture it, treat it as create_event.
- If a lunch is created, event_type MUST be "lunch".
- schedule_task and complete_task must reference an exact id from OPEN TASKS. If ambiguous, ask one short question.
- reschedule_event must reference an exact id from UPCOMING EVENTS and have a new time. If ambiguous or missing time, ask one short question.
- Resolve today/tomorrow/weekdays using the current local time and timezone.
- Never invent people, dates, times, or ids.
- Keep clarification_question concise and natural.
- title should be human-readable, e.g. "Lunch with Jason Morrin" or "Call Cary".
- For new lunch events, put people names in participants when known.
- due_at should be an ISO-8601 timestamp including an offset when a time is required.

CURRENT RECORDS:\n${context}`,
        },
        ...previous,
        { role: "user", content: [{ type: "input_text", text: message }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "calendar_action",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              recognized: { type: "boolean" },
              action: {
                type: "string",
                enum: ["none", "create_task", "create_event", "complete_task", "schedule_task", "reschedule_event"],
              },
              needs_clarification: { type: "boolean" },
              clarification_question: { type: ["string", "null"] },
              title: { type: ["string", "null"] },
              details: { type: ["string", "null"] },
              due_at: { type: ["string", "null"] },
              priority: { type: "integer", minimum: 1, maximum: 5 },
              participants: { type: "array", items: { type: "string" }, maxItems: 20 },
              target_id: { type: ["string", "null"] },
              event_type: { type: ["string", "null"], enum: ["lunch", "meeting", "appointment", "event", "task", null] },
            },
            required: [
              "recognized",
              "action",
              "needs_clarification",
              "clarification_question",
              "title",
              "details",
              "due_at",
              "priority",
              "participants",
              "target_id",
              "event_type",
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    console.error("Calendar controller failed", response.status, await response.text());
    return {
      recognized: false,
      performed: false,
      needsClarification: false,
      question: null,
      action: "none",
      recordId: null,
      title: null,
      scheduledFor: null,
      eventType: null,
      error: "calendar_controller_failed",
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(responseText(await response.json()));
  } catch {
    return {
      recognized: false,
      performed: false,
      needsClarification: false,
      question: null,
      action: "none",
      recordId: null,
      title: null,
      scheduledFor: null,
      eventType: null,
      error: "calendar_controller_unreadable",
    };
  }

  const action = parsed.action as CalendarActionResult["action"];
  if (!parsed.recognized || action === "none") {
    return {
      recognized: Boolean(parsed.recognized),
      performed: false,
      needsClarification: false,
      question: null,
      action: "none",
      recordId: null,
      title: parsed.title ?? null,
      scheduledFor: null,
      eventType: parsed.event_type ?? null,
    };
  }

  if (parsed.needs_clarification) {
    return {
      recognized: true,
      performed: false,
      needsClarification: true,
      question: String(parsed.clarification_question ?? "What detail should I use?"),
      action,
      recordId: null,
      title: parsed.title ?? null,
      scheduledFor: isoOrNull(parsed.due_at),
      eventType: parsed.event_type ?? null,
    };
  }

  const dueAt = isoOrNull(parsed.due_at);
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const details = typeof parsed.details === "string" ? parsed.details.trim() : "";
  const eventType = parsed.event_type ?? null;

  try {
    if (action === "create_task") {
      if (!title) throw new Error("Task title missing");
      const created = await db
        .from("tasks")
        .insert({
          user_id: userId,
          title,
          details: details || null,
          due_at: dueAt,
          priority: Math.min(5, Math.max(1, Number(parsed.priority ?? 3))),
          status: "inbox",
          source_type: "emery",
          metadata: {
            source: "emery",
            calendar: Boolean(dueAt),
            event_type: "task",
          },
        })
        .select("id, title, due_at")
        .single();
      if (created.error) throw created.error;
      return {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action,
        recordId: created.data.id,
        title: created.data.title,
        scheduledFor: created.data.due_at,
        eventType: "task",
      };
    }

    if (action === "create_event") {
      if (!title || !dueAt) {
        return {
          recognized: true,
          performed: false,
          needsClarification: true,
          question: !title ? "What should I call the event?" : "What date and time should I put it on your calendar?",
          action,
          recordId: null,
          title: title || null,
          scheduledFor: dueAt,
          eventType,
        };
      }
      const created = await db
        .from("meetings")
        .insert({
          user_id: userId,
          title,
          meeting_at: dueAt,
          participants: Array.isArray(parsed.participants) ? parsed.participants.map(String).slice(0, 20) : [],
          metadata: {
            source_type: "emery",
            source: "emery",
            event_type: eventType || "event",
            calendar: true,
          },
        })
        .select("id, title, meeting_at")
        .single();
      if (created.error) throw created.error;
      return {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action,
        recordId: created.data.id,
        title: created.data.title,
        scheduledFor: created.data.meeting_at,
        eventType: eventType || "event",
      };
    }

    const targetId = typeof parsed.target_id === "string" ? parsed.target_id : "";
    if (!targetId) {
      return {
        recognized: true,
        performed: false,
        needsClarification: true,
        question: String(parsed.clarification_question ?? "Which item do you mean?"),
        action,
        recordId: null,
        title: title || null,
        scheduledFor: dueAt,
        eventType,
      };
    }

    if (action === "complete_task") {
      const target = openTasks.find((task: any) => task.id === targetId);
      if (!target) throw new Error("Task not found");
      const updated = await db
        .from("tasks")
        .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", targetId)
        .eq("user_id", userId)
        .select("id, title")
        .single();
      if (updated.error) throw updated.error;
      return {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action,
        recordId: updated.data.id,
        title: updated.data.title,
        scheduledFor: null,
        eventType: "task",
      };
    }

    if (action === "schedule_task") {
      if (!dueAt) {
        return {
          recognized: true,
          performed: false,
          needsClarification: true,
          question: "What day and time should I schedule it?",
          action,
          recordId: targetId,
          title: title || null,
          scheduledFor: null,
          eventType: "task",
        };
      }
      const target = openTasks.find((task: any) => task.id === targetId);
      if (!target) throw new Error("Task not found");
      const updated = await db
        .from("tasks")
        .update({
          due_at: dueAt,
          metadata: { ...(target.metadata ?? {}), calendar: true, source: "emery" },
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetId)
        .eq("user_id", userId)
        .select("id, title, due_at")
        .single();
      if (updated.error) throw updated.error;
      return {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action,
        recordId: updated.data.id,
        title: updated.data.title,
        scheduledFor: updated.data.due_at,
        eventType: "task",
      };
    }

    if (action === "reschedule_event") {
      if (!dueAt) {
        return {
          recognized: true,
          performed: false,
          needsClarification: true,
          question: "What new date and time should I use?",
          action,
          recordId: targetId,
          title: title || null,
          scheduledFor: null,
          eventType,
        };
      }
      const target = upcomingMeetings.find((meeting: any) => meeting.id === targetId);
      if (!target) throw new Error("Event not found");
      const updated = await db
        .from("meetings")
        .update({ meeting_at: dueAt, updated_at: new Date().toISOString() })
        .eq("id", targetId)
        .eq("user_id", userId)
        .select("id, title, meeting_at, metadata")
        .single();
      if (updated.error) throw updated.error;
      return {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action,
        recordId: updated.data.id,
        title: updated.data.title,
        scheduledFor: updated.data.meeting_at,
        eventType: (updated.data.metadata ?? {}).event_type ?? eventType,
      };
    }
  } catch (error) {
    console.error("Calendar action write failed", error);
    return {
      recognized: true,
      performed: false,
      needsClarification: false,
      question: null,
      action,
      recordId: null,
      title: title || null,
      scheduledFor: dueAt,
      eventType,
      error: "calendar_write_failed",
    };
  }

  return {
    recognized: false,
    performed: false,
    needsClarification: false,
    question: null,
    action: "none",
    recordId: null,
    title: null,
    scheduledFor: null,
    eventType: null,
  };
}
