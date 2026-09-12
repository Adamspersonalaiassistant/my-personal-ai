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
        .select("id, title, meeting_at, participants, summary, metadata, created_at")
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
      participants?: string[];
      projectId?: string | null;
    }) => {
      const title = String(input?.title ?? "").trim();
      if (!title) throw new Error("Meeting title is required");
      if (!input?.meetingAt || Number.isNaN(Date.parse(input.meetingAt))) {
        throw new Error("Meeting date and time are required");
      }
      return {
        title,
        meetingAt: input.meetingAt,
        projectId: input?.projectId ? String(input.projectId) : null,
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
      ? { project_id: data.projectId, source_type: "manual" }
      : { source_type: "manual" };
    const { data: meeting, error } = await db
      .from("meetings")
      .insert({
        user_id: context.userId,
        title: data.title,
        meeting_at: data.meetingAt,
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
          .select("id, title, meeting_at, participants, summary, metadata, created_at")
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
