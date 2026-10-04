// Phase 3 runtime surface used by EmeryVoiceControl.
//
// Transcript/voice-profile primitives remain in the existing Voice module,
// while Realtime bootstrap and operational tools use the shared Current Context +
// Capability Router + existing Planner/controller bridges.
export {
  executeVoiceHpoRouteNote,
  getVoiceReadiness,
  persistVoiceTranscript,
  searchWebForVoice,
  updateVoiceDeliveryFromLive,
} from "@/lib/voice.functions";

export { createUnifiedRealtimeClientSecret as createRealtimeClientSecret } from "./unified-realtime.functions.ts";

export {
  executeUnifiedVoiceCalendarAction as executeVoiceCalendarAction,
  executeUnifiedVoiceHpoAction as executeVoiceHpoAction,
  executeUnifiedVoiceHpoFieldRead as executeVoiceHpoFieldRead,
  executeUnifiedVoiceHpoRouteCommand as executeVoiceHpoRouteCommand,
  executeUnifiedVoiceHpoRouteStopAction as executeVoiceHpoRouteStopAction,
  refreshUnifiedVoiceContext as refreshVoiceContext,
} from "./unified-voice.functions.ts";
