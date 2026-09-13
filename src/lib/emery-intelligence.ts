/* eslint-disable @typescript-eslint/no-explicit-any */

export type PromptMemory = {
  id?: string;
  title: string | null;
  content: string;
  memory_type: string;
  importance?: number;
  confidence?: number;
  created_at?: string;
  updated_at?: string;
};

export type RecentTurn = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
};

export type ConversationState = {
  summary: string;
  updatedAt: string | null;
  summarizedMessageId: string | null;
  summarizedMessageCount: number;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "really",
  "should",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

const ESSENTIAL_CORE =
  /\b(name|call me|assistant name|emery|communication style|response style|working style|preferred|preference)\b/i;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return [
    ...new Set(
      normalize(value)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
        .slice(0, 80),
    ),
  ];
}

function ageBoost(memory: PromptMemory) {
  const timestamp = Date.parse(memory.updated_at ?? memory.created_at ?? "");
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (ageDays <= 7) return 1.2;
  if (ageDays <= 30) return 0.7;
  if (ageDays <= 90) return 0.25;
  return 0;
}

function intentTypeBoost(memory: PromptMemory, query: string) {
  const type = memory.memory_type;
  if (/\b(goal|priority|focus|plan|next|progress)\b/i.test(query) && type === "goal") return 2;
  if (/\b(decide|decision|choose|tradeoff|constraint|limit|budget)\b/i.test(query)) {
    if (type === "decision" || type === "constraint") return 2;
  }
  if (/\b(work|job|hpo|business|project|task)\b/i.test(query)) {
    if (type === "responsibility" || type === "project_context" || type === "working_preference") {
      return 1.5;
    }
  }
  if (/\b(family|wife|husband|son|daughter|relationship|partner)\b/i.test(query)) {
    if (type === "relationship") return 1.8;
  }
  if (/\b(prefer|like|want|style|format|how should you)\b/i.test(query) && type === "preference") {
    return 1.8;
  }
  return 0;
}

function exactPhraseBoost(memory: PromptMemory, newestMessage: string) {
  const haystack = normalize(`${memory.title ?? ""} ${memory.content}`);
  const query = normalize(newestMessage);
  if (!query) return 0;
  const title = normalize(memory.title ?? "");
  if (title.length >= 5 && query.includes(title)) return 4;
  const meaningfulPhrases = query
    .split(" ")
    .filter((part) => part.length >= 4)
    .slice(0, 16);
  const consecutive = meaningfulPhrases.some((token, index) => {
    const next = meaningfulPhrases[index + 1];
    return next ? haystack.includes(`${token} ${next}`) : false;
  });
  return consecutive ? 2 : 0;
}

function memoryScore(
  memory: PromptMemory,
  queryTokens: string[],
  query: string,
  newestMessage: string,
) {
  const haystack = normalize(`${memory.title ?? ""} ${memory.content} ${memory.memory_type}`);
  const overlap = queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
  const importance = Number.isFinite(memory.importance) ? Number(memory.importance) : 3;
  const confidence = Number.isFinite(memory.confidence) ? Number(memory.confidence) : 0.9;
  const typeBoost = /^(goal|constraint|responsibility|relationship|working_preference)$/.test(
    memory.memory_type,
  )
    ? 0.8
    : 0;
  const relevantCore =
    memory.memory_type === "core" &&
    (ESSENTIAL_CORE.test(`${memory.title ?? ""} ${memory.content}`) || overlap > 0)
      ? 1.5
      : 0;
  return (
    overlap * 3 +
    importance * 0.65 +
    confidence * 0.8 +
    typeBoost +
    relevantCore +
    ageBoost(memory) +
    intentTypeBoost(memory, query) +
    exactPhraseBoost(memory, newestMessage)
  );
}

function nearDuplicate(a: PromptMemory, b: PromptMemory) {
  const left = normalize(a.content);
  const right = normalize(b.content);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) >= 24 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.82;
}

function newerFirst(a: PromptMemory, b: PromptMemory) {
  const aTime = Date.parse(a.updated_at ?? a.created_at ?? "") || 0;
  const bTime = Date.parse(b.updated_at ?? b.created_at ?? "") || 0;
  return bTime - aTime;
}

export function selectRelevantMemories(
  memories: PromptMemory[],
  newestMessage: string,
  recentHistory: RecentTurn[],
  options?: { maxItems?: number; maxCharacters?: number },
): Array<PromptMemory & { importance: number }> {
  const maxItems = options?.maxItems ?? 16;
  const maxCharacters = options?.maxCharacters ?? 6500;
  const query = [newestMessage, ...recentHistory.slice(-6).map((turn) => turn.text)].join(" ");
  const queryTokens = tokens(query);

  const essentialCore = memories
    .filter(
      (memory) =>
        memory.memory_type === "core" &&
        Number(memory.importance ?? 0) >= 4 &&
        ESSENTIAL_CORE.test(`${memory.title ?? ""} ${memory.content}`),
    )
    .sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0) || newerFirst(a, b))
    .slice(0, 2);

  const ranked = memories
    .filter((memory) => !essentialCore.includes(memory))
    .map((memory) => ({
      memory,
      score: memoryScore(memory, queryTokens, query, newestMessage),
    }))
    .filter(
      ({ score, memory }) => score >= 4.2 || (Number(memory.importance ?? 0) >= 5 && score >= 3),
    )
    .sort((a, b) => b.score - a.score || newerFirst(a.memory, b.memory))
    .map(({ memory }) => memory);

  const selected: Array<PromptMemory & { importance: number }> = [];
  const typeCounts = new Map<string, number>();
  let usedCharacters = 0;

  for (const memory of [...essentialCore, ...ranked]) {
    if (selected.length >= maxItems) break;
    if (selected.some((item) => item.id && item.id === memory.id)) continue;
    if (selected.some((item) => nearDuplicate(item, memory))) continue;
    const typeCount = typeCounts.get(memory.memory_type) ?? 0;
    if (typeCount >= 4 && memory.memory_type !== "core") continue;

    const size = `${memory.title ?? ""}${memory.content}${memory.memory_type}`.length + 24;
    if (selected.length > 0 && usedCharacters + size > maxCharacters) continue;

    selected.push({
      ...memory,
      importance: Number.isFinite(memory.importance) ? Number(memory.importance) : 3,
    });
    typeCounts.set(memory.memory_type, typeCount + 1);
    usedCharacters += size;
  }
  return selected;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readConversationState(metadata: unknown): ConversationState {
  const root = safeMetadata(metadata);
  const state = safeMetadata(root["rolling_state"]);
  return {
    summary: typeof state["summary"] === "string" ? state["summary"].slice(0, 7000) : "",
    updatedAt: typeof state["updated_at"] === "string" ? state["updated_at"] : null,
    summarizedMessageId:
      typeof state["last_message_id"] === "string" ? state["last_message_id"] : null,
    summarizedMessageCount:
      typeof state["message_count"] === "number" ? Math.max(0, state["message_count"]) : 0,
  };
}

function highSignalStateChange(message: string) {
  return /\b(actually|correction|from now on|no longer|not anymore|decided|decision|i will|i'm going to|we will|we're going to|remember|important|priority|deadline|new plan|change of plan|never mind|cancel that)\b/i.test(
    message,
  );
}

export function shouldRefreshConversationState(
  state: ConversationState,
  recentHistory: RecentTurn[],
  newestMessage = "",
) {
  if (recentHistory.length < 10) return false;
  if (!state.summary || !state.updatedAt) return recentHistory.length >= 14;

  const updated = Date.parse(state.updatedAt);
  if (!Number.isFinite(updated)) return true;
  const ageMs = Date.now() - updated;
  const lastIndex = state.summarizedMessageId
    ? recentHistory.findIndex((turn) => turn.id === state.summarizedMessageId)
    : -1;
  const turnsSinceSummary =
    lastIndex >= 0
      ? recentHistory.length - lastIndex - 1
      : Math.max(0, recentHistory.length - state.summarizedMessageCount);

  if (turnsSinceSummary >= 12) return true;
  if (ageMs >= 6 * 60 * 60 * 1000 && turnsSinceSummary >= 4) return true;
  if (ageMs >= 20 * 60 * 1000 && turnsSinceSummary >= 5 && highSignalStateChange(newestMessage)) {
    return true;
  }
  return false;
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  if (!Array.isArray(payload?.output)) return "";
  return payload.output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((content: any) => content?.type === "output_text")
    .map((content: any) => content?.text ?? "")
    .join("")
    .trim();
}

export async function refreshRollingConversationState(args: {
  apiKey: string;
  db: any;
  userId: string;
  conversation: { id: string; metadata: unknown };
  newestMessage: string;
  recentHistory: RecentTurn[];
}) {
  const current = readConversationState(args.conversation.metadata);
  if (!shouldRefreshConversationState(current, args.recentHistory, args.newestMessage))
    return current;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content:
            "Maintain a bounded working-state summary for Adam's persistent Emery conversation. This is continuity context, not a biography. Capture current priorities, active threads, explicit decisions, unresolved questions, commitments, recent constraints, and named referents needed to understand short follow-ups such as 'do that', 'the first one', or 'the other one'. Prefer newer explicit corrections over older state. Preserve useful prior state only while it is still active. Drop completed, cancelled, stale, or superseded details. Do not add secrets, diagnoses, speculation, personality judgments, or facts not explicitly supported by the supplied conversation. Write concise plain text under 4500 characters.",
        },
        {
          role: "user",
          content: JSON.stringify({
            previous_state: current.summary,
            recent_turns: args.recentHistory.slice(-24),
            newest_message: args.newestMessage,
          }),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Rolling state refresh failed with ${response.status}`);

  const summary = responseText(await response.json()).slice(0, 5000);
  if (!summary) return current;

  const updatedAt = new Date().toISOString();
  const lastTurn = args.recentHistory.at(-1);
  const metadata = {
    ...safeMetadata(args.conversation.metadata),
    rolling_state: {
      summary,
      updated_at: updatedAt,
      version: 2,
      last_message_id: lastTurn?.id ?? null,
      message_count: args.recentHistory.length,
    },
  };
  const { error } = await args.db
    .from("conversations")
    .update({ metadata, updated_at: updatedAt })
    .eq("id", args.conversation.id)
    .eq("user_id", args.userId);
  if (error) throw error;

  args.conversation.metadata = metadata;
  return {
    summary,
    updatedAt,
    summarizedMessageId: lastTurn?.id ?? null,
    summarizedMessageCount: args.recentHistory.length,
  };
}

function isDateOnlyTask(task: { metadata?: unknown }) {
  const metadata = safeMetadata(task.metadata);
  return metadata["due_date_only"] === true;
}

function dateKey(timestamp: string) {
  return timestamp.slice(0, 10);
}

export function buildExecutiveFocus(context: {
  tasks: Array<{
    title: string;
    priority: number;
    due_at: string | null;
    status: string;
    metadata?: unknown;
  }>;
  projects: Array<{ name: string; priority: number; next_action: string | null }>;
  meetings: Array<{ title: string | null; meeting_at: string | null }>;
}) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  const openTasks = context.tasks.filter((task) => task.status !== "completed");

  const overdue = openTasks.filter((task) => {
    if (!task.due_at) return false;
    if (isDateOnlyTask(task)) return dateKey(task.due_at) < today;
    const due = Date.parse(task.due_at);
    return Number.isFinite(due) && due < now;
  });

  const overdueTitles = new Set(overdue.map((task) => task.title));
  const dueSoon = openTasks.filter((task) => {
    if (!task.due_at || overdueTitles.has(task.title)) return false;
    if (isDateOnlyTask(task)) {
      const dueDate = dateKey(task.due_at);
      return dueDate === today || dueDate === tomorrow;
    }
    const due = Date.parse(task.due_at);
    return Number.isFinite(due) && due >= now && due <= now + 36 * 60 * 60 * 1000;
  });

  const alreadyUrgent = new Set([...overdue, ...dueSoon].map((task) => task.title));
  const high = openTasks
    .filter((task) => task.priority >= 4 && !alreadyUrgent.has(task.title))
    .sort((a, b) => b.priority - a.priority);

  const projectNext = context.projects
    .filter((project) => project.next_action?.trim())
    .sort((a, b) => b.priority - a.priority);
  const missingNext = context.projects
    .filter((project) => project.priority >= 3 && !project.next_action?.trim())
    .sort((a, b) => b.priority - a.priority);

  const nearestMeeting = context.meetings
    .filter((meeting) => meeting.meeting_at && Date.parse(meeting.meeting_at) >= now)
    .sort((a, b) => Date.parse(a.meeting_at ?? "") - Date.parse(b.meeting_at ?? ""))[0];

  const primary =
    overdue[0]?.title ??
    dueSoon[0]?.title ??
    high[0]?.title ??
    projectNext[0]?.next_action?.trim() ??
    (missingNext[0] ? `Define the next action for ${missingNext[0].name}` : null);

  const pressureCount = overdue.length + dueSoon.length + high.length;
  const lines = [
    primary ? `Highest-leverage next move: ${primary}` : null,
    overdue.length
      ? `Overdue (${overdue.length}): ${overdue
          .slice(0, 2)
          .map((task) => task.title)
          .join("; ")}`
      : null,
    dueSoon.length
      ? `Due soon (${dueSoon.length}): ${dueSoon
          .slice(0, 2)
          .map((task) => task.title)
          .join("; ")}`
      : null,
    high.length
      ? `Other high-priority work: ${high
          .slice(0, 2)
          .map((task) => task.title)
          .join("; ")}`
      : null,
    missingNext.length
      ? `Projects missing a next action: ${missingNext
          .slice(0, 2)
          .map((project) => project.name)
          .join("; ")}`
      : null,
    nearestMeeting
      ? `Nearest meeting: ${nearestMeeting.title ?? "Untitled"} at ${nearestMeeting.meeting_at}`
      : null,
    pressureCount >= 5
      ? "Overload signal: several urgent/high-priority items are competing. If Adam asks what to do or seems overloaded, reduce choices and recommend ONE next action first."
      : null,
    "Guidance boundary: use these signals only when relevant to Adam's request or a genuine conflict/deadline; do not append productivity coaching to unrelated casual conversation.",
  ].filter(Boolean);

  return lines.length > 1
    ? lines.join("\n")
    : "No urgent focus signal detected from structured data. Do not manufacture urgency.";
}
