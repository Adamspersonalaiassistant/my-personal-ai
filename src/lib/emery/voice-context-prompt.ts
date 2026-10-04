/* eslint-disable @typescript-eslint/no-explicit-any */
import { NATURAL_VOICE_CONTRACT } from "./voice-conversation-policy.ts";

export function buildUnifiedVoiceContextPrompt(context: {
  currentContext?: any;
  capabilityRoute?: any;
  actionPlan?: any;
  loadPolicy?: any;
  memoryPrompt?: string | null;
}) {
  const current = context.currentContext;
  if (!current) return "";

  const request = current.request ?? {};
  const compact = {
    observedAt: current.observedAt ?? null,
    localDate: current.localDate ?? null,
    timezone: current.timezone ?? null,
    mode: current.mode ?? null,
    domain: current.domain ?? null,
    surface: request.surface ?? null,
    hpoTab: request.hpoTab ?? null,
    currentRouteId: request.currentRouteId ?? null,
    currentStopId: request.currentStopId ?? null,
    selectedAccountId: request.selectedAccountId ?? null,
    selectedProspectId: request.selectedProspectId ?? null,
    fieldSessionId: request.fieldSessionId ?? null,
    expectedNoteTargetId: request.expectedNoteTargetId ?? null,
    authority: current.authority ?? {},
  };

  const route = context.capabilityRoute
    ? {
        domain: context.capabilityRoute.domain,
        candidateCapabilities: context.capabilityRoute.candidateCapabilities,
        needsCurrentContext: context.capabilityRoute.needsCurrentContext,
        needsHpoContext: context.capabilityRoute.needsHpoContext,
        needsPersonalMemory: context.capabilityRoute.needsPersonalMemory,
        needsCalendar: context.capabilityRoute.needsCalendar,
        needsLocation: context.capabilityRoute.needsLocation,
        confidence: context.capabilityRoute.confidence,
        reason: context.capabilityRoute.reason,
      }
    : null;

  const plan = context.actionPlan
    ? {
        goal: context.actionPlan.goal,
        reads: context.actionPlan.reads,
        writes: context.actionPlan.writes,
        intents: (context.actionPlan.intents ?? []).map((intent: any) => ({
          id: intent.id,
          action: intent.action,
          capability: intent.capability,
          mode: intent.mode,
          dependsOn: intent.dependsOn,
        })),
      }
    : null;

  return [
    NATURAL_VOICE_CONTRACT,
    "AUTHORITATIVE CURRENT EMERY CONTEXT:",
    JSON.stringify(compact),
    route ? `CURRENT CAPABILITY ROUTE:\n${JSON.stringify(route)}` : "",
    plan ? `CURRENT EXISTING-PLANNER PLAN:\n${JSON.stringify(plan)}` : "",
    context.loadPolicy ? `CURRENT CONTEXT LOAD POLICY:\n${JSON.stringify(context.loadPolicy)}` : "",
    context.memoryPrompt ? `SMART DURABLE MEMORY CONTEXT:\n${context.memoryPrompt}` : "",
    "Use this server-resolved context before stale client hints or natural-language inference. Structured domain truth (including HPO CRM records) outranks durable personal memory. For writes, a model interpretation is never proof of execution; only canonical controller results/receipts authorize a success confirmation.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
