export type EmeryVisualState =
  | "idle"
  | "listening"
  | "thinking"
  | "remembering"
  | "searching"
  | "planning"
  | "using_tool"
  | "executing"
  | "syncing"
  | "speaking"
  | "waiting"
  | "success"
  | "error";

export const EMERY_VISUAL_STATE_LABELS: Record<EmeryVisualState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  remembering: "Remembering",
  searching: "Searching",
  planning: "Planning",
  using_tool: "Using a tool",
  executing: "Executing",
  syncing: "Syncing",
  speaking: "Speaking",
  waiting: "Waiting",
  success: "Complete",
  error: "Needs attention",
};

export const EMERY_VISUAL_STATE_PRIORITY: EmeryVisualState[] = [
  "error",
  "success",
  "speaking",
  "listening",
  "executing",
  "using_tool",
  "searching",
  "remembering",
  "planning",
  "thinking",
  "syncing",
  "waiting",
  "idle",
];
