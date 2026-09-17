// Shared "always available Emery" handoff contract.
// One consistent pattern: any workspace surface can hand off into the single
// lifelong Emery conversation, carrying a return path and an optional prefill.

export const EMERY_RETURNS = {
  "/hpo": "HPO",
  "/personal": "Personal",
  "/tasks": "Tasks",
  "/projects": "Projects",
  "/meetings": "Meetings",
  "/memories": "Memories",
  "/settings": "System",
  "/agents": "Agents",
} as const;

export type EmeryReturnPath = keyof typeof EMERY_RETURNS;

export function isEmeryReturnPath(value: unknown): value is EmeryReturnPath {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EMERY_RETURNS, value);
}

export function emeryReturnLabel(path: EmeryReturnPath) { return EMERY_RETURNS[path]; }
export function resolveEmeryReturn(pathname: string): EmeryReturnPath | undefined {
  return (Object.keys(EMERY_RETURNS) as EmeryReturnPath[]).find((path) => pathname === path || pathname.startsWith(`${path}/`));
}
export const MAX_PREFILL_LENGTH = 400;
export function normalizePrefill(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim().slice(0, MAX_PREFILL_LENGTH);
  return clean.length ? clean : undefined;
}
