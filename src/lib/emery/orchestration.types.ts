export type EmeryEntryPoint = "chat" | "capture" | "shortcut" | "voice";
export type EmeryInputMode = "typed" | "dictated" | "voice";
export type EmerySurface =
  | "chat"
  | "hpo_planner"
  | "hpo_today"
  | "hpo_map"
  | "hpo_accounts"
  | "hpo_activity"
  | "calendar"
  | "more";

export type EntityKind =
  "person" | "contact" | "account" | "prospect" | "office" | "route" | "route_stop" | "meeting";

export type RequestContext = {
  userId: string;
  conversationId: string | null;
  sourceMessageId: string | null;
  entryPoint: EmeryEntryPoint;
  inputMode: EmeryInputMode;
  timezone: string;
  surface: EmerySurface;
  hpoTab: "planner" | "today" | "map" | "accounts" | "activity" | null;
  currentRouteId: string | null;
  currentStopId: string | null;
  selectedAccountId: string | null;
  selectedProspectId: string | null;
  expectedNoteTargetId: string | null;
  fieldSessionId: string | null;
  location: { latitude: number; longitude: number; accuracyMeters?: number } | null;
  recentReceiptIds: string[];
  capabilityHealth: Record<string, "healthy" | "degraded" | "unavailable" | "unknown">;
};

export type FieldSession = {
  id: string;
  sessionDate: string;
  status: "active" | "completed" | "cancelled";
  routeId: string | null;
  currentStopId: string | null;
  expectedNoteStopId: string | null;
  expectedNoteAccountId: string | null;
  expectedNoteProspectId: string | null;
  expectedNoteMeetingId: string | null;
  optionalProspecting: boolean;
};

export type TodaysPlan = {
  date: string;
  timezone: string;
  meetings: Array<{ id: string; title: string; startsAt: string }>;
  route: {
    id: string;
    completed: number;
    remaining: number;
    nextStopId: string | null;
  } | null;
  fieldSession: FieldSession | null;
};

export type PlannedIntent = {
  id: string;
  capability: string;
  action: string;
  mode: "read" | "write";
  risk: "low" | "medium" | "high";
  dependsOn: string[];
  entities: string[];
  reason: string;
};

export type ActionPlan = {
  version: 1;
  goal: string;
  intents: PlannedIntent[];
  entities: Array<{ kind: EntityKind; text: string }>;
  reads: string[];
  writes: string[];
  clarifications: string[];
  expectedReceipts: string[];
};

export type EntityResolution<T = unknown> =
  | { status: "resolved"; value: T; confidence: number; evidence: string[] }
  | { status: "ambiguous"; candidates: T[]; question: string; evidence: string[] }
  | { status: "not_found"; question: string | null; evidence: string[] };

export type SerializedError = {
  name: string;
  message: string;
  code: string | null;
  status: number | null;
  details: Record<string, unknown>;
  capability: string | null;
  operation: string | null;
};

export type ExecutionReceipt = {
  id: string;
  capability: string;
  action: string;
  target: { type: string; id: string | null; label?: string | null } | null;
  status:
    | "success"
    | "partial_success"
    | "clarification_required"
    | "safe_noop"
    | "recovered_failure"
    | "hard_failure";
  performed: boolean;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  error: SerializedError | null;
  idempotencyKey: string | null;
  timestamp: string;
  reversible: boolean;
  undoData: Record<string, unknown> | null;
  sourceMessageId: string | null;
};

export function createEmptyRequestContext(
  input: Pick<RequestContext, "userId" | "timezone"> & Partial<RequestContext>,
): RequestContext {
  return {
    conversationId: null,
    sourceMessageId: null,
    entryPoint: "chat",
    inputMode: "typed",
    surface: "chat",
    hpoTab: null,
    currentRouteId: null,
    currentStopId: null,
    selectedAccountId: null,
    selectedProspectId: null,
    expectedNoteTargetId: null,
    fieldSessionId: null,
    location: null,
    recentReceiptIds: [],
    capabilityHealth: {},
    ...input,
  };
}
