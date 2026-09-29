import type { SerializedError } from "./orchestration.types.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeString(value: unknown, fallback = "Unknown error"): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 800);
  return fallback;
}

export function serializeError(
  error: unknown,
  context?: { capability?: string; operation?: string },
): SerializedError {
  const source = record(error);
  const details = record(source["details"]);
  return {
    name: safeString(source["name"], error instanceof Error ? error.name : "Error"),
    message: safeString(
      source["message"],
      error instanceof Error ? error.message : safeString(error),
    ),
    code:
      typeof source["code"] === "string" || typeof source["code"] === "number"
        ? String(source["code"])
        : null,
    status:
      typeof source["status"] === "number" && Number.isFinite(source["status"])
        ? source["status"]
        : null,
    details,
    capability: context?.capability ?? null,
    operation: context?.operation ?? null,
  };
}
