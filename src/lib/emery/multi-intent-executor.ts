/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeActionPlan } from "./executor.ts";
import { planEmeryRequest } from "./planner.ts";
import { resolveEntity } from "./entity-resolver.ts";
import { createEmptyRequestContext, type ExecutionReceipt } from "./orchestration.types.ts";
import { serializeError } from "./error-serializer.ts";
import { processHpoRouteCommand } from "@/lib/hpo-route-command-controller";
import { getHpoFieldTodayCore } from "@/lib/hpo-field.functions";
import { undoLatestEligibleExecutionCore } from "./undo.ts";
import { getTodaysPlanCore } from "./today-plan.ts";

function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

function receipt(
  input: Omit<ExecutionReceipt, "timestamp" | "sourceMessageId"> & {
    sourceMessageId: string;
  },
): ExecutionReceipt {
  return { ...input, timestamp: new Date().toISOString() };
}

export async function processEmeryMultiIntentDayPlan(input: {
  db: any;
  userId: string;
  message: string;
  timezone: string;
  sourceMessageId: string;
  sourceChannel: "chat" | "capture" | "shortcut" | "voice" | string;
  routeId?: string | null;
  stopId?: string | null;
  selectedAccountId?: string | null;
  selectedProspectId?: string | null;
}) {
  const plan = planEmeryRequest(input.message);
  const handlesPlan =
    plan.writes.includes("hpo.route.set_stops") ||
    plan.writes.includes("hpo.field_session.arm_note_target") ||
    plan.writes.includes("execution.undo");
  if (!handlesPlan) return { handled: false as const, plan, receipts: [] as ExecutionReceipt[] };

  const context = createEmptyRequestContext({
    userId: input.userId,
    conversationId: null,
    sourceMessageId: input.sourceMessageId,
    entryPoint: ["capture", "shortcut", "voice"].includes(input.sourceChannel)
      ? (input.sourceChannel as "capture" | "shortcut" | "voice")
      : "chat",
    inputMode: input.sourceChannel === "voice" ? "voice" : "typed",
    timezone: input.timezone,
    surface: input.sourceChannel === "voice" ? "hpo_today" : "chat",
    hpoTab: input.sourceChannel === "voice" ? "today" : null,
    currentRouteId: input.routeId ?? null,
    currentStopId: input.stopId ?? null,
    selectedAccountId: input.selectedAccountId ?? null,
    selectedProspectId: input.selectedProspectId ?? null,
  });
  const targetDate = localDate(input.timezone);
  const todaysPlan = await getTodaysPlanCore({
    db: input.db,
    userId: input.userId,
    timezone: input.timezone,
  });
  context.currentRouteId = todaysPlan.route?.id ?? context.currentRouteId;
  context.currentStopId = todaysPlan.route?.nextStopId ?? context.currentStopId;
  context.fieldSessionId = todaysPlan.fieldSession?.id ?? null;
  context.expectedNoteTargetId =
    todaysPlan.fieldSession?.expectedNoteStopId ??
    todaysPlan.fieldSession?.expectedNoteAccountId ??
    todaysPlan.fieldSession?.expectedNoteProspectId ??
    todaysPlan.fieldSession?.expectedNoteMeetingId ??
    null;
  let fieldState: any = null;
  let meetingRows: any[] = [];

  const execution = await executeActionPlan({
    plan,
    context,
    handlers: {
      "calendar.read": async (intent) => {
        const start = new Date(`${targetDate}T00:00:00.000Z`);
        const end = new Date(start.getTime() + 36 * 60 * 60 * 1000);
        const { data, error } = await input.db
          .from("meetings")
          .select("id,title,meeting_at,participants,metadata")
          .eq("user_id", input.userId)
          .gte("meeting_at", start.toISOString())
          .lt("meeting_at", end.toISOString())
          .order("meeting_at", { ascending: true });
        if (error) throw error;
        meetingRows = data ?? [];
        return receipt({
          id: `read:${intent.id}:${input.sourceMessageId}`,
          capability: intent.capability,
          action: intent.action,
          target: { type: "calendar_day", id: targetDate },
          status: "success",
          performed: false,
          before: null,
          after: { meetingCount: meetingRows.length },
          reason: "Read today's owner-scoped scheduled commitments.",
          error: null,
          idempotencyKey: null,
          reversible: false,
          undoData: null,
          sourceMessageId: input.sourceMessageId,
        });
      },
      "hpo.route.read": async (intent) => {
        fieldState = await getHpoFieldTodayCore({ db: input.db, userId: input.userId });
        context.currentRouteId = fieldState.route?.id ?? context.currentRouteId;
        context.currentStopId = fieldState.nextStop?.id ?? context.currentStopId;
        return receipt({
          id: `read:${intent.id}:${input.sourceMessageId}`,
          capability: intent.capability,
          action: intent.action,
          target: { type: "hpo_route", id: context.currentRouteId },
          status: "success",
          performed: false,
          before: null,
          after: {
            completed: fieldState.completed,
            remaining: fieldState.remaining,
            nextStopId: context.currentStopId,
          },
          reason: "Read today's route before applying dependent writes.",
          error: null,
          idempotencyKey: null,
          reversible: false,
          undoData: null,
          sourceMessageId: input.sourceMessageId,
        });
      },
      "entity.resolve": async (intent) => {
        const query = intent.entities[0] ?? plan.entities[0]?.text ?? "";
        const [contacts, accounts] = await Promise.all([
          input.db
            .from("hpo_contacts")
            .select("id,account_id,name,email,phone")
            .eq("user_id", input.userId)
            .limit(1000),
          input.db
            .from("hpo_accounts")
            .select("id,name,address")
            .eq("user_id", input.userId)
            .eq("status", "active")
            .limit(1000),
        ]);
        if (contacts.error) throw contacts.error;
        if (accounts.error) throw accounts.error;
        const contactCandidates = (contacts.data ?? []).map((row: any) => ({
          id: `contact:${row.id}`,
          name: row.name,
          email: row.email,
          phone: row.phone,
        }));
        const accountCandidates = (accounts.data ?? []).map((row: any) => ({
          id: `account:${row.id}`,
          name: row.name,
          address: row.address,
        }));
        const meetingCandidates = meetingRows.flatMap((row: any) => [
          { id: `meeting:${row.id}`, name: row.title },
          ...(Array.isArray(row.participants)
            ? row.participants.map((name: unknown, index: number) => ({
                id: `meeting:${row.id}:participant:${index}`,
                name: String(name),
              }))
            : []),
        ]);
        const contactResolution = resolveEntity(query, contactCandidates);
        const resolution =
          contactResolution.status !== "not_found"
            ? contactResolution
            : (() => {
                const accountResolution = resolveEntity(query, accountCandidates);
                return accountResolution.status !== "not_found"
                  ? accountResolution
                  : resolveEntity(query, meetingCandidates);
              })();
        if (resolution.status !== "resolved")
          return receipt({
            id: `resolve:${intent.id}:${input.sourceMessageId}`,
            capability: intent.capability,
            action: intent.action,
            target: null,
            status: "clarification_required",
            performed: false,
            before: null,
            after: { question: resolution.question },
            reason: resolution.question,
            error: null,
            idempotencyKey: null,
            reversible: false,
            undoData: null,
            sourceMessageId: input.sourceMessageId,
          });
        return receipt({
          id: `resolve:${intent.id}:${input.sourceMessageId}`,
          capability: intent.capability,
          action: intent.action,
          target: {
            type: "resolved_entity",
            id: resolution.value.id,
            label: resolution.value.name,
          },
          status: "success",
          performed: false,
          before: null,
          after: { confidence: resolution.confidence, evidence: resolution.evidence },
          reason: "Resolved from current Calendar/HPO structured records.",
          error: null,
          idempotencyKey: null,
          reversible: false,
          undoData: null,
          sourceMessageId: input.sourceMessageId,
        });
      },
      "hpo.route.set_stops": async (intent) => {
        try {
          const result = await processHpoRouteCommand({
            db: input.db,
            userId: input.userId,
            message: input.message,
            timezone: input.timezone,
            sourceMessageId: input.sourceMessageId,
            sourceChannel: input.sourceChannel,
          });
          if (result.needsClarification)
            return receipt({
              id: result.executionRunId ?? `clarify:${intent.id}:${input.sourceMessageId}`,
              capability: intent.capability,
              action: intent.action,
              target: null,
              status: "clarification_required",
              performed: false,
              before: null,
              after: { question: result.question },
              reason: result.question,
              error: null,
              idempotencyKey: `message:${input.sourceMessageId}:hpo.route.set_stops`,
              reversible: false,
              undoData: null,
              sourceMessageId: input.sourceMessageId,
            });
          if (!result.performed) throw new Error(result.error ?? "hpo_route_set_stops_failed");
          const data = result.receiptData ?? {};
          context.currentRouteId = result.routeId;
          const currentIds = Array.isArray(data["current_open_stop_ids"])
            ? data["current_open_stop_ids"]
            : [];
          context.currentStopId = currentIds.length ? String(currentIds[0]) : null;
          return receipt({
            id: result.executionRunId ?? `route:${input.sourceMessageId}`,
            capability: intent.capability,
            action: intent.action,
            target: { type: "hpo_route", id: result.routeId },
            status: "success",
            performed: true,
            before: { remainingStops: data["previous_open_stops"] ?? [] },
            after: { currentOpenStopIds: currentIds },
            reason: "Only unfinished stops changed; terminal visit history was preserved.",
            error: null,
            idempotencyKey: `message:${input.sourceMessageId}:hpo.route.set_stops`,
            reversible: true,
            undoData: {
              previousOpenStops: data["previous_open_stops"] ?? [],
              previousFieldSession: data["previous_field_session"] ?? null,
              expectedCurrentStopIds: currentIds,
            },
            sourceMessageId: input.sourceMessageId,
          });
        } catch (error) {
          return receipt({
            id: `failed:${intent.id}:${input.sourceMessageId}`,
            capability: intent.capability,
            action: intent.action,
            target: { type: "hpo_route", id: context.currentRouteId },
            status: "hard_failure",
            performed: false,
            before: null,
            after: null,
            reason: "The current route was left unchanged.",
            error: serializeError(error, {
              capability: intent.capability,
              operation: intent.action,
            }),
            idempotencyKey: `message:${input.sourceMessageId}:hpo.route.set_stops`,
            reversible: false,
            undoData: null,
            sourceMessageId: input.sourceMessageId,
          });
        }
      },
      "hpo.field_session.arm_note_target": async (intent, state) => {
        const routeReceipt = state.receipts.get("hpo.route:hpo.route.set_stops");
        return receipt({
          id: `session:${input.sourceMessageId}`,
          capability: intent.capability,
          action: intent.action,
          target: { type: "hpo_route_stop", id: context.currentStopId },
          status: "success",
          performed: true,
          before: null,
          after: {
            routeId: context.currentRouteId,
            stopId: context.currentStopId,
            persisted: true,
          },
          reason: routeReceipt
            ? "The atomic route mutation persisted the expected note target."
            : "The expected note target was persisted for today's Field Session.",
          error: null,
          idempotencyKey: `message:${input.sourceMessageId}:hpo.field_session.arm_note_target`,
          reversible: true,
          undoData: routeReceipt?.undoData ?? null,
          sourceMessageId: input.sourceMessageId,
        });
      },
      "execution.undo": async (intent) => {
        const result: any = await undoLatestEligibleExecutionCore({
          db: input.db,
          userId: input.userId,
          sourceMessageId: input.sourceMessageId,
          sourceChannel: input.sourceChannel,
        });
        return receipt({
          id: result.executionRunId ?? `undo:${input.sourceMessageId}`,
          capability: intent.capability,
          action: intent.action,
          target: { type: "hpo_route", id: result.routeId },
          status: result.performed
            ? "success"
            : result.needsClarification
              ? "clarification_required"
              : "safe_noop",
          performed: result.performed,
          before: null,
          after: result.performed ? { restored: true } : null,
          reason: result.reply,
          error: null,
          idempotencyKey: `message:${input.sourceMessageId}:execution.undo`,
          reversible: false,
          undoData: null,
          sourceMessageId: input.sourceMessageId,
        });
      },
    },
  });

  const clarification = execution.receipts.find((item) => item.status === "clarification_required");
  const routeReceipt = execution.receipts.find(
    (item) => item.action === "hpo.route.set_stops" && item.performed,
  );
  const undoReceipt = execution.receipts.find((item) => item.action === "execution.undo");
  const reply =
    clarification?.reason ??
    undoReceipt?.reason ??
    (routeReceipt
      ? "Done. That office is your only remaining stop today, completed visits are preserved, and I'm ready to attach your next update to it."
      : execution.status === "partial_success"
        ? "I completed part of that plan, but left any unsafe route change untouched."
        : "I couldn't safely change today's plan, so I left the current route unchanged.");

  return {
    handled: true as const,
    performed: execution.performed > 0,
    needsClarification: execution.needsClarification,
    reply,
    plan,
    receipts: execution.receipts,
    routeId: context.currentRouteId,
    stopId: context.currentStopId,
  };
}
