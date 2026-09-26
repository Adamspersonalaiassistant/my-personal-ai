/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function safeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function verifyProject(db: any, userId: string, projectId: string | null) {
  if (!projectId) return null;
  const { data, error } = await db
    .from("projects")
    .select("id, name, status, priority, goal, next_action")
    .eq("user_id", userId)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Project not found");
  return data;
}

export const getOperatingSystemSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    const now = new Date().toISOString();

    const [
      tasksResult,
      projectsResult,
      meetingsResult,
      memoriesResult,
      attachmentsResult,
      agentsResult,
    ] = await Promise.all([
      db
        .from("tasks")
        .select("id, title, details, status, priority, due_at, project_id, metadata, created_at")
        .eq("user_id", userId)
        .neq("status", "completed")
        .order("priority", { ascending: false })
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(20),
      db
        .from("projects")
        .select("id, name, description, status, priority, goal, next_action, updated_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("priority", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(12),
      db
        .from("meetings")
        .select("id, title, meeting_at, end_at, participants, summary, metadata, created_at")
        .eq("user_id", userId)
        .gte("meeting_at", now)
        .order("meeting_at", { ascending: true })
        .limit(12),
      db
        .from("memories")
        .select("id, title, content, memory_type, importance, updated_at")
        .eq("user_id", userId)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(10),
      db
        .from("message_attachments")
        .select(
          "id, message_id, conversation_id, file_name, mime_type, size_bytes, storage_path, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8),
      db
        .from("agents")
        .select("id, name, slug, description, is_internal, is_active, sort_order")
        .eq("user_id", userId)
        .eq("is_active", true)
        .eq("is_internal", false)
        .order("sort_order", { ascending: true })
        .limit(12),
    ]);

    for (const result of [
      tasksResult,
      projectsResult,
      meetingsResult,
      memoriesResult,
      attachmentsResult,
      agentsResult,
    ]) {
      if (result.error) throw result.error;
    }

    const projects = projectsResult.data ?? [];
    const projectById = new Map(projects.map((project: any) => [project.id, project]));
    const tasks = (tasksResult.data ?? []).map((task: any) => ({
      ...task,
      project: task.project_id ? (projectById.get(task.project_id) ?? null) : null,
    }));
    const meetings = (meetingsResult.data ?? []).map((meeting: any) => {
      const metadata = safeMetadata(meeting.metadata);
      const projectId =
        typeof metadata["project_id"] === "string" ? String(metadata["project_id"]) : null;
      return {
        ...meeting,
        project_id: projectId,
        project: projectId ? (projectById.get(projectId) ?? null) : null,
      };
    });

    const projectExecution = projects.map((project: any) => {
      const projectTasks = tasks.filter((task: any) => task.project_id === project.id);
      const projectMeetings = meetings.filter((meeting: any) => meeting.project_id === project.id);
      return {
        ...project,
        open_task_count: projectTasks.length,
        high_priority_task_count: projectTasks.filter((task: any) => Number(task.priority) >= 4)
          .length,
        next_task: projectTasks[0] ?? null,
        next_meeting: projectMeetings[0] ?? null,
      };
    });

    const attachments = await Promise.all(
      (attachmentsResult.data ?? []).map(async (attachment: any) => {
        const { data } = await db.storage
          .from("emery-attachments")
          .createSignedUrl(attachment.storage_path, 600);
        return {
          id: attachment.id,
          message_id: attachment.message_id,
          conversation_id: attachment.conversation_id,
          file_name: attachment.file_name,
          mime_type: attachment.mime_type,
          size_bytes: Number(attachment.size_bytes ?? 0),
          created_at: attachment.created_at,
          url: data?.signedUrl ?? null,
        };
      }),
    );

    const highestPriorityTask = tasks[0] ?? null;
    const firstProjectWithoutNextAction =
      projectExecution.find((project: any) => !project.next_action) ?? null;
    const nextMeeting = meetings[0] ?? null;

    return {
      generatedAt: now,
      focus: {
        task: highestPriorityTask,
        project_needing_next_action: firstProjectWithoutNextAction,
        meeting: nextMeeting,
      },
      tasks,
      projects: projectExecution,
      meetings,
      memories: memoriesResult.data ?? [],
      attachments,
      agents: agentsResult.data ?? [],
    };
  });

export const listProjectOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("projects")
      .select("id, name, priority, status")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return { projects: data ?? [] };
  });

export const createLinkedTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      title: string;
      details?: string;
      dueAt?: string | null;
      priority?: number;
      projectId?: string | null;
    }) => {
      const title = String(input?.title ?? "").trim();
      if (!title) throw new Error("Task title is required");
      return {
        title,
        details: String(input?.details ?? "").trim() || null,
        dueAt: input?.dueAt || null,
        priority: Math.min(5, Math.max(1, Number(input?.priority ?? 3))),
        projectId: input?.projectId ? String(input.projectId) : null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await verifyProject(db, context.userId, data.projectId);
    const { data: task, error } = await db
      .from("tasks")
      .insert({
        user_id: context.userId,
        title: data.title,
        details: data.details,
        due_at: data.dueAt,
        priority: data.priority,
        project_id: data.projectId,
        status: "inbox",
        source_type: "manual",
        metadata: {},
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: task.id };
  });

export const createLinkedMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      title: string;
      meetingAt: string;
      endAt?: string | null;
      participants?: string[];
      projectId?: string | null;
      eventType?: "event" | "meeting" | "appointment" | "lunch";
    }) => {
      const title = String(input?.title ?? "").trim();
      if (!title) throw new Error("Meeting title is required");
      if (!input?.meetingAt || Number.isNaN(Date.parse(input.meetingAt))) {
        throw new Error("Meeting date and time are required");
      }
      const endAt = input?.endAt ? String(input.endAt) : null;
      if (endAt && Number.isNaN(Date.parse(endAt))) throw new Error("Invalid event end time");
      if (endAt && Date.parse(endAt) <= Date.parse(input.meetingAt)) {
        throw new Error("Event end time must be after the start time");
      }
      return {
        title,
        meetingAt: input.meetingAt,
        endAt: endAt || new Date(Date.parse(input.meetingAt) + 60 * 60 * 1000).toISOString(),
        projectId: input?.projectId ? String(input.projectId) : null,
        eventType: ["event", "meeting", "appointment", "lunch"].includes(String(input?.eventType))
          ? String(input.eventType)
          : "event",
        participants: Array.isArray(input?.participants)
          ? input.participants
              .map(String)
              .map((value) => value.trim())
              .filter(Boolean)
              .slice(0, 20)
          : [],
      };
    },
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await verifyProject(db, context.userId, data.projectId);
    const metadata = data.projectId
      ? { project_id: data.projectId, source_type: "manual", event_type: data.eventType }
      : { source_type: "manual", event_type: data.eventType };
    const { data: meeting, error } = await db
      .from("meetings")
      .insert({
        user_id: context.userId,
        title: data.title,
        meeting_at: data.meetingAt,
        end_at: data.endAt,
        participants: data.participants,
        metadata,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: meeting.id };
  });

export const listUnifiedMeetings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const [{ data: meetings, error: meetingError }, { data: projects, error: projectError }] =
      await Promise.all([
        db
          .from("meetings")
          .select("id, title, meeting_at, end_at, participants, summary, metadata, created_at")
          .eq("user_id", context.userId)
          .order("meeting_at", { ascending: true, nullsFirst: false }),
        db.from("projects").select("id, name").eq("user_id", context.userId).limit(100),
      ]);
    if (meetingError) throw meetingError;
    if (projectError) throw projectError;
    const projectById = new Map((projects ?? []).map((project: any) => [project.id, project.name]));
    return {
      meetings: (meetings ?? []).map((meeting: any) => {
        const metadata = safeMetadata(meeting.metadata);
        const projectId =
          typeof metadata["project_id"] === "string" ? String(metadata["project_id"]) : null;
        return {
          ...meeting,
          project_id: projectId,
          project_name: projectId ? (projectById.get(projectId) ?? null) : null,
        };
      }),
    };
  });

export const listUnifiedTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const [{ data: tasks, error: taskError }, { data: projects, error: projectError }] =
      await Promise.all([
        db
          .from("tasks")
          .select(
            "id, title, details, status, priority, due_at, completed_at, project_id, metadata, created_at",
          )
          .eq("user_id", context.userId)
          .order("completed_at", { ascending: false, nullsFirst: true })
          .order("priority", { ascending: false })
          .order("due_at", { ascending: true, nullsFirst: false }),
        db.from("projects").select("id, name").eq("user_id", context.userId).limit(100),
      ]);
    if (taskError) throw taskError;
    if (projectError) throw projectError;
    const projectById = new Map((projects ?? []).map((project: any) => [project.id, project.name]));
    return {
      tasks: (tasks ?? []).map((task: any) => ({
        ...task,
        project_name: task.project_id ? (projectById.get(task.project_id) ?? null) : null,
      })),
    };
  });


export const scheduleTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; dueAt: string | null }) => {
    const id = String(input?.id ?? "").trim();
    if (!id) throw new Error("Task id is required");
    const dueAt = input?.dueAt ? String(input.dueAt) : null;
    if (dueAt && Number.isNaN(Date.parse(dueAt))) throw new Error("Invalid task time");
    return { id, dueAt };
  })
  .handler(async ({ data, context }) => {
    const { data: task, error } = await (context.supabase as any)
      .from("tasks")
      .update({
        due_at: data.dueAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id, title, due_at")
      .single();
    if (error) throw error;
    return { task };
  });

export const rescheduleMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; meetingAt: string; endAt?: string | null }) => {
    const id = String(input?.id ?? "").trim();
    const meetingAt = String(input?.meetingAt ?? "");
    const endAt = input?.endAt ? String(input.endAt) : null;
    if (!id) throw new Error("Meeting id is required");
    if (!meetingAt || Number.isNaN(Date.parse(meetingAt))) throw new Error("Invalid meeting time");
    if (endAt && Number.isNaN(Date.parse(endAt))) throw new Error("Invalid event end time");
    if (endAt && Date.parse(endAt) <= Date.parse(meetingAt)) throw new Error("Event end time must be after the start time");
    return { id, meetingAt, endAt };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: current, error: currentError } = await db
      .from("meetings")
      .select("meeting_at, end_at")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (currentError) throw currentError;

    const previousStart = Date.parse(current.meeting_at);
    const previousEnd = current.end_at ? Date.parse(current.end_at) : previousStart + 60 * 60 * 1000;
    const durationMs = Math.max(15 * 60 * 1000, previousEnd - previousStart);
    const nextStart = Date.parse(data.meetingAt);
    const nextEnd = data.endAt
      ? new Date(data.endAt).toISOString()
      : new Date(nextStart + durationMs).toISOString();

    const { data: meeting, error } = await db
      .from("meetings")
      .update({
        meeting_at: data.meetingAt,
        end_at: nextEnd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id, title, meeting_at, end_at")
      .single();
    if (error) throw error;
    return { meeting };
  });


export const listDueCalendarNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const now = new Date().toISOString();
    const { data, error } = await (context.supabase as any)
      .from("app_notifications")
      .select("id, title, body, scheduled_for, status, source_type, source_ref, metadata, delivered_at, read_at, created_at")
      .eq("user_id", context.userId)
      .lte("scheduled_for", now)
      .in("status", ["pending", "delivered"])
      .order("scheduled_for", { ascending: false })
      .limit(50);
    if (error) throw error;
    return { notifications: data ?? [] };
  });

export const markCalendarNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; state: "delivered" | "read" | "dismissed" }) => ({
    id: String(input?.id ?? "").trim(),
    state: input.state,
  }))
  .handler(async ({ data, context }) => {
    if (!data.id) throw new Error("Notification id is required");
    const now = new Date().toISOString();
    const patch =
      data.state === "delivered"
        ? { status: "delivered", delivered_at: now, updated_at: now }
        : data.state === "read"
          ? { status: "read", read_at: now, updated_at: now }
          : { status: "dismissed", read_at: now, updated_at: now };
    const { error } = await (context.supabase as any)
      .from("app_notifications")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });


export const getPushNotificationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error, count } = await (context.supabase as any)
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, created_at, updated_at", { count: "exact" })
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    const rows = data ?? [];
    return {
      connected: Number(count ?? rows.length) > 0,
      subscriptionCount: Number(count ?? rows.length),
      latestUpdatedAt: rows[0]?.updated_at ?? null,
      userAgent: rows[0]?.user_agent ?? null,
    };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }) => {
    const endpoint = String(input?.endpoint ?? "").trim();
    const p256dh = String(input?.p256dh ?? "").trim();
    const auth = String(input?.auth ?? "").trim();
    if (!endpoint || !p256dh || !auth) throw new Error("Invalid push subscription");
    return {
      endpoint: endpoint.slice(0, 4000),
      p256dh: p256dh.slice(0, 1000),
      auth: auth.slice(0, 1000),
      userAgent: input?.userAgent ? String(input.userAgent).slice(0, 1000) : null,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: subscription, error } = await (context.supabase as any)
      .from("push_subscriptions")
      .upsert(
        {
          user_id: context.userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          user_agent: data.userAgent,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,endpoint" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return { id: subscription.id };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { endpoint: string }) => {
    const endpoint = String(input?.endpoint ?? "").trim();
    if (!endpoint) throw new Error("Push endpoint is required");
    return { endpoint };
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId)
      .eq("endpoint", data.endpoint);
    if (error) throw error;
    return { ok: true };
  });
