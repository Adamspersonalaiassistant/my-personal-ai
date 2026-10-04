/* eslint-disable @typescript-eslint/no-explicit-any */
import { processCalendarAction } from "@/lib/calendar-agent";
import { processHpoAction } from "@/lib/hpo-action-controller";
import { processHpoFieldReadCommand } from "@/lib/hpo-field-read-controller";
import { processHpoRouteCommand } from "@/lib/hpo-route-command-controller";
import { processHpoRouteStopAction } from "@/lib/hpo-route-action-controller";
import { processEmeryMultiIntentDayPlan } from "./multi-intent-executor.ts";
import { prepareVoiceRequest, type VoiceUiContext } from "./voice-request-context.ts";

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
    message: input.request,
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
    message: input.request,
    recent: input.recent ?? [],
    timezone: prepared.currentContext.timezone,
    sourceMessageId: input.sourceMessageId ?? null,
    selectedAccountId: input.ui?.accountId ?? prepared.resolved.accountId,
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
    message: input.request,
    recent: input.recent ?? [],
    timezone: prepared.currentContext.timezone,
    openTasks: input.openTasks ?? [],
    upcomingMeetings: input.upcomingMeetings ?? [],
    requestId: input.requestId ?? null,
    sourceChannel: "voice",
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
