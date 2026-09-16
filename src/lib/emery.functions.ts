/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSISTANT_IDENTITY } from "@/lib/assistant-identity";
import { createAgentFromInstruction, consultSpecialistFromEmery } from "@/lib/agent.functions";
import { isExplicitAgentCreationCommand, routeMainSpecialist } from "@/lib/agent-policy";
import { processHpoTurn, type HpoTurnResult } from "@/lib/hpo-chat-router";
import {
  buildExecutiveFocus,
  readConversationState,
  refreshRollingConversationState,
  selectRelevantMemories,
} from "@/lib/emery-intelligence";

type AttachmentInput = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type ChatInput = {
  message?: string;
  attachments?: AttachmentInput[];
};

type Profile = {
  display_name: string | null;
  assistant_name: string | null;
  timezone: string | null;
  profile_summary: string | null;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  attachments: ChatAttachment[];
};

type ChatAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
};

type ExistingMemory = {
  id: string;
  title: string | null;
  content: string;
  memory_type: string;
};

type MemoryCandidate = {
  action: "create" | "update" | "profile_update" | "none";
  memory_type: string;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  reason: string;
  target_memory_id: string | null;
};

type ActionKind =
  | "none"
  | "propose_task"
  | "create_task"
  | "complete_task"
  | "propose_project"
  | "create_project"
  | "update_project"
  | "propose_meeting"
  | "create_meeting";

type ActionCandidate = {
  action: ActionKind;
  confidence: number;
  target_id: string | null;
  title: string;
  details: string;
  priority: number | null;
  due_at: string | null;
  due_date_only: boolean;
  meeting_at: string | null;
  participants: string[];
  goal: string;
  description: string;
  next_action: string;
  project_status: string;
  needs_confirmation: boolean;
  question: string;
  cancel_pending: boolean;
  reason: string;
};

type TurnAnalysis = {
  action: ActionCandidate;
  memories: MemoryCandidate[];
};

type ActionContext = {
  tasks: Array<{
    id: string;
    title: string;
    details: string | null;
    status: string;
    priority: number;
    due_at: string | null;
    metadata: unknown;
    project_id: string | null;
  }>;
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    priority: number;
    goal: string | null;
    next_action: string | null;
  }>;
  meetings: Array<{
    id: string;
    title: string | null;
    meeting_at: string | null;
    participants: unknown;
    metadata: unknown;
  }>;
};

type PendingAction = ActionCandidate | null;

const AUTOMATIC_MEMORY_TYPES = new Set([
  "goal",
  "preference",
  "relationship",
  "routine",
  "responsibility",
  "working_preference",
  "decision",
  "constraint",
  "project_context",
]);

const PROFILE_MEMORY_TYPES = new Set([
  "profile_name",
  "profile_assistant_name",
  "profile_timezone",
  "profile_summary",
]);

const SENSITIVE_CONTENT =
  /\b(password|passcode|pin|api[ _-]?key|secret|private key|seed phrase|recovery phrase|access token|refresh token|bank account|routing number|credit card|cvv|social security|ssn)\b/i;

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function looksSensitive(text: string) {
  return (
    SENSITIVE_CONTENT.test(text) ||
    /\bsk-[A-Za-z0-9_-]{16,}\b/.test(text) ||
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(text) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
  );
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeTitle(fact: string) {
  const words = fact.split(/\s+/).slice(0, 6).join(" ");
  return words.length < fact.length ? `${words}…` : words;
}

function isClearCorrection(message: string) {
  return /\b(actually|correction|correct that|no longer|not anymore|changed|instead|from now on|now (?:i|my|we))\b/i.test(
    message,
  );
}

function extractExplicitMemory(message: string): string | null {
  const patterns = [
    /^\s*(?:hey\s+)?(?:please\s+|can you\s+|could you\s+)?(?:remember|memorize|keep in mind|note|save)(?:\s+this|\s+that|\s+it)?\s*(?:to|in|into)?\s*(?:memory|long[- ]term memory)?\s*[:,-]?\s+(.+)$/is,
    /^\s*(?:please\s+)?save\s+(?:this|that)\s+(?:to|in|into)\s+memory\s*[:,-]?\s*(.*)$/is,
  ];
  for (const re of patterns) {
    const match = message.match(re);
    if (match?.[1]) {
      const fact = match[1]
        .trim()
        .replace(/^that\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (fact.length >= 2 && fact.length <= 2000) return fact;
    }
  }
  return null;
}

function isAboutOwnName(text: string) {
  return (
    /\bmy\s+(?:full\s+|first\s+|legal\s+)?name\s+(?:is|=|:)/i.test(text) ||
    /\b(?:i am called|i'm called|you can call me|call me)\b/i.test(text)
  );
}

const NAME_STOP_WORDS = new Set([
  "and",
  "but",
  "so",
  "then",
  "also",
  "please",
  "remember",
  "moving",
  "forward",
  "from",
  "for",
  "in",
  "to",
  "that",
  "thanks",
  "thank",
  "ok",
  "okay",
]);

function extractName(message: string): string | null {
  const match = message.match(
    /\b(?:my\s+(?:full\s+|first\s+|legal\s+)?name\s+(?:is|=|:)|i am called|i'm called|you can call me|call me)\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,3})/i,
  );
  if (!match?.[1]) return null;
  const words: string[] = [];
  for (const word of match[1].trim().split(/\s+/)) {
    if (NAME_STOP_WORDS.has(word.toLowerCase())) break;
    words.push(word);
    if (words.length === 3) break;
  }
  const name = words.join(" ").replace(/[.,!?;:]+$/, "");
  if (name.length < 2 || name.length > 60) return null;
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isSafeMemoryCandidate(candidate: MemoryCandidate) {
  if (candidate.action === "none") return false;
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0.9) return false;
  if (
    !Number.isInteger(candidate.importance) ||
    candidate.importance < 3 ||
    candidate.importance > 5
  )
    return false;
  if (!candidate.content.trim() || candidate.content.length > 1000) return false;
  if (!candidate.reason.trim() || looksSensitive(candidate.content)) return false;
  if (candidate.action === "profile_update") {
    return PROFILE_MEMORY_TYPES.has(candidate.memory_type) && candidate.confidence >= 0.95;
  }
  return AUTOMATIC_MEMORY_TYPES.has(candidate.memory_type) && candidate.title.trim().length > 0;
}

function profileUpdateForCandidate(candidate: MemoryCandidate): Partial<Profile> | null {
  const content = candidate.content.trim();
  if (!content) return null;
  if (candidate.memory_type === "profile_name" && content.length <= 60)
    return { display_name: content };
  if (candidate.memory_type === "profile_assistant_name" && content.length <= 60)
    return { assistant_name: content };
  if (candidate.memory_type === "profile_timezone" && content.length <= 100)
    return { timezone: content };
  if (candidate.memory_type === "profile_summary" && content.length <= 1000)
    return { profile_summary: content };
  return null;
}

function buildMemoryBlock(
  memories: Array<{
    title: string | null;
    content: string;
    importance: number;
    memory_type: string;
  }>,
) {
  const maxCharacters = 6000;
  const lines: string[] = [];
  let length = 0;
  for (const memory of memories) {
    const fullLine = `- [${memory.memory_type.toUpperCase()} | importance ${memory.importance}] ${
      memory.title ? `${memory.title}: ` : ""
    }${memory.content}`;
    const remaining = maxCharacters - length - 1;
    if (remaining <= 0) break;
    const line = fullLine.slice(0, remaining);
    lines.push(line);
    length += line.length + 1;
    if (line.length < fullLine.length) break;
  }
  return lines.join("\n");
}

function getResponseText(payload: {
  output_text?: string;
  output?: { content?: { type?: string; text?: string }[] }[];
}) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((content) => content?.type === "output_text")
    .map((content) => content.text ?? "")
    .join("")
    .trim();
}

async function getOrCreateMainConversation(supabase: any, userId: string) {
  const { data: existing, error: existingError } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("channel", "main")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing as { id: string; metadata: unknown };

  const { data: latest, error: latestError } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("channel", "app")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  if (latest) {
    const metadata = { ...safeObject(latest.metadata), primary: true };
    const { data: promoted, error: promoteError } = await supabase
      .from("conversations")
      .update({ channel: "main", title: "Emery", metadata, updated_at: new Date().toISOString() })
      .eq("id", latest.id)
      .eq("user_id", userId)
      .select("id, metadata")
      .single();
    if (promoteError) throw promoteError;
    return promoted as { id: string; metadata: unknown };
  }

  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert({ user_id: userId, channel: "main", title: "Emery", metadata: { primary: true } })
    .select("id, metadata")
    .single();
  if (createError || !created) throw createError ?? new Error("Could not create main conversation");
  return created as { id: string; metadata: unknown };
}

async function setPendingAction(
  supabase: any,
  userId: string,
  conversationId: string,
  currentMetadata: unknown,
  pending: PendingAction,
) {
  const metadata = { ...safeObject(currentMetadata) };
  if (pending) metadata["pending_action"] = pending;
  else delete metadata["pending_action"];
  const { error } = await supabase
    .from("conversations")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
  return metadata;
}

function readPendingAction(metadata: unknown): PendingAction {
  const pending = safeObject(metadata)["pending_action"];
  if (!pending || typeof pending !== "object" || Array.isArray(pending)) return null;
  return pending as ActionCandidate;
}

async function loadActionContext(supabase: any, userId: string): Promise<ActionContext> {
  const now = new Date().toISOString();
  const [tasksResult, projectsResult, meetingsResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, details, status, priority, due_at, metadata, project_id")
      .eq("user_id", userId)
      .neq("status", "completed")
      .order("priority", { ascending: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(15),
    supabase
      .from("projects")
      .select("id, name, description, status, priority, goal, next_action")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(10),
    supabase
      .from("meetings")
      .select("id, title, meeting_at, participants, metadata")
      .eq("user_id", userId)
      .gte("meeting_at", now)
      .order("meeting_at", { ascending: true })
      .limit(10),
  ]);

  return {
    tasks: tasksResult.data ?? [],
    projects: projectsResult.data ?? [],
    meetings: meetingsResult.data ?? [],
  };
}

function buildActionContextBlock(context: ActionContext) {
  const maxCharacters = 7000;
  const projectNames = new Map(context.projects.map((project) => [project.id, project.name]));
  const lines: string[] = ["OPEN TASKS:"];
  for (const task of context.tasks) {
    lines.push(
      `- TASK ${task.id}: ${task.title} | priority ${task.priority} | due ${task.due_at ?? "none"} | project ${task.project_id ? `${projectNames.get(task.project_id) ?? "unknown"} (${task.project_id})` : "none"} | status ${task.status}${task.details ? ` | details ${task.details.slice(0, 240)}` : ""}`,
    );
  }
  if (!context.tasks.length) lines.push("- none");
  lines.push("ACTIVE PROJECTS:");
  for (const project of context.projects) {
    lines.push(
      `- PROJECT ${project.id}: ${project.name} | priority ${project.priority} | status ${project.status} | goal ${project.goal ?? "none"} | next ${project.next_action ?? "none"}${project.description ? ` | context ${project.description.slice(0, 280)}` : ""}`,
    );
  }
  if (!context.projects.length) lines.push("- none");
  lines.push("UPCOMING MEETINGS:");
  for (const meeting of context.meetings) {
    lines.push(
      `- MEETING ${meeting.id}: ${meeting.title ?? "Untitled"} | at ${meeting.meeting_at ?? "unknown"} | project ${typeof safeObject(meeting.metadata)["project_id"] === "string" ? `${projectNames.get(String(safeObject(meeting.metadata)["project_id"])) ?? "unknown"} (${String(safeObject(meeting.metadata)["project_id"])})` : "none"} | participants ${JSON.stringify(meeting.participants ?? [])}`,
    );
  }
  if (!context.meetings.length) lines.push("- none");
  let output = lines.join("\n");
  if (output.length > maxCharacters)
    output = `${output.slice(0, maxCharacters)}\n- context truncated to stay bounded`;
  return output;
}

async function loadRecentHistory(
  supabase: any,
  userId: string,
  conversationId: string,
): Promise<Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: string }>> {
  const { data: rows } = await supabase
    .from("conversation_messages")
    .select("id, role, content, created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(32);
  return (rows ?? [])
    .reverse()
    .filter((row: any) => row.role === "user" || row.role === "assistant")
    .map((row: any) => ({
      id: row.id as string,
      role: row.role as "user" | "assistant",
      text: row.content as string,
      createdAt: row.created_at as string,
    }));
}

async function signAttachments(supabase: any, rows: any[]): Promise<ChatAttachment[]> {
  return Promise.all(
    rows.map(async (row) => {
      const { data } = await supabase.storage
        .from("emery-attachments")
        .createSignedUrl(row.storage_path, 600);
      return {
        id: row.id as string,
        fileName: row.file_name as string,
        mimeType: row.mime_type as string,
        sizeBytes: Number(row.size_bytes ?? 0),
        url: data?.signedUrl ?? null,
      };
    }),
  );
}

export const getMainConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const db = supabase as any;
    const conversation = await getOrCreateMainConversation(db, userId);
    const { data: rows, error } = await db
      .from("conversation_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;

    const messageIds = (rows ?? []).map((row: any) => row.id);
    const { data: attachmentRows } = messageIds.length
      ? await db
          .from("message_attachments")
          .select("id, message_id, storage_path, file_name, mime_type, size_bytes")
          .eq("user_id", userId)
          .eq("conversation_id", conversation.id)
          .in("message_id", messageIds)
          .order("created_at", { ascending: true })
      : { data: [] };

    const byMessage = new Map<string, ChatAttachment[]>();
    for (const row of attachmentRows ?? []) {
      const signed = await signAttachments(db, [row]);
      const list = byMessage.get(row.message_id) ?? [];
      list.push(...signed);
      byMessage.set(row.message_id, list);
    }

    const messages: StoredMessage[] = (rows ?? [])
      .filter((row: any) => row.role === "user" || row.role === "assistant")
      .map((row: any) => ({
        id: row.id,
        role: row.role,
        text: row.content,
        createdAt: row.created_at,
        attachments: byMessage.get(row.id) ?? [],
      }));

    return { conversationId: conversation.id, messages };
  });

function isActionCandidate(value: unknown): value is ActionCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActionCandidate>;
  const actions: ActionKind[] = [
    "none",
    "propose_task",
    "create_task",
    "complete_task",
    "propose_project",
    "create_project",
    "update_project",
    "propose_meeting",
    "create_meeting",
  ];
  return (
    actions.includes(candidate.action as ActionKind) &&
    typeof candidate.confidence === "number" &&
    (typeof candidate.target_id === "string" || candidate.target_id === null) &&
    typeof candidate.title === "string" &&
    typeof candidate.details === "string" &&
    (typeof candidate.priority === "number" || candidate.priority === null) &&
    (typeof candidate.due_at === "string" || candidate.due_at === null) &&
    typeof candidate.due_date_only === "boolean" &&
    (typeof candidate.meeting_at === "string" || candidate.meeting_at === null) &&
    Array.isArray(candidate.participants) &&
    candidate.participants.every((item) => typeof item === "string") &&
    typeof candidate.goal === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.next_action === "string" &&
    typeof candidate.project_status === "string" &&
    typeof candidate.needs_confirmation === "boolean" &&
    typeof candidate.question === "string" &&
    typeof candidate.cancel_pending === "boolean" &&
    typeof candidate.reason === "string"
  );
}

function isMemoryCandidate(value: unknown): value is MemoryCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemoryCandidate>;
  return (
    ["create", "update", "profile_update", "none"].includes(candidate.action ?? "") &&
    typeof candidate.memory_type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.importance === "number" &&
    typeof candidate.confidence === "number" &&
    typeof candidate.reason === "string" &&
    (typeof candidate.target_memory_id === "string" || candidate.target_memory_id === null)
  );
}

async function analyzeTurn(
  apiKey: string,
  message: string,
  nowIso: string,
  profile: Profile | null,
  pendingAction: PendingAction,
  actionContext: ActionContext,
  recentHistory: Array<{ role: "user" | "assistant"; text: string }>,
  rollingSummary: string,
  existingMemories: ExistingMemory[],
): Promise<TurnAnalysis> {
  const emptyAction: ActionCandidate = {
    action: "none",
    confidence: 1,
    target_id: null,
    title: "",
    details: "",
    priority: null,
    due_at: null,
    due_date_only: false,
    meeting_at: null,
    participants: [],
    goal: "",
    description: "",
    next_action: "",
    project_status: "",
    needs_confirmation: false,
    question: "",
    cancel_pending: false,
    reason: "No action",
  };

  if (!message.trim() && !pendingAction) return { action: emptyAction, memories: [] };

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
          content:
            "You are Emery's private control-plane parser. Analyze the newest user turn for actionable intent and durable memory. Do not answer the user. ACTION RULES: casual mentions of tasks/meetings/projects should usually PROPOSE and require confirmation; direct commands like add/create/save/schedule are already permission and should CREATE when required fields are available. A short approval like yes/9am/Friday/high priority should apply to PENDING ACTION. Use the rolling conversation state and recent history to resolve short follow-ups like “do that”, “the first one”, or “what about the other one” when there is one clear referent. If two or more targets remain plausible, ask one concise clarification instead of guessing. A clear never mind/cancel sets cancel_pending=true. For complete_task/update_project, target_id MUST be an exact ID supplied in CURRENT ACTION CONTEXT; never invent IDs. Tasks do not require an exact time. Meetings require a usable date/time; if missing, preserve as proposal/pending and put one short clarification question in question. Use CURRENT_TIME and PROFILE timezone for relative dates. Return due_at/meeting_at as ISO-8601 timestamps with offsets when known. For a task with a date but no time, due_date_only=true and choose a neutral local timestamp for storage; the UI will hide the artificial time. MEMORY RULES: extract only durable explicitly user-stated personal context. Return none for temporary plans, tasks, meetings, casual chat, one-off questions, speculation, assumptions, assistant ideas, or secrets. Durable types: goal, preference, relationship, routine, responsibility, working_preference, decision, constraint, project_context. profile_update only for name, assistant name, timezone, or stable profile summary. update only for a clear correction using an exact existing memory ID. Confidence >=0.9 only when explicit. Never store action items as long-term memory just because they are actionable.",
        },
        {
          role: "user",
          content: JSON.stringify({
            current_time: nowIso,
            profile: profile ?? {},
            pending_action: pendingAction,
            current_action_context: actionContext,
            recent_history: recentHistory.slice(-10),
            rolling_conversation_state: rollingSummary,
            existing_memories: existingMemories.slice(0, 24),
            newest_message: message,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "emery_turn_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              action: {
                type: "object",
                additionalProperties: false,
                properties: {
                  action: {
                    type: "string",
                    enum: [
                      "none",
                      "propose_task",
                      "create_task",
                      "complete_task",
                      "propose_project",
                      "create_project",
                      "update_project",
                      "propose_meeting",
                      "create_meeting",
                    ],
                  },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  target_id: { type: ["string", "null"] },
                  title: { type: "string" },
                  details: { type: "string" },
                  priority: { type: ["integer", "null"], minimum: 1, maximum: 5 },
                  due_at: { type: ["string", "null"] },
                  due_date_only: { type: "boolean" },
                  meeting_at: { type: ["string", "null"] },
                  participants: { type: "array", items: { type: "string" }, maxItems: 20 },
                  goal: { type: "string" },
                  description: { type: "string" },
                  next_action: { type: "string" },
                  project_status: { type: "string" },
                  needs_confirmation: { type: "boolean" },
                  question: { type: "string" },
                  cancel_pending: { type: "boolean" },
                  reason: { type: "string" },
                },
                required: [
                  "action",
                  "confidence",
                  "target_id",
                  "title",
                  "details",
                  "priority",
                  "due_at",
                  "due_date_only",
                  "meeting_at",
                  "participants",
                  "goal",
                  "description",
                  "next_action",
                  "project_status",
                  "needs_confirmation",
                  "question",
                  "cancel_pending",
                  "reason",
                ],
              },
              memories: {
                type: "array",
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    action: {
                      type: "string",
                      enum: ["create", "update", "profile_update", "none"],
                    },
                    memory_type: { type: "string" },
                    title: { type: "string" },
                    content: { type: "string" },
                    importance: { type: "integer", minimum: 1, maximum: 5 },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    reason: { type: "string" },
                    target_memory_id: { type: ["string", "null"] },
                  },
                  required: [
                    "action",
                    "memory_type",
                    "title",
                    "content",
                    "importance",
                    "confidence",
                    "reason",
                    "target_memory_id",
                  ],
                },
              },
            },
            required: ["action", "memories"],
          },
        },
      },
    }),
  });

  if (!response.ok) throw new Error(`Turn analysis failed with ${response.status}`);
  const payload = (await response.json()) as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
  const text = getResponseText(payload);
  const parsed = JSON.parse(text) as { action?: unknown; memories?: unknown };
  return {
    action: isActionCandidate(parsed.action) ? parsed.action : emptyAction,
    memories: Array.isArray(parsed.memories) ? parsed.memories.filter(isMemoryCandidate) : [],
  };
}

function mergePending(action: ActionCandidate, pending: PendingAction): ActionCandidate {
  if (!pending || action.action === "none") return action;
  const sameDomain =
    (action.action.includes("task") && pending.action.includes("task")) ||
    (action.action.includes("project") && pending.action.includes("project")) ||
    (action.action.includes("meeting") && pending.action.includes("meeting"));
  if (!sameDomain) return action;
  return {
    ...action,
    target_id: action.target_id ?? pending.target_id,
    title: action.title || pending.title,
    details: action.details || pending.details,
    priority: action.priority ?? pending.priority,
    due_at: action.due_at ?? pending.due_at,
    due_date_only: action.due_date_only || pending.due_date_only,
    meeting_at: action.meeting_at ?? pending.meeting_at,
    participants: action.participants.length ? action.participants : pending.participants,
    goal: action.goal || pending.goal,
    description: action.description || pending.description,
    next_action: action.next_action || pending.next_action,
    project_status: action.project_status || pending.project_status,
  };
}

async function applyAction(
  supabase: any,
  userId: string,
  conversation: { id: string; metadata: unknown },
  rawAction: ActionCandidate,
  pending: PendingAction,
  actionContext: ActionContext,
  sourceRef: string,
) {
  const action = mergePending(rawAction, pending);
  let metadata = conversation.metadata;

  if (action.cancel_pending) {
    metadata = await setPendingAction(supabase, userId, conversation.id, metadata, null);
    return {
      instruction:
        "Adam cancelled the pending action. Acknowledge briefly if useful; do not create anything.",
      metadata,
    };
  }

  if (action.confidence < 0.86 || action.action === "none") {
    return { instruction: "No action write occurred.", metadata };
  }

  if (
    action.action === "propose_task" ||
    action.action === "propose_project" ||
    action.action === "propose_meeting"
  ) {
    metadata = await setPendingAction(supabase, userId, conversation.id, metadata, action);
    const domain = action.action.replace("propose_", "");
    const fallback =
      domain === "task"
        ? `Ask one brief natural question: Want me to add ${action.title || "that"} as a task?`
        : domain === "meeting"
          ? `Ask one brief natural question about saving ${action.title || "that"} to Emery's Meetings.`
          : `Ask one brief natural question about creating ${action.title || "that"} as a project.`;
    return {
      instruction: action.question
        ? `Ask only this needed question naturally: ${action.question}`
        : action.needs_confirmation
          ? fallback
          : fallback,
      metadata,
    };
  }

  if (action.action === "create_task") {
    if (!action.title.trim()) {
      metadata = await setPendingAction(supabase, userId, conversation.id, metadata, action);
      return { instruction: "Ask Adam for the task title in one short question.", metadata };
    }
    const taskMetadata = action.due_date_only ? { due_date_only: true } : {};
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title: action.title.trim(),
        details: action.details.trim() || null,
        priority: action.priority ?? 3,
        due_at: action.due_at,
        status: "inbox",
        source_type: "chat",
        source_ref: sourceRef,
        metadata: taskMetadata,
      })
      .select("id, title, priority, due_at")
      .single();
    if (error || !data) {
      return {
        instruction:
          "The task write failed. Tell Adam briefly that it could not be saved; do not claim success.",
        metadata,
      };
    }
    metadata = await setPendingAction(supabase, userId, conversation.id, metadata, null);
    return {
      instruction: `Task creation succeeded in Supabase. Confirm briefly and naturally. Task: ${data.title}. Due: ${data.due_at ?? "no due date"}. Priority: ${data.priority}.`,
      metadata,
    };
  }

  if (action.action === "complete_task") {
    const target = actionContext.tasks.find((task) => task.id === action.target_id);
    if (!target)
      return {
        instruction:
          "No uniquely verified open task matched. Ask one short clarification instead of guessing.",
        metadata,
      };
    const { error } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", target.id)
      .eq("user_id", userId);
    if (error)
      return {
        instruction:
          "The task could not be marked complete. Say so briefly and do not claim success.",
        metadata,
      };
    return {
      instruction: `Task completion succeeded. Briefly confirm that ${target.title} is done.`,
      metadata,
    };
  }

  if (action.action === "create_project") {
    if (!action.title.trim()) {
      metadata = await setPendingAction(supabase, userId, conversation.id, metadata, action);
      return { instruction: "Ask Adam for the project name in one short question.", metadata };
    }
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: action.title.trim(),
        description: action.description.trim() || action.details.trim() || null,
        goal: action.goal.trim() || null,
        next_action: action.next_action.trim() || null,
        priority: action.priority ?? 3,
        status: action.project_status.trim() || "active",
      })
      .select("id, name")
      .single();
    if (error || !data)
      return {
        instruction: "The project could not be saved. Say so briefly and do not claim success.",
        metadata,
      };
    metadata = await setPendingAction(supabase, userId, conversation.id, metadata, null);
    return {
      instruction: `Project creation succeeded. Confirm briefly: ${data.name} is now an active project.`,
      metadata,
    };
  }

  if (action.action === "update_project") {
    const target = actionContext.projects.find((project) => project.id === action.target_id);
    if (!target)
      return {
        instruction:
          "No uniquely verified project matched. Ask one short clarification instead of guessing.",
        metadata,
      };
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action.description.trim()) updates["description"] = action.description.trim();
    if (action.goal.trim()) updates["goal"] = action.goal.trim();
    if (action.next_action.trim()) updates["next_action"] = action.next_action.trim();
    if (action.project_status.trim()) updates["status"] = action.project_status.trim();
    if (action.priority !== null) updates["priority"] = action.priority;
    const { error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", target.id)
      .eq("user_id", userId);
    if (error)
      return {
        instruction: "The project update failed. Say so briefly and do not claim success.",
        metadata,
      };
    return {
      instruction: `Project update succeeded for ${target.name}. Confirm only the change that Adam asked for.`,
      metadata,
    };
  }

  if (action.action === "create_meeting") {
    if (!action.title.trim() || !action.meeting_at) {
      metadata = await setPendingAction(supabase, userId, conversation.id, metadata, action);
      return {
        instruction: action.question
          ? `Ask only this clarification naturally: ${action.question}`
          : "Ask one short question for the missing meeting title/date/time. Do not claim it was saved.",
        metadata,
      };
    }
    const { data, error } = await supabase
      .from("meetings")
      .insert({
        user_id: userId,
        title: action.title.trim(),
        meeting_at: action.meeting_at,
        participants: action.participants,
        metadata: { source_type: "chat", source_ref: sourceRef },
      })
      .select("id, title, meeting_at")
      .single();
    if (error || !data)
      return {
        instruction: "The meeting could not be saved. Say so briefly and do not claim success.",
        metadata,
      };
    metadata = await setPendingAction(supabase, userId, conversation.id, metadata, null);
    return {
      instruction: `Meeting creation succeeded in Emery's internal Meetings system. Confirm briefly: ${data.title} at ${data.meeting_at}. Do not claim external calendar sync.`,
      metadata,
    };
  }

  return { instruction: "No action write occurred.", metadata };
}

async function applyMemoryCandidates(
  supabase: any,
  userId: string,
  message: string,
  candidates: MemoryCandidate[],
  existingMemories: ExistingMemory[],
) {
  for (const candidate of candidates.slice(0, 3)) {
    if (!isSafeMemoryCandidate(candidate)) continue;
    if (candidate.action === "profile_update") {
      const update = profileUpdateForCandidate(candidate);
      if (!update) continue;
      await supabase
        .from("profiles")
        .upsert({ user_id: userId, ...update }, { onConflict: "user_id" });
      continue;
    }
    if (candidate.action === "update") {
      if (!isClearCorrection(message) || !candidate.target_memory_id) continue;
      const target = existingMemories.find((memory) => memory.id === candidate.target_memory_id);
      if (!target) continue;
      await supabase
        .from("memories")
        .update({
          memory_type: candidate.memory_type,
          title: candidate.title,
          content: candidate.content,
          importance: candidate.importance,
          confidence: candidate.confidence,
          source_type: "chat_auto",
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id)
        .eq("user_id", userId);
      continue;
    }
    if (candidate.action === "create") {
      if (isClearCorrection(message)) continue;
      const duplicate = existingMemories.some(
        (memory) => normalize(memory.content) === normalize(candidate.content),
      );
      if (duplicate) continue;
      await supabase.from("memories").insert({
        user_id: userId,
        memory_type: candidate.memory_type,
        title: candidate.title,
        content: candidate.content,
        importance: candidate.importance,
        confidence: candidate.confidence,
        source_type: "chat_auto",
      });
    }
  }
}

export const sendEmeryMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ChatInput) => {
    const message = typeof input?.message === "string" ? input.message.trim() : "";
    const attachments = Array.isArray(input?.attachments) ? input.attachments.slice(0, 5) : [];
    if (!message && attachments.length === 0) throw new Error("Message or attachment is required");
    if (message.length > 8000) throw new Error("Message is too long");
    for (const attachment of attachments) {
      if (
        !attachment ||
        typeof attachment.storagePath !== "string" ||
        typeof attachment.fileName !== "string" ||
        typeof attachment.mimeType !== "string" ||
        typeof attachment.sizeBytes !== "number"
      ) {
        throw new Error("Invalid attachment metadata");
      }
      if (attachment.sizeBytes < 0 || attachment.sizeBytes > 26214400)
        throw new Error("Attachment is too large");
    }
    return { message, attachments };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The AI service isn't configured yet." } as const;
    const { supabase, userId } = context;
    const db = supabase as any;

    let agentTeamInstruction = "";
    const explicitAgentCreation = isExplicitAgentCreationCommand(data.message);
    if (explicitAgentCreation) {
      try {
        const createdAgent = await createAgentFromInstruction(apiKey, db, userId, data.message);
        agentTeamInstruction += `Agent creation succeeded. ${createdAgent.name} is now part of Emery's agent family. Its mission is: ${createdAgent.mission}`;
      } catch (error) {
        console.error("Agent creation from main chat failed", error);
        agentTeamInstruction +=
          "Adam explicitly asked to create an agent, but the database write failed. Say so briefly and do not claim success.";
      }
    }

    const consultMatch = data.message.match(
      /\b(?:ask|consult|check\s+with|bring\s+in|have)\s+(?:the\s+)?(hpo|research|strategy)(?:\s+agent)?\b/i,
    );
    if (consultMatch?.[1]) {
      const slugMap = {
        hpo: "hpo-agent",
        research: "research-agent",
        strategy: "strategy-agent",
      } as const;
      const key = consultMatch[1].toLowerCase() as keyof typeof slugMap;
      try {
        const consultation = await consultSpecialistFromEmery(
          apiKey,
          db,
          userId,
          slugMap[key],
          data.message,
        );
        agentTeamInstruction += `${agentTeamInstruction ? "\n" : ""}Emery consulted ${consultation.agentName} from the main conversation. Use this specialist report as an input, challenge it if needed, and give Adam one coherent Emery answer:
${consultation.response}`;
      } catch (error) {
        console.error("Agent consultation from main chat failed", error);
        agentTeamInstruction += `${agentTeamInstruction ? "\n" : ""}A requested specialist consultation failed. Tell Adam briefly if relevant; do not pretend the agent responded.`;
      }
    }

    if (!consultMatch?.[1] && !explicitAgentCreation) {
      const routedSpecialist = routeMainSpecialist(data.message);
      if (routedSpecialist) {
        try {
          const consultation = await consultSpecialistFromEmery(
            apiKey,
            db,
            userId,
            routedSpecialist,
            data.message,
          );
          agentTeamInstruction += `${agentTeamInstruction ? "\n" : ""}Emery conservatively routed this turn to ${consultation.agentName} because the request clearly matched that specialty. Use the report only if it improves the answer; Emery remains responsible for the final recommendation:
${consultation.response}`;
        } catch (error) {
          console.error("Routed specialist consultation failed", error);
        }
      }
    }

    let conversation: { id: string; metadata: unknown };
    try {
      conversation = await getOrCreateMainConversation(db, userId);
    } catch (error) {
      console.error("Main conversation create/load failed", error);
      return { error: "Couldn't open your Emery conversation. Please try again." } as const;
    }

    for (const attachment of data.attachments) {
      if (!attachment.storagePath.startsWith(`${userId}/`)) {
        return { error: "One of those attachments doesn't belong to your account." } as const;
      }
    }

    const storedUserText = data.message;
    const { data: userMessage, error: userMessageError } = await db
      .from("conversation_messages")
      .insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: storedUserText,
      })
      .select("id, created_at")
      .single();
    if (userMessageError || !userMessage) {
      console.error("User message save failed", userMessageError?.message);
      return { error: "Couldn't save your message. Please try again." } as const;
    }

    if (data.attachments.length) {
      const rows = data.attachments.map((attachment) => ({
        user_id: userId,
        conversation_id: conversation.id,
        message_id: userMessage.id,
        storage_path: attachment.storagePath,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
      }));
      const { error } = await db.from("message_attachments").insert(rows);
      if (error) {
        console.error("Attachment metadata save failed", error.message);
        return {
          error: "Your message was saved, but the attachment couldn't be linked. Please try again.",
        } as const;
      }
    }

    let hpoTurn: HpoTurnResult = {
      isHpo: false,
      accountId: null,
      accountName: null,
      suppressGenericAction: false,
      instruction: "No HPO-specific write or routing occurred.",
      context: null,
      metadata: conversation.metadata,
    };
    if (data.message) {
      try {
        hpoTurn = await processHpoTurn({
          apiKey,
          db,
          userId,
          conversationId: conversation.id,
          conversationMetadata: conversation.metadata,
          message: data.message,
          sourceRef: userMessage.id,
        });
        conversation.metadata = hpoTurn.metadata;
      } catch (error) {
        console.error("HPO routing failed", error);
        hpoTurn.instruction =
          "HPO routing failed for this turn. Do not claim an HPO write occurred.";
      }
    }

    const statedName = extractName(data.message);
    if (statedName) {
      await db
        .from("profiles")
        .upsert({ user_id: userId, display_name: statedName }, { onConflict: "user_id" });
    }

    const { data: initialProfile } = await db
      .from("profiles")
      .select("display_name, assistant_name, timezone, profile_summary")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: existingRows } = await db
      .from("memories")
      .select("id, title, content, memory_type, importance, confidence, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    const existingMemories: ExistingMemory[] = existingRows ?? [];

    let savedMemory: string | null = null;
    const explicitFact = extractExplicitMemory(data.message);
    if (explicitFact) {
      if ((statedName || extractName(explicitFact)) && isAboutOwnName(explicitFact)) {
        const name = statedName ?? extractName(explicitFact);
        if (name) {
          await db
            .from("profiles")
            .upsert({ user_id: userId, display_name: name }, { onConflict: "user_id" });
          savedMemory = `Adam's name is ${name}`;
        }
      } else {
        const duplicate = existingMemories.some(
          (memory) => normalize(memory.content) === normalize(explicitFact),
        );
        if (!duplicate) {
          const { error } = await db.from("memories").insert({
            user_id: userId,
            memory_type: "core",
            title: makeTitle(explicitFact),
            content: explicitFact,
            importance: 4,
            confidence: 1,
            source_type: "chat",
          });
          if (!error) savedMemory = explicitFact;
        } else savedMemory = explicitFact;
      }
    }

    const recentHistory = await loadRecentHistory(db, userId, conversation.id);
    let conversationState = readConversationState(conversation.metadata);
    try {
      conversationState = await refreshRollingConversationState({
        apiKey,
        db,
        userId,
        conversation,
        newestMessage: data.message,
        recentHistory,
      });
    } catch (error) {
      console.error("Rolling conversation state refresh failed", error);
    }
    const relevantMemoriesForAnalysis = selectRelevantMemories(
      existingMemories,
      data.message,
      recentHistory,
      { maxItems: 20, maxCharacters: 7000 },
    );
    const pendingAction = readPendingAction(conversation.metadata);
    const actionContextBefore = await loadActionContext(db, userId);

    let analysis: TurnAnalysis = {
      action: {
        action: "none",
        confidence: 1,
        target_id: null,
        title: "",
        details: "",
        priority: null,
        due_at: null,
        due_date_only: false,
        meeting_at: null,
        participants: [],
        goal: "",
        description: "",
        next_action: "",
        project_status: "",
        needs_confirmation: false,
        question: "",
        cancel_pending: false,
        reason: "No action",
      },
      memories: [],
    };

    try {
      analysis = await analyzeTurn(
        apiKey,
        data.message,
        new Date().toISOString(),
        initialProfile as Profile | null,
        pendingAction,
        actionContextBefore,
        recentHistory.slice(-10),
        conversationState.summary,
        relevantMemoriesForAnalysis as ExistingMemory[],
      );
    } catch (error) {
      console.error("Emery control-plane analysis failed", error);
    }

    if (hpoTurn.suppressGenericAction) {
      analysis.action = {
        ...analysis.action,
        action: "none",
        confidence: 1,
        needs_confirmation: false,
        question: "",
        cancel_pending: false,
      };
    }

    if (!explicitFact && !looksSensitive(data.message)) {
      await applyMemoryCandidates(db, userId, data.message, analysis.memories, existingMemories);
    }

    let actionInstruction = "No action write occurred.";
    try {
      const actionResult = await applyAction(
        db,
        userId,
        conversation,
        analysis.action,
        pendingAction,
        actionContextBefore,
        userMessage.id,
      );
      actionInstruction = actionResult.instruction;
      conversation.metadata = actionResult.metadata;
    } catch (error) {
      console.error("Action application failed", error);
      actionInstruction =
        "An attempted action failed. Tell Adam briefly that it could not be saved and do not claim success.";
    }

    if (hpoTurn.isHpo) {
      const hpoTag: Record<string, unknown> = { domain: "hpo", hpo: true };
      if (hpoTurn.accountId) hpoTag["hpo_account_id"] = hpoTurn.accountId;
      if (hpoTurn.accountName) hpoTag["hpo_account_name"] = hpoTurn.accountName;
      try {
        const { data: createdTasks } = await db
          .from("tasks")
          .select("id, metadata")
          .eq("user_id", userId)
          .eq("source_ref", userMessage.id);
        for (const task of createdTasks ?? []) {
          await db
            .from("tasks")
            .update({ metadata: { ...safeObject(task.metadata), ...hpoTag } })
            .eq("id", task.id)
            .eq("user_id", userId);
        }
        const { data: createdMeetings } = await db
          .from("meetings")
          .select("id, metadata")
          .eq("user_id", userId)
          .contains("metadata", { source_ref: userMessage.id });
        for (const meeting of createdMeetings ?? []) {
          await db
            .from("meetings")
            .update({ metadata: { ...safeObject(meeting.metadata), ...hpoTag } })
            .eq("id", meeting.id)
            .eq("user_id", userId);
        }
      } catch (error) {
        console.error("HPO task/meeting tagging failed", error);
      }
    }

    const [{ data: profile }, { data: memories }, actionContextAfter] = await Promise.all([
      db
        .from("profiles")
        .select("display_name, assistant_name, timezone, profile_summary")
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("memories")
        .select(
          "id, title, content, memory_type, importance, confidence, created_at, updated_at, expires_at",
        )
        .eq("user_id", userId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
      loadActionContext(db, userId),
    ]);

    const profileLines = profile
      ? [
          profile.display_name ? `Name: ${profile.display_name}` : null,
          profile.assistant_name ? `Assistant name: ${profile.assistant_name}` : null,
          profile.timezone ? `Timezone: ${profile.timezone}` : null,
          profile.profile_summary ? `About: ${profile.profile_summary}` : null,
        ].filter(Boolean)
      : [];
    const promptMemories = memories?.length
      ? selectRelevantMemories(memories, data.message, recentHistory, {
          maxItems: 16,
          maxCharacters: 6500,
        })
      : [];
    const memoryBlock = promptMemories.length ? buildMemoryBlock(promptMemories) : "";
    const actionBlock = buildActionContextBlock(actionContextAfter);
    const focusBlock = buildExecutiveFocus(actionContextAfter);
    const hpoContextBlock = hpoTurn.context ? JSON.stringify(hpoTurn.context).slice(0, 12000) : "";

    const attachmentRows = data.attachments.length
      ? await db
          .from("message_attachments")
          .select("id, storage_path, file_name, mime_type, size_bytes")
          .eq("user_id", userId)
          .eq("message_id", userMessage.id)
      : { data: [] };
    const signedCurrentAttachments = await signAttachments(db, attachmentRows.data ?? []);

    const userContent: any[] = [];
    userContent.push({
      type: "input_text",
      text: data.message || "Please review the attached file or image and help me with it.",
    });
    for (const attachment of signedCurrentAttachments) {
      if (!attachment.url) continue;
      if (attachment.mimeType.startsWith("image/")) {
        userContent.push({ type: "input_image", image_url: attachment.url });
      } else {
        userContent.push({ type: "input_file", file_url: attachment.url });
      }
    }

    const previousHistory = recentHistory.filter((turn) => turn.id !== userMessage.id).slice(-24);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
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
              content:
                ASSISTANT_IDENTITY +
                `\n\nACTION CONTROL FOR THIS TURN:\n${actionInstruction}\nFollow this control instruction exactly. Do not claim any database action unless it says the action succeeded.` +
                `\n\nHPO WORK CONTROL FOR THIS TURN:\n${hpoTurn.instruction}\nTreat HPO as Adam's Hudson Pro career operating system. Route work context into HPO when appropriate, keep identifiable patient/case/medical information out of this work OS, and ask at most one concise clarification when the account or write intent is genuinely ambiguous.` +
                (hpoContextBlock
                  ? `\n\nHPO OPERATING CONTEXT (bounded non-PHI account/relationship intelligence):\n${hpoContextBlock}`
                  : "") +
                `\n\nAGENT TEAM CONTROL FOR THIS TURN:\n${agentTeamInstruction || "No agent was created or consulted on this turn."}\nTreat specialist reports as advisory input. Emery remains the final synthesizer for Adam.` +
                (savedMemory
                  ? `\n\nAdam explicitly asked you to remember this and it was saved: "${savedMemory}". Confirm briefly if relevant.`
                  : ""),
            },
            ...(profileLines.length
              ? [{ role: "system" as const, content: `CORE PROFILE:\n${profileLines.join("\n")}` }]
              : []),
            ...(memoryBlock
              ? [{ role: "system" as const, content: `LONG-TERM MEMORY:\n${memoryBlock}` }]
              : []),
            ...(conversationState.summary
              ? [
                  {
                    role: "system" as const,
                    content: `ROLLING CONVERSATION STATE (continuity only; prefer newer explicit user corrections):\n${conversationState.summary}`,
                  },
                ]
              : []),
            {
              role: "system" as const,
              content: `CURRENT ACTION CONTEXT:\n${actionBlock}\n\nQUIET EXECUTIVE FOCUS SIGNAL:\n${focusBlock}\nUse this focus signal only when relevant. If Adam is overloaded or asks what to do, reduce choices and lead with the highest-leverage next action. Do not turn casual chat into a dashboard. Call out overcomplication or tool-chasing only when the evidence supports it.`,
            },
            ...previousHistory.map((turn) => ({
              role: turn.role,
              content: [
                {
                  type: turn.role === "assistant" ? "output_text" : "input_text",
                  text: turn.text,
                },
              ],
            })),
            { role: "user", content: userContent },
          ],
        }),
      });
    } catch (error) {
      console.error("OpenAI response request failed", error);
      return { error: "Couldn't reach Emery's AI service. Please try again." } as const;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("OpenAI response failed", response.status, errorText.slice(0, 500));
      if (data.attachments.length) {
        return {
          error:
            "I saved your attachment, but I couldn't read that file with the AI service yet. Try an image, PDF, text, CSV, JSON, Word, or Excel file.",
        } as const;
      }
      return { error: "Emery couldn't answer right now. Please try again." } as const;
    }

    const payload = (await response.json()) as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    const reply = getResponseText(payload);
    if (!reply) return { error: "Emery returned an empty response." } as const;

    const { data: assistantMessage, error: assistantMessageError } = await db
      .from("conversation_messages")
      .insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "assistant",
        content: reply,
      })
      .select("id, created_at")
      .single();
    if (assistantMessageError)
      console.error("Assistant message save failed", assistantMessageError.message);

    return {
      reply,
      conversationId: conversation.id,
      userMessage: {
        id: userMessage.id,
        role: "user" as const,
        text: storedUserText,
        createdAt: userMessage.created_at,
        attachments: signedCurrentAttachments,
      },
      assistantMessage: assistantMessage
        ? {
            id: assistantMessage.id,
            role: "assistant" as const,
            text: reply,
            createdAt: assistantMessage.created_at,
            attachments: [] as ChatAttachment[],
          }
        : null,
    } as const;
  });

export const getMainConversationPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { before?: string | null; limit?: number } = {}) => ({
    before: input?.before ? String(input.before) : null,
    limit: Math.min(100, Math.max(20, Number(input?.limit ?? 80))),
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const conversation = await getOrCreateMainConversation(db, context.userId);
    let query = db
      .from("conversation_messages")
      .select("id, role, content, created_at")
      .eq("user_id", context.userId)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(data.limit + 1);
    if (data.before) query = query.lt("created_at", data.before);
    const { data: rows, error } = await query;
    if (error) throw error;
    const pageRows = (rows ?? []).slice(0, data.limit).reverse();
    const messageIds = pageRows.map((row: any) => row.id);
    const { data: attachmentRows } = messageIds.length
      ? await db
          .from("message_attachments")
          .select("id, message_id, storage_path, file_name, mime_type, size_bytes")
          .eq("user_id", context.userId)
          .eq("conversation_id", conversation.id)
          .in("message_id", messageIds)
          .order("created_at", { ascending: true })
      : { data: [] };
    const byMessage = new Map<string, ChatAttachment[]>();
    for (const row of attachmentRows ?? []) {
      const signed = await signAttachments(db, [row]);
      const list = byMessage.get(row.message_id) ?? [];
      list.push(...signed);
      byMessage.set(row.message_id, list);
    }
    const messages: StoredMessage[] = pageRows
      .filter((row: any) => row.role === "user" || row.role === "assistant")
      .map((row: any) => ({
        id: row.id,
        role: row.role,
        text: row.content,
        createdAt: row.created_at,
        attachments: byMessage.get(row.id) ?? [],
      }));
    return {
      conversationId: conversation.id,
      messages,
      hasMore: (rows ?? []).length > data.limit,
      nextBefore: messages.length ? (messages[0]?.createdAt ?? null) : null,
    };
  });

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, details, status, priority, due_at, completed_at, project_id, metadata, created_at",
      )
      .eq("user_id", userId)
      .order("completed_at", { ascending: false, nullsFirst: true })
      .order("priority", { ascending: false })
      .order("due_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return { tasks: data ?? [] };
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { title: string; details?: string; dueAt?: string | null; priority?: number }) => {
      const title = input?.title?.trim();
      if (!title) throw new Error("Task title is required");
      const priority = Math.min(5, Math.max(1, Number(input.priority ?? 3)));
      return {
        title,
        details: input.details?.trim() || null,
        dueAt: input.dueAt || null,
        priority,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title: data.title,
        details: data.details,
        due_at: data.dueAt,
        priority: data.priority,
        status: "inbox",
        source_type: "manual",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: task.id };
  });

export const setTaskCompleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; completed: boolean }) => ({
    id: String(input.id),
    completed: Boolean(input.completed),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("tasks")
      .update({
        status: data.completed ? "completed" : "inbox",
        completed_at: data.completed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, description, status, priority, goal, next_action, created_at, updated_at")
      .eq("user_id", userId)
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return { projects: data ?? [] };
  });

export const saveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string;
      name: string;
      description?: string;
      status?: string;
      priority?: number;
      goal?: string;
      nextAction?: string;
    }) => {
      const name = input?.name?.trim();
      if (!name) throw new Error("Project name is required");
      return {
        id: input.id ? String(input.id) : null,
        name,
        description: input.description?.trim() || null,
        status: input.status?.trim() || "active",
        priority: Math.min(5, Math.max(1, Number(input.priority ?? 3))),
        goal: input.goal?.trim() || null,
        nextAction: input.nextAction?.trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase
        .from("projects")
        .update({
          name: data.name,
          description: data.description,
          status: data.status,
          priority: data.priority,
          goal: data.goal,
          next_action: data.nextAction,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description,
        status: data.status,
        priority: data.priority,
        goal: data.goal,
        next_action: data.nextAction,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: project.id };
  });

export const listMeetings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("meetings")
      .select("id, title, meeting_at, participants, summary, created_at")
      .eq("user_id", userId)
      .order("meeting_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return { meetings: data ?? [] };
  });

export const createMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title: string; meetingAt: string; participants?: string[] }) => {
    const title = input?.title?.trim();
    if (!title) throw new Error("Meeting title is required");
    if (!input?.meetingAt || Number.isNaN(Date.parse(input.meetingAt)))
      throw new Error("Meeting date and time are required");
    return {
      title,
      meetingAt: input.meetingAt,
      participants: Array.isArray(input.participants)
        ? input.participants.map(String).filter(Boolean).slice(0, 20)
        : [],
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: meeting, error } = await supabase
      .from("meetings")
      .insert({
        user_id: userId,
        title: data.title,
        meeting_at: data.meetingAt,
        participants: data.participants,
        metadata: { source_type: "manual" },
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: meeting.id };
  });
