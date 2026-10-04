/* eslint-disable @typescript-eslint/no-explicit-any */
import { processCalendarAction } from "@/lib/calendar-agent";
import { processHpoAction } from "@/lib/hpo-action-controller";
import { processHpoFieldReadCommand } from "@/lib/hpo-field-read-controller";
import { processHpoRouteCommand } from "@/lib/hpo-route-command-controller";
import { processHpoRouteStopAction } from "@/lib/hpo-route-action-controller";
import { recordEvaluationSignal } from "@/lib/runtime-telemetry";
import { createEvaluationSignal } from "./evaluation.ts";
import {
  contextualizeVoiceCorrection,
  isVoiceCorrectionTurn,
} from "./voice-conversation-policy.ts";
import { processEmeryMultiIntentDayPlan } from "./multi-intent-executor.ts";
import { prepareVoiceRequest, type VoiceUiContext } from "./voice-request-context.ts";

function fieldReadMessage(request: string) {
  const text = request
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/\b(what did she say|what did he say|what did they say|what did them say)\b/.test(text)) {
    return "What happened here last time?";
  }
  return request;
}

async function recordVoiceCorrectionEvaluation(input: {
  db: any;
  userId: string;
  request: string;
  domain: string;
  result: { performed?: boolean; needsClarification?: boolean; action?: string | null };
}) {
  if (!isVoiceCorrectionTurn(input.request)) return;
  const passed = input.result.performed === true;
  await recordEvaluationSignal(input.db, input.userId, {
    channel: "voice",
    domain: input.domain,
    signal: createEvaluationSignal({
      category: "voice_correction",
      passed,
      severity: passed ? "info" : input.result.needsClarification ? "medium" : "high",
      source: "user_correction",
      request: input.request,
      expected: "correction supersedes the prior intended action without creating a duplicate",
      observed: passed
        ? `canonical correction performed via ${input.result.action ?? "controller"}`
        : input.result.needsClarification
          ? "canonical controller requested clarification before changing state"
          : "canonical controller did not confirm the correction",
      metadata: {
        correctionApplied: passed,
        needsClarification: input.result.needsClarification === true,
        action: input.result.action ?? null,
      },
    }),
  });
}

export async function readVoiceHpoFieldStateCore(input: {
  db: any;
  userId: string;
  request: string;
  conversationId?: string | null;
  ui?: VoiceUiContext | null;
}) {
  const prepared = await prepareVoiceRequest({
    db: input.db,
    userId: input.userId,
    message: input.request,
    conversationId: input.conversationId ?? null,
    ui: input.ui ?? null,
  });
  const result = await processHpoFieldReadCommand({
    db: input.db,
    userId: input.userId,
    message: fieldReadMessage(input.request),
    context: prepared.currentContext,
  });
  return { result, prepared };
}

export async function executeVoiceHpoRouteStopCore(input: {
  db: any;
  userId: string;
  request: string;
  requestId?: string | null;
  conversationId?: string | null;
  ui?: VoiceUiContext | null;
}) {
  const prepared = await prepareVoiceRequest({
    db: input.db,
    userId: input.userId,
    message: input.request,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.requestId ?? null,
    ui: input.ui ?? null,
  });
  const result = await processHpoRouteStopAction({
    db: input.db,
    userId: input.userId,
    message: input.request,
    timezone: prepared.currentContext.timezone,
    requestId: input.requestId ?? null,
    sourceChannel: "voice",
    routeId: prepared.resolved.routeId,
    stopId: prepared.resolved.stopId,
  });
  return { result, prepared };
}

export async function executeVoiceHpoRelationshipCore(input: {
  db: any;
  userId: string;
  apiKey: string;
  request: string;
  recent?: Array<{ role?: string; text?: string; createdAt?: string }>;
  sourceMessageId?: string | null;
  conversationId?: string | null;
  ui?: VoiceUiContext | null;
}) {
  const recent = input.recent ?? [];
  const prepared = await prepareVoiceRequest({
    db: input.db,
    userId: input.userId,
    message: input.request,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    ui: input.ui ?? null,
  });
  const result = await processHpoAction({
    db: input.db,
    userId: input.userId,
    apiKey: input.apiKey,
    message: contextualizeVoiceCorrection(input.request, recent),
    recent,
    timezone: prepared.currentContext.timezone,
    sourceMessageId: input.sourceMessageId ?? null,
    selectedAccountId: input.ui?.accountId ?? prepared.resolved.accountId,
  });
  await recordVoiceCorrectionEvaluation({
    db: input.db,
    userId: input.userId,
    request: input.request,
    domain: "hpo",
    result,
  });
  return { result, prepared };
}

export async function executeVoiceCalendarCore(input: {
  db: any;
  userId: string;
  apiKey: string;
  request: string;
  recent?: Array<{ role?: string; text?: string; createdAt?: string }>;
  openTasks?: any[];
  upcomingMeetings?: any[];
  requestId?: string | null;
  conversationId?: string | null;
  ui?: VoiceUiContext | null;
}) {
  const recent = (input.recent ?? []).flatMap((item) =>
    typeof item.role === "string" && typeof item.text === "string"
      ? [{ role: item.role, text: item.text }]
      : [],
  );
  const prepared = await prepareVoiceRequest({
    db: input.db,
    userId: input.userId,
    message: input.request,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.requestId ?? null,
    ui: input.ui ?? null,
  });
  const result = await processCalendarAction({
    db: input.db,
    userId: input.userId,
    apiKey: input.apiKey,
    message: contextualizeVoiceCorrection(input.request, recent),
    recent,
    timezone: prepared.currentContext.timezone,
    openTasks: input.openTasks ?? [],
    upcomingMeetings: input.upcomingMeetings ?? [],
    requestId: input.requestId ?? null,
    sourceChannel: "voice",
  });
  await recordVoiceCorrectionEvaluation({
    db: input.db,
    userId: input.userId,
    request: input.request,
    domain: "calendar",
    result,
  });
  return { result, prepared };
}

export async function executeVoiceHpoRouteCommandCore(input: {
  db: any;
  userId: string;
  request: string;
  requestId: string;
  conversationId?: string | null;
  ui?: VoiceUiContext | null;
}) {
  const prepared = await prepareVoiceRequest({
    db: input.db,
    userId: input.userId,
    message: input.request,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.requestId,
    ui: input.ui ?? null,
  });

  const multiIntent = await processEmeryMultiIntentDayPlan({
    db: input.db,
    userId: input.userId,
    message: input.request,
    timezone: prepared.currentContext.timezone,
    sourceMessageId: input.requestId,
    sourceChannel: "voice",
    routeId: prepared.resolved.routeId,
    stopId: prepared.resolved.stopId,
    selectedAccountId: prepared.resolved.accountId,
    selectedProspectId: prepared.resolved.prospectId,
  });

  if (multiIntent.handled) {
    return {
      kind: "action_plan" as const,
      result: multiIntent,
      prepared,
    };
  }

  const result = await processHpoRouteCommand({
    db: input.db,
    userId: input.userId,
    message: input.request,
    timezone: prepared.currentContext.timezone,
    requestId: input.requestId,
    sourceChannel: "voice",
    routeId: prepared.resolved.routeId,
    latitude: input.ui?.location?.latitude ?? null,
    longitude: input.ui?.location?.longitude ?? null,
  });
  return {
    kind: "route_command" as const,
    result,
    prepared,
  };
}

export function voiceRoutingMetadata(prepared: Awaited<ReturnType<typeof prepareVoiceRequest>>) {
  return {
    currentContext: {
      routeId: prepared.resolved.routeId,
      stopId: prepared.resolved.stopId,
      accountId: prepared.resolved.accountId,
      prospectId: prepared.resolved.prospectId,
      fieldSessionId: prepared.currentContext.request.fieldSessionId,
      expectedNoteTargetId: prepared.currentContext.request.expectedNoteTargetId,
    },
    capabilityRoute: prepared.routing.capabilityRoute,
    actionPlan: prepared.routing.actionPlan,
  };
}
