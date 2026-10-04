/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MODEL_POLICY } from "@/lib/model-policy";
import { recordRuntimeEvent } from "@/lib/runtime-telemetry";
import { loadUnifiedVoiceContext } from "./unified-voice-context.ts";
import {
  executeVoiceCalendarCore,
  executeVoiceHpoRelationshipCore,
  executeVoiceHpoRouteCommandCore,
  executeVoiceHpoRouteStopCore,
  readVoiceHpoFieldStateCore,
  voiceRoutingMetadata,
} from "./voice-action-bridge.ts";
import type { VoiceUiContext } from "./voice-request-context.ts";

async function mainConversation(db: any, userId: string) {
  const { data: existing, error } = await db
    .from("conversations")
    .select("id,metadata")
    .eq("user_id", userId)
    .eq("channel", "main")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: createError } = await db
    .from("conversations")
    .insert({
      user_id: userId,
      channel: "main",
      title: "Emery",
      metadata: { primary: true, identity: "central-v1" },
    })
    .select("id,metadata")
    .single();
  if (createError || !created)
    throw createError ?? new Error("Could not create Emery conversation");
  return created;
}

function voiceUi(input: {
  surface?: string | null;
  routeId?: string | null;
  stopId?: string | null;
  accountId?: string | null;
  prospectId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): VoiceUiContext {
  return {
    surface: input.surface ?? null,
    routeId: input.routeId ?? null,
    stopId: input.stopId ?? null,
    accountId: input.accountId ?? null,
    prospectId: input.prospectId ?? null,
    location:
      Number.isFinite(input.latitude) && Number.isFinite(input.longitude)
        ? { latitude: Number(input.latitude), longitude: Number(input.longitude) }
        : null,
  };
}

export const executeUnifiedVoiceCalendarAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request: string;
      idempotencyKey?: string | null;
      surface?: string | null;
      routeId?: string | null;
      stopId?: string | null;
      accountId?: string | null;
      prospectId?: string | null;
    }) => ({
      request: String(input?.request ?? "")
        .trim()
        .slice(0, 2000),
      idempotencyKey: input?.idempotencyKey
        ? String(input.idempotencyKey).trim().slice(0, 240)
        : null,
      surface: input?.surface ? String(input.surface).slice(0, 120) : null,
      routeId: input?.routeId ? String(input.routeId).slice(0, 80) : null,
      stopId: input?.stopId ? String(input.stopId).slice(0, 80) : null,
      accountId: input?.accountId ? String(input.accountId).slice(0, 80) : null,
      prospectId: input?.prospectId ? String(input.prospectId).slice(0, 80) : null,
    }),
  )
  .handler(async ({ data, context }) => {
    if (!data.request) {
      return {
        recognized: false,
        performed: false,
        needsClarification: true,
        question: "What would you like me to change on your Calendar?",
        action: "none",
      } as const;
    }
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "Calendar actions are not configured." } as const;
    const startedAt = Date.now();
    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);
    const ui = voiceUi(data);
    const unified = await loadUnifiedVoiceContext({
      db,
      userId: context.userId,
      query: data.request,
      conversation,
      ui,
    });
    const { result, prepared } = await executeVoiceCalendarCore({
      db,
      userId: context.userId,
      apiKey,
      request: data.request,
      recent: unified.recent,
      openTasks: unified.actions.tasks,
      upcomingMeetings: unified.actions.meetings,
      requestId: data.idempotencyKey,
      conversationId: conversation.id,
      ui,
    });
    await recordRuntimeEvent(db, context.userId, {
      channel: "voice",
      eventType: "calendar_action",
      domain: prepared.routing.capabilityRoute.domain,
      action: result.action,
      status: result.needsClarification
        ? "clarification"
        : result.performed
          ? "ok"
          : result.error
            ? "error"
            : "skipped",
      durationMs: Date.now() - startedAt,
      model: MODEL_POLICY.action,
      metadata: { ...voiceRoutingMetadata(prepared), oneBrainPhase3: true },
    });
    return result;
  });

export const executeUnifiedVoiceHpoAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request: string;
      accountId?: string | null;
      prospectId?: string | null;
      routeId?: string | null;
      stopId?: string | null;
      surface?: string | null;
      requestId?: string | null;
    }) => ({
      request: String(input?.request ?? "")
        .trim()
        .slice(0, 3000),
      accountId: input?.accountId ? String(input.accountId).slice(0, 80) : null,
      prospectId: input?.prospectId ? String(input.prospectId).slice(0, 80) : null,
      routeId: input?.routeId ? String(input.routeId).slice(0, 80) : null,
      stopId: input?.stopId ? String(input.stopId).slice(0, 80) : null,
      surface: input?.surface ? String(input.surface).slice(0, 120) : null,
      requestId: input?.requestId ? String(input.requestId).slice(0, 240) : null,
    }),
  )
  .handler(async ({ data, context }) => {
    if (!data.request) {
      return {
        recognized: false,
        performed: false,
        needsClarification: true,
        question: "What HPO relationship update should I handle?",
        action: "none",
      } as const;
    }
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "HPO actions are not configured." } as const;
    const startedAt = Date.now();
    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);
    const ui = voiceUi(data);
    const unified = await loadUnifiedVoiceContext({
      db,
      userId: context.userId,
      query: data.request,
      conversation,
      ui,
    });
    const { result, prepared } = await executeVoiceHpoRelationshipCore({
      db,
      userId: context.userId,
      apiKey,
      request: data.request,
      recent: unified.recent,
      sourceMessageId: data.requestId,
      conversationId: conversation.id,
      ui,
    });
    await recordRuntimeEvent(db, context.userId, {
      channel: "voice",
      eventType: "hpo_action",
      domain: "hpo",
      action: result.action,
      status: result.needsClarification
        ? "clarification"
        : result.performed
          ? "ok"
          : result.error
            ? "error"
            : "skipped",
      durationMs: Date.now() - startedAt,
      model: MODEL_POLICY.action,
      metadata: { ...voiceRoutingMetadata(prepared), oneBrainPhase3: true, nonPhiController: true },
    });
    return result;
  });

export const executeUnifiedVoiceHpoFieldRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request: string;
      routeId?: string | null;
      stopId?: string | null;
      accountId?: string | null;
      prospectId?: string | null;
      surface?: string | null;
    }) => ({
      request: String(input?.request ?? "")
        .trim()
        .slice(0, 2000),
      routeId: input?.routeId ? String(input.routeId).slice(0, 80) : null,
      stopId: input?.stopId ? String(input.stopId).slice(0, 80) : null,
      accountId: input?.accountId ? String(input.accountId).slice(0, 80) : null,
      prospectId: input?.prospectId ? String(input.prospectId).slice(0, 80) : null,
      surface: input?.surface ? String(input.surface).slice(0, 120) : null,
    }),
  )
  .handler(async ({ data, context }) => {
    if (!data.request) {
      return {
        recognized: false,
        action: "none",
        reply: "What do you want to know about the current HPO field route?",
      } as const;
    }
    const startedAt = Date.now();
    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);
    const { result, prepared } = await readVoiceHpoFieldStateCore({
      db,
      userId: context.userId,
      request: data.request,
      conversationId: conversation.id,
      ui: voiceUi(data),
    });
    await recordRuntimeEvent(db, context.userId, {
      channel: "voice",
      eventType: "hpo_field_read",
      domain: "hpo",
      action: result.action,
      status: result.recognized ? "ok" : "skipped",
      durationMs: Date.now() - startedAt,
      model: null,
      metadata: {
        ...voiceRoutingMetadata(prepared),
        routeId: result.routeId,
        nextStopId: result.nextStop?.id ?? null,
        completed: result.completed,
        total: result.total,
        deterministic: true,
        oneBrainPhase3: true,
      },
    });
    return result;
  });

export const executeUnifiedVoiceHpoRouteStopAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request: string;
      requestId?: string | null;
      routeId?: string | null;
      stopId?: string | null;
      accountId?: string | null;
      prospectId?: string | null;
      surface?: string | null;
    }) => ({
      request: String(input?.request ?? "")
        .trim()
        .slice(0, 5000),
      requestId: input?.requestId ? String(input.requestId).slice(0, 240) : null,
      routeId: input?.routeId ? String(input.routeId).slice(0, 80) : null,
      stopId: input?.stopId ? String(input.stopId).slice(0, 80) : null,
      accountId: input?.accountId ? String(input.accountId).slice(0, 80) : null,
      prospectId: input?.prospectId ? String(input.prospectId).slice(0, 80) : null,
      surface: input?.surface ? String(input.surface).slice(0, 120) : null,
    }),
  )
  .handler(async ({ data, context }) => {
    if (!data.request) {
      return {
        recognized: false,
        performed: false,
        needsClarification: true,
        question: "What happened at the current HPO stop?",
        action: "none",
      } as const;
    }
    const startedAt = Date.now();
    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);
    const { result, prepared } = await executeVoiceHpoRouteStopCore({
      db,
      userId: context.userId,
      request: data.request,
      requestId: data.requestId,
      conversationId: conversation.id,
      ui: voiceUi(data),
    });
    await recordRuntimeEvent(db, context.userId, {
      channel: "voice",
      eventType: "hpo_route_stop_action",
      domain: "hpo",
      action: result.action,
      status: result.needsClarification
        ? "clarification"
        : result.performed
          ? "ok"
          : result.error
            ? "error"
            : "skipped",
      durationMs: Date.now() - startedAt,
      model: null,
      metadata: {
        ...voiceRoutingMetadata(prepared),
        routeId: result.routeId,
        stopId: result.stopId,
        executionRunId: result.executionRunId,
        oneBrainPhase3: true,
      },
    });
    return result;
  });

export const executeUnifiedVoiceHpoRouteCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request: string;
      requestId?: string | null;
      routeId?: string | null;
      stopId?: string | null;
      accountId?: string | null;
      prospectId?: string | null;
      surface?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    }) => ({
      request: String(input?.request ?? "")
        .trim()
        .slice(0, 4000),
      requestId: input?.requestId ? String(input.requestId).slice(0, 240) : null,
      routeId: input?.routeId ? String(input.routeId).slice(0, 80) : null,
      stopId: input?.stopId ? String(input.stopId).slice(0, 80) : null,
      accountId: input?.accountId ? String(input.accountId).slice(0, 80) : null,
      prospectId: input?.prospectId ? String(input.prospectId).slice(0, 80) : null,
      surface: input?.surface ? String(input.surface).slice(0, 120) : null,
      latitude: Number.isFinite(input?.latitude) ? Number(input.latitude) : null,
      longitude: Number.isFinite(input?.longitude) ? Number(input.longitude) : null,
    }),
  )
  .handler(async ({ data, context }) => {
    if (!data.request) {
      return {
        recognized: false,
        performed: false,
        needsClarification: true,
        question: "What should I change about the HPO route?",
        action: "none",
      } as const;
    }
    const startedAt = Date.now();
    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);
    const requestId = data.requestId ?? `voice:${context.userId}:${Date.now().toString(36)}`;
    const bridged = await executeVoiceHpoRouteCommandCore({
      db,
      userId: context.userId,
      request: data.request,
      requestId,
      conversationId: conversation.id,
      ui: voiceUi(data),
    });

    if (bridged.kind === "action_plan") {
      const result = bridged.result;
      await recordRuntimeEvent(db, context.userId, {
        channel: "voice",
        eventType: "hpo_route_command",
        domain: "mixed",
        action: "execute_action_plan",
        status: result.needsClarification ? "clarification" : result.performed ? "ok" : "error",
        durationMs: Date.now() - startedAt,
        model: null,
        metadata: {
          ...voiceRoutingMetadata(bridged.prepared),
          routeId: result.routeId,
          receiptCount: result.receipts.length,
          sharedPlanner: true,
          oneBrainPhase3: true,
        },
      });
      return {
        recognized: true,
        performed: result.performed,
        needsClarification: result.needsClarification,
        question: result.needsClarification ? result.reply : null,
        action: "emery.action_plan",
        routeId: result.routeId,
        executionRunId: result.receipts.find((receipt: any) => receipt.performed)?.id ?? null,
        reply: result.reply,
        receiptIds: result.receipts.map((receipt: any) => receipt.id),
        error: result.performed || result.needsClarification ? null : "emery_action_plan_failed",
      } as const;
    }

    const result = bridged.result;
    await recordRuntimeEvent(db, context.userId, {
      channel: "voice",
      eventType: "hpo_route_command",
      domain: "hpo",
      action: result.action,
      status: result.needsClarification
        ? "clarification"
        : result.performed
          ? "ok"
          : result.error
            ? "error"
            : "skipped",
      durationMs: Date.now() - startedAt,
      model: null,
      metadata: {
        ...voiceRoutingMetadata(bridged.prepared),
        routeId: result.routeId,
        executionRunId: result.executionRunId,
        oneBrainPhase3: true,
      },
    });
    return result;
  });

export const refreshUnifiedVoiceContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      query: string;
      routeId?: string | null;
      stopId?: string | null;
      accountId?: string | null;
      prospectId?: string | null;
      surface?: string | null;
    }) => ({
      query: String(input?.query ?? "")
        .trim()
        .slice(0, 1200),
      routeId: input?.routeId ? String(input.routeId).slice(0, 80) : null,
      stopId: input?.stopId ? String(input.stopId).slice(0, 80) : null,
      accountId: input?.accountId ? String(input.accountId).slice(0, 80) : null,
      prospectId: input?.prospectId ? String(input.prospectId).slice(0, 80) : null,
      surface: input?.surface ? String(input.surface).slice(0, 120) : null,
    }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const conversation = await mainConversation(db, context.userId);
    const current = await loadUnifiedVoiceContext({
      db,
      userId: context.userId,
      query: data.query || "refresh current Emery context",
      conversation,
      ui: voiceUi(data),
    });
    const memories = current.memories
      .map(
        (item: any) =>
          `[${item.memory_type}] ${item.title ? `${item.title}: ` : ""}${item.content}`,
      )
      .join("\n");
    return {
      result: [
        `Domain: ${current.route.domain}`,
        `Current context: ${JSON.stringify({
          routeId: current.currentContext.request.currentRouteId,
          stopId: current.currentContext.request.currentStopId,
          accountId: current.currentContext.request.selectedAccountId,
          prospectId: current.currentContext.request.selectedProspectId,
          fieldSessionId: current.currentContext.request.fieldSessionId,
          expectedNoteTargetId: current.currentContext.request.expectedNoteTargetId,
        })}`,
        `Capabilities: ${current.capabilityRoute.candidateCapabilities.join(", ") || "none"}`,
        `Focus: ${current.focus}`,
        current.loadPolicy.loadCalendarContext
          ? `Actions: ${JSON.stringify(current.actions).slice(0, 6500)}`
          : "",
        memories ? `Relevant memories:\n${memories}` : "",
        current.hpoContext
          ? `HPO context: ${JSON.stringify(current.hpoContext).slice(0, 6500)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      capabilityRoute: current.capabilityRoute,
      actionPlan: current.actionPlan,
      loadPolicy: current.loadPolicy,
    } as const;
  });
