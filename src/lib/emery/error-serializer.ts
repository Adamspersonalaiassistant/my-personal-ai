import type { EmeryFailureCode, SerializedError } from "./orchestration.types.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeString(value: unknown, fallback = "Unknown error"): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 800);
  return fallback;
}

function classifyFailure(input: {
  message: string;
  code: string | null;
  status: number | null;
}): EmeryFailureCode {
  const message = input.message.toLowerCase();
  const code = String(input.code ?? "").toLowerCase();
  const status = input.status;

  if (/timeout|timed out|aborted/.test(message) || code === "timeout") return "TIMEOUT";
  if (/offline_conflict|stale|changed after|refresh before retrying/.test(message))
    return "STALE_STATE";
  if (
    /network|fetch failed|failed to fetch|connection|offline|econn|enotfound/.test(message) ||
    /network|econn|enotfound/.test(code)
  )
    return "NETWORK_FAILURE";
  if (
    status === 401 ||
    status === 403 ||
    /permission|forbidden|unauthorized|row-level security|rls/.test(message)
  )
    return "PERMISSION_DENIED";
  if (
    status === 409 ||
    code === "23505" ||
    /conflict|duplicate key|unique constraint/.test(message)
  )
    return "WRITE_CONFLICT";
  if (/ambiguous|which .* do you mean|multiple matches/.test(message))
    return "AMBIGUOUS_ENTITY";
  if (/dependency|prerequisite/.test(message)) return "DEPENDENCY_FAILED";
  if (/routing|route optimization|road-time routing|route geometry/.test(message))
    return "ROUTING_FAILURE";
  if (/not configured|unavailable|no registered executor|not connected/.test(message))
    return "CAPABILITY_UNAVAILABLE";
  if (/missing context|which route|which stop|which account|current .* required/.test(message))
    return "MISSING_CONTEXT";
  if (/validation|invalid|required|must be|cannot be empty/.test(message))
    return "VALIDATION_FAILED";
  return "UNKNOWN_FAILURE";
}

function retryableFailure(code: EmeryFailureCode) {
  return code === "NETWORK_FAILURE" || code === "TIMEOUT" || code === "ROUTING_FAILURE";
}

export function userMessageForFailure(code: EmeryFailureCode) {
  switch (code) {
    case "MISSING_CONTEXT":
      return "I’m missing the current context I need to do that safely.";
    case "AMBIGUOUS_ENTITY":
      return "I found more than one possible match, so I need one quick clarification.";
    case "CAPABILITY_UNAVAILABLE":
      return "That capability isn’t available right now, so I didn’t claim the action happened.";
    case "DEPENDENCY_FAILED":
      return "A required earlier step didn’t complete, so I safely stopped the dependent action.";
    case "NETWORK_FAILURE":
      return "The connection failed before I could verify the action. Your existing state was preserved.";
    case "ROUTING_FAILURE":
      return "Routing is temporarily unavailable, so I kept the current route state instead of guessing.";
    case "WRITE_CONFLICT":
      return "The saved record changed while I was working, so I stopped rather than overwrite newer data.";
    case "PERMISSION_DENIED":
      return "I don’t currently have permission to complete that action.";
    case "VALIDATION_FAILED":
      return "I can’t safely complete that action until the missing or invalid information is corrected.";
    case "STALE_STATE":
      return "The app state changed since this request started. Refresh the current context before retrying.";
    case "TIMEOUT":
      return "The action timed out before it could be verified, so I’m not treating it as completed.";
    default:
      return "I couldn’t verify that action, so I left the current state unchanged.";
  }
}

export function structuredFailure(
  failureCode: EmeryFailureCode,
  input?: {
    message?: string;
    capability?: string | null;
    operation?: string | null;
    details?: Record<string, unknown>;
  },
): SerializedError {
  return {
    name: "EmeryExecutionError",
    message: input?.message?.trim() || userMessageForFailure(failureCode),
    code: failureCode,
    status: null,
    details: input?.details ?? {},
    capability: input?.capability ?? null,
    operation: input?.operation ?? null,
    failureCode,
    retryable: retryableFailure(failureCode),
    userMessage: userMessageForFailure(failureCode),
  };
}

export function serializeError(
  error: unknown,
  context?: { capability?: string; operation?: string },
): SerializedError {
  const source = record(error);
  const details = record(source["details"]);
  const message = safeString(
    source["message"],
    error instanceof Error ? error.message : safeString(error),
  );
  const code =
    typeof source["code"] === "string" || typeof source["code"] === "number"
      ? String(source["code"])
      : null;
  const status =
    typeof source["status"] === "number" && Number.isFinite(source["status"])
      ? source["status"]
      : null;
  const failureCode = classifyFailure({ message, code, status });

  return {
    name: safeString(source["name"], error instanceof Error ? error.name : "Error"),
    message,
    code,
    status,
    details,
    capability: context?.capability ?? null,
    operation: context?.operation ?? null,
    failureCode,
    retryable: retryableFailure(failureCode),
    userMessage: userMessageForFailure(failureCode),
  };
}
