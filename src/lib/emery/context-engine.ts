import { inferEmeryDomain, type EmeryDomain } from "../emery-domain.ts";
import { CAPABILITY_REGISTRY, type CapabilityHealthKey } from "./capability-registry.ts";
import {
  createEmptyRequestContext,
  type EmeryEntryPoint,
  type EmeryInputMode,
  type EmerySurface,
  type FieldSession,
  type RequestContext,
} from "./orchestration.types.ts";

const TERMINAL_STOP_STATUSES = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

type DbClient = any;

export type ContextAuthority =
  | "explicit_ui"
  | "field_session"
  | "selected_account"
  | "active_route"
  | "expected_note_target"
  | "recent_receipt"
  | "inference"
  | "none";

export type EmeryCurrentMode = "hpo" | "calendar" | "general";

export type ContextCandidate<T> = {
  value: T | null | undefined;
  authority: ContextAuthority;
};

export type EmeryContextSnapshot = {
  version: 1;
  observedAt: string;
  localDate: string;
  timezone: string;
  mode: EmeryCurrentMode;
  domain: EmeryDomain;
  request: RequestContext;
  current: {
    route: Record<string, unknown> | null;
    stop: Record<string, unknown> | null;
    account: Record<string, unknown> | null;
    prospect: Record<string, unknown> | null;
    fieldSession: FieldSession | null;
    expectedNoteTarget: {
      type: "route_stop" | "account" | "prospect" | "meeting";
      id: string;
    } | null;
  };
  authority: {
    route: ContextAuthority;
    stop: ContextAuthority;
    account: ContextAuthority;
    prospect: ContextAuthority;
    expectedNoteTarget: ContextAuthority;
  };
  recentReceipts: Array<Record<string, unknown>>;
};

export type BuildEmeryContextInput = {
  db: DbClient;
  userId: string;
  message?: string | null;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  entryPoint?: EmeryEntryPoint | null;
  inputMode?: EmeryInputMode | null;
  surface?: string | null;
  timezone?: string | null;
  hpoRouteId?: string | null;
  hpoStopId?: string | null;
  selectedAccountId?: string | null;
  selectedProspectId?: string | null;
  location?: RequestContext["location"];
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

export function normalizeEmerySurface(value: unknown): EmerySurface {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized || normalized === "main" || normalized === "emery" || normalized === "chat")
    return "chat";
  if (normalized.includes("planner")) return "hpo_planner";
  if (normalized === "hpo_today" || normalized === "today") return "hpo_today";
  if (normalized.includes("hpo") && normalized.includes("map")) return "hpo_map";
  if (normalized === "map" || normalized.includes("route_map")) return "hpo_map";
  if (normalized.includes("account")) return "hpo_accounts";
  if (normalized.includes("activity")) return "hpo_activity";
  if (normalized.includes("calendar") || normalized.includes("task")) return "calendar";
  if (normalized === "more" || normalized.includes("settings")) return "more";
  if (normalized === "hpo") return "hpo_planner";
  return "chat";
}

function hpoTabForSurface(surface: EmerySurface): RequestContext["hpoTab"] {
  if (surface === "hpo_planner") return "planner";
  if (surface === "hpo_today") return "today";
  if (surface === "hpo_map") return "map";
  if (surface === "hpo_accounts") return "accounts";
  if (surface === "hpo_activity") return "activity";
  return null;
}

export function pickContextValue<T>(
  candidates: Array<ContextCandidate<T>>,
): { value: T | null; authority: ContextAuthority } {
  for (const candidate of candidates) {
    if (candidate.value !== null && candidate.value !== undefined) {
      return { value: candidate.value, authority: candidate.authority };
    }
  }
  return { value: null, authority: "none" };
}

function healthFromStatus(status: string, retryable: boolean) {
  if (status === "completed") return "healthy" as const;
  if (status === "failed") return retryable ? ("degraded" as const) : ("unavailable" as const);
  if (status === "cancelled") return "degraded" as const;
  if (status === "needs_clarification") return "healthy" as const;
  return "unknown" as const;
}

function healthKeyForExecution(run: Record<string, unknown>): CapabilityHealthKey | null {
  const action = String(run["action"] ?? "");
  const registered = CAPABILITY_REGISTRY[action as keyof typeof CAPABILITY_REGISTRY];
  if (registered) return registered.healthKey;
  if (action.startsWith("calendar.")) return action.includes("read") ? "calendar.read" : "calendar.write";
  if (action.startsWith("hpo.field_session.")) return "hpo.field_session";
  if (action.startsWith("hpo.interaction.") || action.startsWith("hpo.follow_up.")) return "hpo.crm.write";
  if (action.startsWith("hpo.route.")) return action.includes("read") ? "hpo.route.read" : "hpo.route.write";
  if (action.startsWith("hpo.route_stop.")) return "hpo.route.write";
  if (action.startsWith("memory.")) return "memory.retrieve";
  if (action.startsWith("voice.")) return "voice.session";
  return null;
}

export function deriveCapabilityHealth(
  runs: Array<Record<string, unknown>>,
): RequestContext["capabilityHealth"] {
  const health: RequestContext["capabilityHealth"] = {};
  const keys = new Set<CapabilityHealthKey>(
    Object.values(CAPABILITY_REGISTRY).map((definition) => definition.healthKey),
  );
  keys.add("memory.retrieve");
  keys.add("voice.session");
  for (const key of keys) health[key] = "unknown";

  for (const run of runs) {
    const key = healthKeyForExecution(run);
    if (!key || health[key] !== "unknown") continue;
    health[key] = healthFromStatus(String(run["status"] ?? ""), Boolean(run["retryable"]));
  }
  return health;
}

async function readTimezone(db: DbClient, userId: string, explicit?: string | null) {
  const direct = text(explicit);
  if (direct) return direct;
  const { data } = await db
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  return text(data?.timezone) ?? "America/New_York";
}

async function readFieldSession(db: DbClient, userId: string, sessionDate: string) {
  const { data, error } = await db
    .from("emery_field_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("session_date", sessionDate)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function readRecentReceipts(db: DbClient, userId: string) {
  const { data, error } = await db
    .from("emery_execution_runs")
    .select(
      "id,domain,action,status,target_type,target_id,result_payload,error_code,retryable,created_at,completed_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function readRouteById(db: DbClient, userId: string, routeId: string | null) {
  if (!routeId) return null;
  const { data, error } = await db
    .from("hpo_route_plans")
    .select("id,route_date,area,status,updated_at,metadata")
    .eq("user_id", userId)
    .eq("id", routeId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function readCurrentRoute(db: DbClient, userId: string, today: string) {
  const { data, error } = await db
    .from("hpo_route_plans")
    .select("id,route_date,area,status,updated_at,metadata")
    .eq("user_id", userId)
    .in("status", ["draft", "planned", "active", "in_progress"])
    .order("route_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  const routes = data ?? [];
  return (
    routes.find(
      (route: any) =>
        route.route_date === today && ["active", "in_progress"].includes(String(route.status)),
    ) ??
    routes.find((route: any) => route.route_date === today) ??
    routes.find((route: any) => ["active", "in_progress"].includes(String(route.status))) ??
    null
  );
}

async function readRouteStops(db: DbClient, userId: string, routeId: string | null) {
  if (!routeId) return [] as Array<Record<string, unknown>>;
  const { data, error } = await db
    .from("hpo_route_stops")
    .select(
      "id,route_id,account_id,prospect_id,stop_order,status,visited_at,office_name,address,city,updated_at,metadata",
    )
    .eq("user_id", userId)
    .eq("route_id", routeId)
    .order("stop_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function readAccount(db: DbClient, userId: string, accountId: string | null) {
  if (!accountId) return null;
  const { data, error } = await db
    .from("hpo_accounts")
    .select(
      "id,name,account_type,specialty,address,city,priority,relationship_stage,relationship_health,last_touch_at,next_action,next_action_due_at,status,owner_name,tags,metadata",
    )
    .eq("user_id", userId)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function readProspect(db: DbClient, userId: string, prospectId: string | null) {
  if (!prospectId) return null;
  const { data, error } = await db
    .from("hpo_prospects")
    .select("id,name,prospect_type,specialty,address,city,fit_status,verification_status,metadata")
    .eq("user_id", userId)
    .eq("id", prospectId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function expectedNoteTarget(fieldSession: Record<string, unknown> | null) {
  if (!fieldSession) return null;
  const candidates: Array<["route_stop" | "account" | "prospect" | "meeting", unknown]> = [
    ["route_stop", fieldSession["expected_note_stop_id"]],
    ["account", fieldSession["expected_note_account_id"]],
    ["prospect", fieldSession["expected_note_prospect_id"]],
    ["meeting", fieldSession["expected_note_meeting_id"]],
  ];
  for (const [type, value] of candidates) {
    const id = text(value);
    if (id) return { type, id };
  }
  return null;
}

function recentTarget(
  receipts: Array<Record<string, unknown>>,
  targetTypes: string[],
): string | null {
  for (const receipt of receipts) {
    if (!targetTypes.includes(String(receipt["target_type"] ?? ""))) continue;
    const id = text(receipt["target_id"]);
    if (id) return id;
  }
  return null;
}

function fieldSessionShape(row: Record<string, unknown> | null): FieldSession | null {
  if (!row || !text(row["id"])) return null;
  const status = String(row["status"] ?? "active");
  if (!(["active", "completed", "cancelled"] as const).includes(status as any)) return null;
  return {
    id: String(row["id"]),
    sessionDate: String(row["session_date"] ?? ""),
    status: status as FieldSession["status"],
    routeId: text(row["route_id"]),
    currentStopId: text(row["current_stop_id"]),
    expectedNoteStopId: text(row["expected_note_stop_id"]),
    expectedNoteAccountId: text(row["expected_note_account_id"]),
    expectedNoteProspectId: text(row["expected_note_prospect_id"]),
    expectedNoteMeetingId: text(row["expected_note_meeting_id"]),
    optionalProspecting: Boolean(row["optional_prospecting"]),
  };
}

export async function buildEmeryContext(
  input: BuildEmeryContextInput,
): Promise<EmeryContextSnapshot> {
  const observedAt = new Date().toISOString();
  const timezone = await readTimezone(input.db, input.userId, input.timezone);
  const today = localDate(timezone);
  const surface = normalizeEmerySurface(input.surface);

  const [rawFieldSession, receipts] = await Promise.all([
    readFieldSession(input.db, input.userId, today).catch(() => null),
    readRecentReceipts(input.db, input.userId).catch(() => []),
  ]);
  const fieldSession = fieldSessionShape(rawFieldSession ? record(rawFieldSession) : null);

  const explicitRoute = await readRouteById(input.db, input.userId, text(input.hpoRouteId));
  const sessionRoute = explicitRoute
    ? null
    : await readRouteById(input.db, input.userId, fieldSession?.routeId ?? null);
  const activeRoute = explicitRoute || sessionRoute
    ? null
    : await readCurrentRoute(input.db, input.userId, today);
  const routeChoice = pickContextValue<Record<string, unknown>>([
    { value: explicitRoute, authority: "explicit_ui" },
    { value: sessionRoute, authority: "field_session" },
    { value: activeRoute, authority: "active_route" },
  ]);
  const route = routeChoice.value;
  const routeId = text(route?.["id"]);
  const stops = await readRouteStops(input.db, input.userId, routeId);

  const explicitStopId = text(input.hpoStopId);
  const explicitStop = explicitStopId
    ? stops.find((stop) => text(stop["id"]) === explicitStopId) ?? null
    : null;
  const sessionStop = fieldSession?.currentStopId
    ? stops.find((stop) => text(stop["id"]) === fieldSession.currentStopId) ?? null
    : null;
  const arrivedStop =
    stops.find((stop) => String(stop["status"] ?? "") === "arrived") ?? null;
  const openStop =
    stops.find((stop) => !TERMINAL_STOP_STATUSES.has(String(stop["status"] ?? ""))) ?? null;
  const expectedStop = fieldSession?.expectedNoteStopId
    ? stops.find((stop) => text(stop["id"]) === fieldSession.expectedNoteStopId) ?? null
    : null;
  const receiptStopId = recentTarget(receipts, ["hpo_route_stop"]);
  const receiptStop = receiptStopId
    ? stops.find((stop) => text(stop["id"]) === receiptStopId) ?? null
    : null;
  const stopChoice = pickContextValue<Record<string, unknown>>([
    { value: explicitStop, authority: "explicit_ui" },
    { value: sessionStop, authority: "field_session" },
    { value: arrivedStop, authority: "active_route" },
    { value: openStop, authority: "active_route" },
    { value: expectedStop, authority: "expected_note_target" },
    { value: receiptStop, authority: "recent_receipt" },
  ]);
  const stop = stopChoice.value;

  const accountIdChoice = pickContextValue<string>([
    { value: text(input.selectedAccountId), authority: "explicit_ui" },
    { value: fieldSession?.expectedNoteAccountId ?? null, authority: "field_session" },
    { value: text(stop?.["account_id"]), authority: "active_route" },
    {
      value: recentTarget(receipts, ["hpo_account", "account"]),
      authority: "recent_receipt",
    },
  ]);
  let account = await readAccount(input.db, input.userId, accountIdChoice.value);
  let accountAuthority = account ? accountIdChoice.authority : "none" as ContextAuthority;
  if (!account && text(stop?.["account_id"])) {
    account = await readAccount(input.db, input.userId, text(stop?.["account_id"]));
    if (account) accountAuthority = "active_route";
  }

  const prospectIdChoice = pickContextValue<string>([
    { value: text(input.selectedProspectId), authority: "explicit_ui" },
    { value: fieldSession?.expectedNoteProspectId ?? null, authority: "field_session" },
    { value: text(stop?.["prospect_id"]), authority: "active_route" },
    {
      value: recentTarget(receipts, ["hpo_prospect", "prospect"]),
      authority: "recent_receipt",
    },
  ]);
  let prospect = await readProspect(input.db, input.userId, prospectIdChoice.value);
  let prospectAuthority = prospect ? prospectIdChoice.authority : "none" as ContextAuthority;
  if (!prospect && text(stop?.["prospect_id"])) {
    prospect = await readProspect(input.db, input.userId, text(stop?.["prospect_id"]));
    if (prospect) prospectAuthority = "active_route";
  }

  const noteTarget = expectedNoteTarget(rawFieldSession ? record(rawFieldSession) : null);
  const structuredHpo =
    surface.startsWith("hpo_") || Boolean(route || stop || account || prospect || fieldSession);
  const inferred = inferEmeryDomain(input.message ?? "");
  const domain: EmeryDomain = structuredHpo ? "hpo" : inferred.domain;
  const mode: EmeryCurrentMode = structuredHpo
    ? "hpo"
    : surface === "calendar"
      ? "calendar"
      : "general";
  const capabilityHealth = deriveCapabilityHealth(receipts);

  const request = createEmptyRequestContext({
    userId: input.userId,
    timezone,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    entryPoint: input.entryPoint ?? "chat",
    inputMode: input.inputMode ?? "typed",
    surface,
    hpoTab: hpoTabForSurface(surface),
    currentRouteId: routeId,
    currentStopId: text(stop?.["id"]),
    selectedAccountId: text(account?.["id"]),
    selectedProspectId: text(prospect?.["id"]),
    expectedNoteTargetId: noteTarget?.id ?? null,
    fieldSessionId: fieldSession?.id ?? null,
    location: input.location ?? null,
    recentReceiptIds: receipts.map((receipt) => String(receipt["id"] ?? "")).filter(Boolean),
    capabilityHealth,
  });

  return {
    version: 1,
    observedAt,
    localDate: today,
    timezone,
    mode,
    domain,
    request,
    current: {
      route,
      stop,
      account,
      prospect,
      fieldSession,
      expectedNoteTarget: noteTarget,
    },
    authority: {
      route: routeChoice.authority,
      stop: stopChoice.authority,
      account: accountAuthority,
      prospect: prospectAuthority,
      expectedNoteTarget: noteTarget ? "expected_note_target" : "none",
    },
    recentReceipts: receipts,
  };
}
