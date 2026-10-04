// Phase 3 runtime surface used by EmeryVoiceControl.
//
// Session/transcript/voice-profile primitives remain in the existing Voice module,
// while operational tools are routed through the shared Current Context +
// Capability Router + existing Planner/controller bridges.
export {
  createRealtimeClientSecret,
  executeVoiceHpoRouteNote,
  getVoiceReadiness,
  persistVoiceTranscript,
  searchWebForVoice,
  updateVoiceDeliveryFromLive,
} from "@/lib/voice.functions";

export {
  executeUnifiedVoiceCalendarAction as executeVoiceCalendarAction,
  executeUnifiedVoiceHpoAction as executeVoiceHpoAction,
  executeUnifiedVoiceHpoFieldRead as executeVoiceHpoFieldRead,
  executeUnifiedVoiceHpoRouteCommand as executeVoiceHpoRouteCommand,
  executeUnifiedVoiceHpoRouteStopAction as executeVoiceHpoRouteStopAction,
  refreshUnifiedVoiceContext as refreshVoiceContext,
} from "./unified-voice.functions.ts";
