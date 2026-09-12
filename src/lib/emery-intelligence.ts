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

function tokens(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
        .slice(0, 80),
    ),
  ];
}

function memoryScore(memory: PromptMemory, queryTokens: string[]) {
  const haystack = `${memory.title ?? ""} ${memory.content} ${memory.memory_type}`.toLowerCase();
  const overlap = queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
  const importance = Number.isFinite(memory.importance) ? Number(memory.importance) : 3;
  const typeBoost = /^(core|goal|constraint|responsibility|relationship|working_preference)$/.test(
    memory.memory_type,
  )
    ? 1.2
    : 0;
  const identityBoost = memory.memory_type === "core" && importance >= 4 ? 2.5 : 0;
  return overlap * 3 + importance * 0.8 + typeBoost + identityBoost;
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

  const mustKeep = memories
    .filter((memory) => memory.memory_type === "core" && Number(memory.importance ?? 0) >= 4)
    .sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0))
    .slice(0, 4);

  const ranked = memories
    .filter((memory) => !mustKeep.includes(memory))
    .map((memory) => ({ memory, score: memoryScore(memory, queryTokens) }))
    .filter(({ score, memory }) => score >= 3.2 || Number(memory.importance ?? 0) >= 5)
    .sort((a, b) => b.score - a.score)
    .map(({ memory }) => memory);

  const selected: Array<PromptMemory & { importance: number }> = [];
  let usedCharacters = 0;
  for (const memory of [...mustKeep, ...ranked]) {
    if (selected.length >= maxItems) break;
    if (selected.some((item) => item.id && item.id === memory.id)) continue;
    const size = `${memory.title ?? ""}${memory.content}${memory.memory_type}`.length + 24;
    if (selected.length > 0 && usedCharacters + size > maxCharacters) continue;
    selected.push({
      ...memory,
      importance: Number.isFinite(memory.importance) ? Number(memory.importance) : 3,
    });
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
  };
}

function shouldRefreshSummary(state: ConversationState, recentHistory: RecentTurn[]) {
  if (recentHistory.length < 20) return false;
  if (!state.summary || !state.updatedAt) return true;
  const updated = Date.parse(state.updatedAt);
  if (!Number.isFinite(updated)) return true;
  return Date.now() - updated >= 6 * 60 * 60 * 1000;
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
  if (!shouldRefreshSummary(current, args.recentHistory)) return current;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content:
            "Maintain a bounded working-state summary for Adam's persistent Emery conversation. This is continuity context, not a biography. Capture only current priorities, active threads, unresolved decisions/questions, commitments, recent constraints, and context required to understand short follow-ups later. Preserve useful prior state that is still active. Drop stale/completed details. Do not add secrets, diagnoses, speculation, personality judgments, or facts not explicitly supported by the supplied conversation. Write concise plain text under 4500 characters.",
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
  const metadata = {
    ...safeMetadata(args.conversation.metadata),
    rolling_state: { summary, updated_at: updatedAt, version: 1 },
  };
  const { error } = await args.db
    .from("conversations")
    .update({ metadata, updated_at: updatedAt })
    .eq("id", args.conversation.id)
    .eq("user_id", args.userId);
  if (error) throw error;
  args.conversation.metadata = metadata;
  return { summary, updatedAt };
}

export function buildExecutiveFocus(context: {
  tasks: Array<{ title: string; priority: number; due_at: string | null; status: string }>;
  projects: Array<{ name: string; priority: number; next_action: string | null }>;
  meetings: Array<{ title: string | null; meeting_at: string | null }>;
}) {
  const now = Date.now();
  const overdue = context.tasks
    .filter((task) => task.due_at && Date.parse(task.due_at) < now && task.status !== "completed")
    .slice(0, 3)
    .map((task) => task.title);
  const high = context.tasks
    .filter((task) => task.priority >= 4)
    .slice(0, 4)
    .map((task) => task.title);
  const missingNext = context.projects
    .filter((project) => project.priority >= 3 && !project.next_action?.trim())
    .slice(0, 3)
    .map((project) => project.name);
  const nearestMeeting = context.meetings.find(
    (meeting) => meeting.meeting_at && Date.parse(meeting.meeting_at) >= now,
  );
  const lines = [
    overdue.length ? `Overdue: ${overdue.join("; ")}` : null,
    high.length ? `High-priority open work: ${high.join("; ")}` : null,
    missingNext.length ? `Active projects missing a next action: ${missingNext.join("; ")}` : null,
    nearestMeeting
      ? `Nearest meeting: ${nearestMeeting.title ?? "Untitled"} at ${nearestMeeting.meeting_at}`
      : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "No urgent focus signal detected from structured data.";
}
