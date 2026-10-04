/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildEmeryContext, type EmeryContextSnapshot } from "./context-engine.ts";
import { prepareEmeryRequestRouting, type PreparedEmeryRequestRouting } from "./request-routing.ts";
import type { RegisteredCapabilityAction } from "./capability-registry.ts";
import type { RequestContext } from "./orchestration.types.ts";

export type VoiceUiContext = {
  surface?: string | null;
  routeId?: string | null;
  stopId?: string | null;
  accountId?: string | null;
  prospectId?: string | null;
  location?: RequestContext["location"];
};

export type PreparedVoiceRequest = {
  currentContext: EmeryContextSnapshot;
  routing: PreparedEmeryRequestRouting;
  resolved: {
    routeId: string | null;
    stopId: string | null;
    accountId: string | null;
    prospectId: string | null;
  };
};

/**
 * Shared Phase 3 bridge for Voice requests.
 *
 * Voice must use the same authoritative current-context engine and the same
 * capability-router -> existing-planner adapter as Text. This helper performs
 * no business writes. Canonical controllers remain the only write authority.
 */
export async function prepareVoiceRequest(input: {
  db: any;
  userId: string;
  message: string;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  timezone?: string | null;
  ui?: VoiceUiContext | null;
}): Promise<PreparedVoiceRequest> {
  const currentContext = await buildEmeryContext({
    db: input.db,
    userId: input.userId,
    message: input.message,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    entryPoint: "voice",
    inputMode: "voice",
    surface: input.ui?.surface ?? null,
    timezone: input.timezone ?? null,
    hpoRouteId: input.ui?.routeId ?? null,
    hpoStopId: input.ui?.stopId ?? null,
    selectedAccountId: input.ui?.accountId ?? null,
    selectedProspectId: input.ui?.prospectId ?? null,
    location: input.ui?.location ?? null,
  });

  const routing = prepareEmeryRequestRouting({
    message: input.message,
    context: currentContext.request,
    domainHint: currentContext.domain,
  });

  return {
    currentContext,
    routing,
    resolved: {
      routeId: currentContext.request.currentRouteId,
      stopId: currentContext.request.currentStopId,
      accountId: currentContext.request.selectedAccountId,
      prospectId: currentContext.request.selectedProspectId,
    },
  };
}

export function voiceCapabilityAllows(
  prepared: PreparedVoiceRequest,
  action: RegisteredCapabilityAction,
): boolean {
  return prepared.routing.capabilityRoute.candidateCapabilities.includes(action);
}
