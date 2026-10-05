import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic, MicOff, Radio, Search, X } from "lucide-react";
import { claimExclusiveEmeryVoice, releaseExclusiveEmeryVoice } from "@/lib/voice-session-guard";
import {
  createRealtimeClientSecret,
  executeVoiceCalendarAction,
  executeVoiceHpoAction,
  executeVoiceHpoFieldRead,
  executeVoiceHpoRouteCommand,
  executeVoiceHpoRouteStopAction,
  executeVoiceHpoRouteNote,
  getVoiceReadiness,
  persistVoiceTranscript,
  refreshVoiceContext,
  searchWebForVoice,
  updateVoiceDeliveryFromLive,
} from "@/lib/emery/voice-runtime";
import {
  VOICE_FOLLOW_UP_WINDOW_MS,
  classifyVoiceTurn,
} from "@/lib/emery/voice-conversation-policy";
import {
  stopCurrentRealtimeSpeech,
  voiceEventBelongsToAttempt,
} from "@/lib/emery/voice-client-safety";
import { useAmbientContext } from "@/lib/emery/use-ambient-context";
import { EmeryAmbientContextToggle } from "@/components/EmeryAmbientContextToggle";
import { EmeryBrainCore } from "@/components/emery-visual/EmeryBrainCore";
import { EmeryStateLabel } from "@/components/emery-visual/EmeryStateLabel";
import type { EmeryVisualState } from "@/components/emery-visual/emery-visual.types";

type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

function visualStateForVoiceStatus(status: VoiceStatus): EmeryVisualState {
  if (status === "connecting") return "syncing";
  if (status === "listening") return "listening";
  if (status === "thinking") return "thinking";
  if (status === "speaking") return "speaking";
  if (status === "error") return "error";
  return "idle";
}

function visualStateForTool(name: string): EmeryVisualState {
  if (name === "search_web") return "searching";
  if (name === "refresh_emery_context" || name === "get_hpo_field_state") return "remembering";
  if (name === "execute_hpo_route_command") return "planning";
  if (name === "update_voice_delivery") return "syncing";
  if (
    [
      "execute_calendar_action",
      "execute_hpo_action",
      "execute_hpo_route_stop_action",
      "execute_hpo_route_note",
    ].includes(name)
  ) {
    return "executing";
  }
  return "using_tool";
}

async function currentHpoVoiceLocation(request: string) {
  if (
    !/\b(from here|where i am|current location|remaining|rest of (?:the )?route|nearby|backup|within \d{1,2} minutes?|where should i go|where can i go|minutes? left)\b/i.test(
      request,
    )
  ) {
    return { latitude: null as number | null, longitude: null as number | null };
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { latitude: null as number | null, longitude: null as number | null };
  }
  return new Promise<{ latitude: number | null; longitude: number | null }>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve({ latitude: null, longitude: null }),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 5000 },
    );
  });
}

type RealtimeEvent = {
  type?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  transcript?: string;
  error?: { message?: string };
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  [key: string]: unknown;
};

export function EmeryVoiceControl({
  onConversationChanged,
  onVisualStateChange,
  hpoRouteId,
  hpoStopId,
  hpoAccountId,
  variant = "icon",
  persistTranscript: shouldPersistTranscript = true,
  openingBrief = false,
}: {
  onConversationChanged?: () => void;
  onVisualStateChange?: (state: EmeryVisualState) => void;
  hpoRouteId?: string | null;
  hpoStopId?: string | null;
  hpoAccountId?: string | null;
  variant?: "icon" | "core";
  persistTranscript?: boolean;
  openingBrief?: boolean;
}) {
  const readReadiness = useServerFn(getVoiceReadiness);
  const mintSecret = useServerFn(createRealtimeClientSecret);
  const persistTranscript = useServerFn(persistVoiceTranscript);
  const executeCalendarAction = useServerFn(executeVoiceCalendarAction);
  const executeHpoAction = useServerFn(executeVoiceHpoAction);
  const executeHpoFieldRead = useServerFn(executeVoiceHpoFieldRead);
  const executeHpoRouteCommand = useServerFn(executeVoiceHpoRouteCommand);
  const executeHpoRouteStopAction = useServerFn(executeVoiceHpoRouteStopAction);
  const executeHpoRouteNote = useServerFn(executeVoiceHpoRouteNote);
  const searchWeb = useServerFn(searchWebForVoice);
  const refreshContext = useServerFn(refreshVoiceContext);
  const updateVoiceDelivery = useServerFn(updateVoiceDeliveryFromLive);

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [ready, setReady] = useState<boolean | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const ambient = useAmbientContext(() => channelRef.current);
  const resetAmbient = ambient.reset;
  const handleAmbientTranscript = ambient.handleTranscript;
  const applyAmbientMode = ambient.applyMode;
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const savedEventsRef = useRef(new Set<string>());
  const processedToolCallsRef = useRef(new Set<string>());
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const attemptRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const responseActiveRef = useRef(false);
  const lastAssistantTranscriptRef = useRef("");
  const lastAssistantAtRef = useRef(0);
  const followUpUntilRef = useRef(0);
  const openingSentRef = useRef(false);

  useEffect(() => {
    onVisualStateChange?.(visualStateForVoiceStatus(status));
  }, [onVisualStateChange, status]);

  const refreshReadiness = useCallback(async () => {
    try {
      const result = await readReadiness({});
      setReady(Boolean(result.canStart));
      setSelectedVoice(result.selectedVoice ?? null);
      return result;
    } catch {
      setReady(false);
      return null;
    }
  }, [readReadiness]);

  useEffect(() => {
    void refreshReadiness();
  }, [refreshReadiness]);

  useEffect(() => {
    const handleProfileUpdate = () => {
      void refreshReadiness();
    };
    window.addEventListener("emery-voice-profile-updated", handleProfileUpdate);
    return () => window.removeEventListener("emery-voice-profile-updated", handleProfileUpdate);
  }, [refreshReadiness]);

  const closeVoice = useCallback(() => {
    attemptRef.current += 1;
    startingRef.current = false;
    activeRef.current = false;
    responseActiveRef.current = false;
    lastAssistantTranscriptRef.current = "";
    lastAssistantAtRef.current = 0;
    followUpUntilRef.current = 0;
    openingSentRef.current = false;
    resetAmbient();

    const channel = channelRef.current;
    channelRef.current = null;
    channel?.close();

    const peer = peerRef.current;
    peerRef.current = null;
    peer?.getSenders().forEach((sender) => sender.track?.stop());
    peer?.close();

    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }

    sessionIdRef.current = null;
    savedEventsRef.current.clear();
    processedToolCallsRef.current.clear();
    releaseExclusiveEmeryVoice(closeVoice);
    setStatus("idle");
  }, [resetAmbient]);

  useEffect(() => closeVoice, [closeVoice]);

  useEffect(() => {
    const stopOnPageExit = () => closeVoice();
    window.addEventListener("pagehide", stopOnPageExit);
    window.addEventListener("beforeunload", stopOnPageExit);
    return () => {
      window.removeEventListener("pagehide", stopOnPageExit);
      window.removeEventListener("beforeunload", stopOnPageExit);
    };
  }, [closeVoice]);

  const saveTranscript = useCallback(
    async (role: "user" | "assistant", text: string, eventKey: string) => {
      const clean = text.trim();
      if (!shouldPersistTranscript || !clean || savedEventsRef.current.has(eventKey)) return;
      savedEventsRef.current.add(eventKey);
      try {
        await persistTranscript({
          data: { role, text: clean, eventKey, sessionId: sessionIdRef.current },
        });
        onConversationChanged?.();
      } catch (caught) {
        console.error("Voice transcript persistence failed", caught);
      }
    },
    [onConversationChanged, persistTranscript, shouldPersistTranscript],
  );

  const sendToolOutput = useCallback((callId: string, output: string) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return;
    channel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output,
        },
      }),
    );
    channel.send(JSON.stringify({ type: "response.create" }));
  }, []);

  const handleToolCall = useCallback(
    async (event: RealtimeEvent) => {
      const callId = event.call_id ?? event.item?.call_id;
      const name = event.name ?? event.item?.name;
      const rawArguments = event.arguments ?? event.item?.arguments ?? "{}";
      if (!callId || !name || processedToolCallsRef.current.has(callId)) return;
      processedToolCallsRef.current.add(callId);
      onVisualStateChange?.(visualStateForTool(name));

      let args: { query?: string; request?: string } = {};
      try {
        args = JSON.parse(rawArguments) as { query?: string; request?: string };
      } catch {
        onVisualStateChange?.("error");
        sendToolOutput(callId, "The tool arguments were invalid. Ask Adam briefly to retry.");
        return;
      }

      try {
        if (name === "execute_calendar_action") {
          const result = await executeCalendarAction({
            data: {
              request: String(args.request ?? ""),
              idempotencyKey: `voice:${sessionIdRef.current ?? "session"}:${callId}`,
            },
          });
          sendToolOutput(callId, JSON.stringify(result));
          onConversationChanged?.();
          return;
        }

        if (name === "execute_hpo_action") {
          const result = await executeHpoAction({
            data: {
              request: String(args.request ?? ""),
              accountId: hpoAccountId ?? null,
            },
          });
          sendToolOutput(callId, JSON.stringify(result));
          onConversationChanged?.();
          return;
        }

        if (name === "get_hpo_field_state") {
          const result = await executeHpoFieldRead({
            data: { request: String(args.request ?? "") },
          });
          sendToolOutput(callId, JSON.stringify(result));
          return;
        }

        if (name === "execute_hpo_route_command") {
          const request = String(args.request ?? "");
          const location = await currentHpoVoiceLocation(request);
          const result = await executeHpoRouteCommand({
            data: {
              request,
              requestId: `voice:${sessionIdRef.current ?? "session"}:${callId}`,
              latitude: location.latitude,
              longitude: location.longitude,
            },
          });
          sendToolOutput(callId, JSON.stringify(result));
          onConversationChanged?.();
          return;
        }

        if (name === "execute_hpo_route_stop_action") {
          const result = await executeHpoRouteStopAction({
            data: {
              request: String(args.request ?? ""),
              requestId: `voice:${sessionIdRef.current ?? "session"}:${callId}`,
              routeId: hpoRouteId ?? null,
              stopId: hpoStopId ?? null,
            },
          });
          sendToolOutput(callId, JSON.stringify(result));
          onConversationChanged?.();
          return;
        }

        if (name === "execute_hpo_route_note") {
          const result = await executeHpoRouteNote({
            data: {
              request: String(args.request ?? ""),
              routeId: hpoRouteId ?? null,
              stopId: hpoStopId ?? null,
              requestId: `voice:${sessionIdRef.current ?? "session"}:${callId}`,
            },
          });
          sendToolOutput(callId, JSON.stringify(result));
          onConversationChanged?.();
          return;
        }

        if (name === "search_web") {
          const result = await searchWeb({ data: { query: String(args.query ?? "") } });
          sendToolOutput(
            callId,
            "result" in result
              ? result.result
              : "error" in result
                ? result.error
                : "Live web search returned no result.",
          );
          return;
        }

        if (name === "update_voice_delivery") {
          const raw = JSON.parse(rawArguments) as {
            request?: string;
            pace?: number;
            warmth?: number;
            expressiveness?: number;
            energy?: number;
            brevity?: number;
            accent_intensity?: number;
            accent_description?: string;
            style_note?: string;
          };
          const deliveryData: {
            request: string;
            pace?: number;
            warmth?: number;
            expressiveness?: number;
            energy?: number;
            brevity?: number;
            accentIntensity?: number;
            accentDescription?: string;
            styleNote?: string;
          } = { request: String(raw.request ?? "Live voice-delivery update") };
          if (typeof raw.pace === "number") deliveryData.pace = raw.pace;
          if (typeof raw.warmth === "number") deliveryData.warmth = raw.warmth;
          if (typeof raw.expressiveness === "number") {
            deliveryData.expressiveness = raw.expressiveness;
          }
          if (typeof raw.energy === "number") deliveryData.energy = raw.energy;
          if (typeof raw.brevity === "number") deliveryData.brevity = raw.brevity;
          if (typeof raw.accent_intensity === "number") {
            deliveryData.accentIntensity = raw.accent_intensity;
          }
          if (typeof raw.accent_description === "string" && raw.accent_description.trim()) {
            deliveryData.accentDescription = raw.accent_description.trim();
          }
          if (typeof raw.style_note === "string" && raw.style_note.trim()) {
            deliveryData.styleNote = raw.style_note.trim();
          }

          const result = await updateVoiceDelivery({ data: deliveryData });
          if ("ok" in result && result.ok && typeof result.speed === "number") {
            const channel = channelRef.current;
            if (channel?.readyState === "open") {
              channel.send(
                JSON.stringify({
                  type: "session.update",
                  session: { type: "realtime", audio: { output: { speed: result.speed } } },
                }),
              );
            }
          }
          sendToolOutput(
            callId,
            "ok" in result && result.ok
              ? result.note
              : "error" in result
                ? result.error
                : "Voice delivery could not be updated.",
          );
          return;
        }

        if (name === "refresh_emery_context") {
          const result = await refreshContext({ data: { query: String(args.query ?? "") } });
          sendToolOutput(
            callId,
            "result" in result ? result.result : "Current Emery context could not be refreshed.",
          );
          return;
        }

        sendToolOutput(callId, `Unknown tool: ${name}`);
      } catch {
        onVisualStateChange?.("error");
        sendToolOutput(
          callId,
          "That tool is temporarily unavailable. Answer without inventing its result.",
        );
      }
    },
    [
      executeCalendarAction,
      executeHpoAction,
      executeHpoFieldRead,
      executeHpoRouteCommand,
      executeHpoRouteStopAction,
      executeHpoRouteNote,
      hpoRouteId,
      hpoStopId,
      hpoAccountId,
      onConversationChanged,
      onVisualStateChange,
      refreshContext,
      searchWeb,
      sendToolOutput,
      updateVoiceDelivery,
    ],
  );

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case "session.created":
        case "session.updated":
          setStatus("listening");
          break;
        case "input_audio_buffer.speech_started":
          setStatus("listening");
          break;
        case "input_audio_buffer.speech_stopped":
          setStatus("thinking");
          break;
        case "response.created":
          responseActiveRef.current = true;
          setStatus("thinking");
          break;
        case "response.output_audio.delta":
          responseActiveRef.current = true;
          setStatus("speaking");
          break;
        case "response.cancelled":
          responseActiveRef.current = false;
          if (activeRef.current) setStatus("listening");
          break;
        case "response.done":
          responseActiveRef.current = false;
          followUpUntilRef.current = Date.now() + VOICE_FOLLOW_UP_WINDOW_MS;
          if (activeRef.current) setStatus("listening");
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (event.transcript && event.item_id) {
            const ambientResult = handleAmbientTranscript({
              itemId: event.item_id,
              transcript: event.transcript,
            });
            if (ambientResult.handled) {
              if (ambientResult.clientCommand === "stop_speaking") {
                if (responseActiveRef.current) stopCurrentRealtimeSpeech(channelRef.current);
                responseActiveRef.current = false;
                followUpUntilRef.current = Date.now() + VOICE_FOLLOW_UP_WINDOW_MS;
                setStatus("listening");
                return;
              }
              if (ambientResult.clientCommand === "end_session") {
                if (responseActiveRef.current) stopCurrentRealtimeSpeech(channelRef.current);
                closeVoice();
                return;
              }
              if (ambientResult.persistTranscript) {
                void saveTranscript("user", event.transcript, `voice:user:${event.item_id}`);
              }
              if (ambientResult.addressed) setStatus("thinking");
              return;
            }

            const disposition = classifyVoiceTurn({
              transcript: event.transcript,
              lastAssistantTranscript: lastAssistantTranscriptRef.current,
              lastAssistantAt: lastAssistantAtRef.current,
              followUpUntil: followUpUntilRef.current,
            });

            if (disposition === "likely_echo") {
              if (responseActiveRef.current) stopCurrentRealtimeSpeech(channelRef.current);
              responseActiveRef.current = false;
              setStatus("listening");
              return;
            }

            if (disposition === "stop_speaking") {
              if (responseActiveRef.current) stopCurrentRealtimeSpeech(channelRef.current);
              responseActiveRef.current = false;
              followUpUntilRef.current = Date.now() + VOICE_FOLLOW_UP_WINDOW_MS;
              setStatus("listening");
              return;
            }

            if (disposition === "end_session") {
              if (responseActiveRef.current) stopCurrentRealtimeSpeech(channelRef.current);
              closeVoice();
              return;
            }

            if (disposition === "correction" || disposition === "short_follow_up") {
              followUpUntilRef.current = Date.now() + VOICE_FOLLOW_UP_WINDOW_MS;
            }

            void saveTranscript("user", event.transcript, `voice:user:${event.item_id}`);
          }
          break;
        case "response.output_audio_transcript.done":
          if (event.transcript && event.item_id) {
            lastAssistantTranscriptRef.current = event.transcript.trim();
            lastAssistantAtRef.current = Date.now();
            followUpUntilRef.current = Date.now() + VOICE_FOLLOW_UP_WINDOW_MS;
            void saveTranscript("assistant", event.transcript, `voice:assistant:${event.item_id}`);
          }
          break;
        case "response.function_call_arguments.done":
          void handleToolCall(event);
          break;
        case "response.output_item.done":
          if (event.item?.type === "function_call") void handleToolCall(event);
          break;
        case "error": {
          const message = event.error?.message || "Emery Voice hit a recoverable session error.";
          const expectedCancellation = /cancel|no active response|output audio buffer/i.test(
            message,
          );
          if (expectedCancellation && activeRef.current) {
            setStatus("listening");
            break;
          }
          setError(message);
          if (!activeRef.current) setStatus("error");
          break;
        }
      }
    },
    [closeVoice, handleAmbientTranscript, handleToolCall, saveTranscript],
  );

  const startVoice = useCallback(async () => {
    if (activeRef.current || startingRef.current || status === "connecting") return;

    startingRef.current = true;
    const attemptId = ++attemptRef.current;
    responseActiveRef.current = false;
    lastAssistantTranscriptRef.current = "";
    lastAssistantAtRef.current = 0;
    followUpUntilRef.current = 0;
    setError(null);
    setStatus("connecting");

    const isCurrentAttempt = () => attemptRef.current === attemptId;
    const abortIfSuperseded = () => {
      if (isCurrentAttempt()) return false;
      startingRef.current = false;
      return true;
    };

    const readiness = await refreshReadiness();
    if (abortIfSuperseded()) return;
    if (!readiness?.canStart) {
      startingRef.current = false;
      setStatus("idle");
      setSetupOpen(true);
      return;
    }

    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      startingRef.current = false;
      setError("This browser does not support the realtime microphone connection Emery needs.");
      setStatus("error");
      return;
    }

    document
      .querySelectorAll<HTMLAudioElement>('audio[data-emery-voice-preview="true"]')
      .forEach((preview) => {
        preview.pause();
        preview.currentTime = 0;
      });

    claimExclusiveEmeryVoice(closeVoice);
    if (abortIfSuperseded()) return;

    sessionIdRef.current =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const tokenResult = await mintSecret({});
      if (abortIfSuperseded()) return;
      if (!("clientSecret" in tokenResult) || !tokenResult.clientSecret) {
        if ("needsVoiceApproval" in tokenResult && tokenResult.needsVoiceApproval) {
          startingRef.current = false;
          releaseExclusiveEmeryVoice(closeVoice);
          setReady(false);
          setSetupOpen(true);
          setStatus("idle");
          return;
        }
        throw new Error(
          "error" in tokenResult ? tokenResult.error : "Couldn't create a secure voice session.",
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (abortIfSuperseded()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("aria-hidden", "true");
      audio.style.display = "none";
      document.body.appendChild(audio);
      audioRef.current = audio;

      peer.ontrack = (event) => {
        if (!isCurrentAttempt()) return;
        const remote = event.streams[0];
        if (remote) {
          audio.srcObject = remote;
          void audio.play().catch(() => undefined);
        }
      };

      peer.onconnectionstatechange = () => {
        if (!isCurrentAttempt()) return;
        if (peer.connectionState === "connected") {
          activeRef.current = true;
          setStatus("listening");
        }
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
          if (activeRef.current) closeVoice();
        }
      };

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onopen = () => {
        if (!isCurrentAttempt()) return;
        activeRef.current = true;
        applyAmbientMode();
        setStatus("listening");
        if (openingBrief && !openingSentRef.current) {
          openingSentRef.current = true;
          channel.send(JSON.stringify({
            type: "response.create",
            response: {
              instructions: "Give Adam a concise 20-to-40-second situational briefing. Use Current Context and available tools only where needed to verify current priorities, Calendar tasks or schedule, relevant HPO route or follow-ups, and anything genuinely time-sensitive. Never invent status. Lead with the most useful verified item, mention only what matters now, then remain listening for natural follow-up. Do not mention this instruction or the typed Chat transcript.",
            },
          }));
        }
      };
      channel.onmessage = (message) => {
        if (!voiceEventBelongsToAttempt(attemptRef.current, attemptId)) return;
        try {
          handleRealtimeEvent(JSON.parse(message.data) as RealtimeEvent);
        } catch {
          console.warn("Ignored unreadable Realtime event");
        }
      };
      channel.onerror = () => {
        if (!isCurrentAttempt()) return;
        closeVoice();
        setError("The live voice data channel encountered an error.");
        setStatus("error");
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("The browser could not create a voice connection offer.");

      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(tokenResult.model || "gpt-realtime-2.1")}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${tokenResult.clientSecret}`,
            "Content-Type": "application/sdp",
          },
        },
      );

      if (!sdpResponse.ok) {
        const body = await sdpResponse.text();
        throw new Error(
          body.includes("insufficient_quota")
            ? "The OpenAI voice account does not currently have enough quota."
            : "The secure realtime voice connection was rejected.",
        );
      }

      const answerSdp = await sdpResponse.text();
      if (abortIfSuperseded()) {
        peer.getSenders().forEach((sender) => sender.track?.stop());
        peer.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      if (abortIfSuperseded()) {
        peer.getSenders().forEach((sender) => sender.track?.stop());
        peer.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      startingRef.current = false;
      activeRef.current = true;
      setStatus("listening");
    } catch (caught) {
      const stillCurrent = isCurrentAttempt();
      closeVoice();
      if (!stillCurrent) return;
      const message =
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Microphone permission is off. Allow microphone access for Emery, then try again."
          : caught instanceof Error
            ? caught.message
            : "Emery Voice could not start.";
      setError(message);
      setStatus("error");
    }
  }, [applyAmbientMode, closeVoice, handleRealtimeEvent, mintSecret, openingBrief, refreshReadiness, status]);

  const active = ["listening", "thinking", "speaking"].includes(status);

  return (
    <>
      {variant === "core" ? (
        <button
          type="button"
          onClick={() => { if (active) closeVoice(); else void startVoice(); }}
          aria-label={active ? "End Emery Voice" : "Tap Emery to begin"}
          aria-pressed={active}
          disabled={status === "connecting"}
          className="emery-core-trigger emery-press group relative flex min-h-[290px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-live/20 px-4 py-5 text-center disabled:cursor-wait"
        >
          <span className="emery-grid pointer-events-none absolute inset-0 opacity-80" aria-hidden="true" />
          <span className="relative z-10 mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-live">Emery Core</span>
          <span className="relative z-10 text-[10px] font-medium uppercase tracking-[0.1em] text-secondary-foreground">Personal Intelligence</span>
          <EmeryBrainCore state={visualStateForVoiceStatus(status)} className="relative z-10 my-1 size-[190px] sm:size-[214px]" />
          <span className="relative z-10"><EmeryStateLabel state={visualStateForVoiceStatus(status)} /></span>
          <span className="relative z-10 mt-2 text-sm font-semibold text-foreground">{status === "connecting" ? "Connecting…" : active ? "Tap to end session" : error ? "Tap to try again" : "Tap Emery to begin"}</span>
          <span className="relative z-10 mt-1 text-[11px] text-muted-foreground">Voice briefing, then natural follow-up</span>
        </button>
      ) : (
      <button
        type="button"
        onClick={() => {
          if (active) closeVoice();
          else void startVoice();
        }}
        aria-label={active ? "End Emery Voice" : "Start Emery Voice"}
        title={
          ready === false
            ? "Emery Voice is wired — approve her final voice next"
            : active
              ? "End Emery Voice"
              : "Start Emery Voice"
        }
        disabled={status === "connecting"}
        className={`emery-press relative flex size-11 shrink-0 items-center justify-center rounded-xl transition disabled:cursor-wait disabled:opacity-70 ${
          active
            ? "bg-live text-background shadow-[0_0_26px_rgba(34,211,238,0.24)]"
            : "text-live hover:bg-live/[0.08]"
        }`}
      >
        {status === "connecting" ? (
          <Loader2 className="size-[18px] animate-spin" />
        ) : active ? (
          <MicOff className="size-[18px]" strokeWidth={1.9} />
        ) : (
          <Mic className="size-[18px]" strokeWidth={1.9} />
        )}
        {ready === false && !active ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning ring-2 ring-background" />
        ) : null}
      </button>
      )}

      {active && variant === "icon" ? (
        <div className="pointer-events-none fixed left-1/2 top-[max(4.4rem,env(safe-area-inset-top))] z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
          <div className="emery-glass flex items-center gap-2 rounded-full border border-live/20 px-3 py-2 text-xs font-medium text-foreground shadow-lg">
            <span className="emery-status-pulse size-2 rounded-full bg-live" />
            <span>
              {status === "speaking"
                ? "Emery is speaking"
                : status === "thinking"
                  ? "Emery is thinking"
                  : "Emery is listening"}
            </span>
          </div>
          <EmeryAmbientContextToggle
            enabled={ambient.enabled}
            snippetCount={ambient.snippetCount}
            onToggle={ambient.toggle}
          />
        </div>
      ) : null}

      {error ? (
        <div className="emery-panel-elevated fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[80] mx-auto max-w-md rounded-2xl border border-destructive/25 p-3 shadow-xl">
          <div className="flex items-start gap-2">
            <Radio className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-foreground/90">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                if (status === "error") setStatus("idle");
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
              aria-label="Dismiss voice error"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      {setupOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-end bg-black/60 backdrop-blur-sm"
          onClick={() => setSetupOpen(false)}
          role="presentation"
        >
          <section
            className="emery-sheet-in emery-panel-elevated w-full rounded-t-[1.6rem] border-t border-border/55 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-md sm:rounded-2xl sm:border"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Emery Voice readiness"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/15 sm:hidden" />
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-live/10 text-live">
                <Mic className="size-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Voice infrastructure is ready.</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Secure Realtime voice shares this same Emery conversation, memory, current context,
                  actions and tools. Approve the final voice identity before the first live session.
                </p>
                {selectedVoice ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Stored voice: <span className="text-foreground">{selectedVoice}</span> · awaiting approval
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSetupOpen(false)}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-live/15 bg-live/[0.04] p-3">
              <div className="flex items-start gap-2">
                <Search className="mt-0.5 size-3.5 shrink-0 text-live" />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  Once approved, this microphone becomes the live control for the same Emery Core shown
                  in Chat. There is no second assistant and no second conversation.
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
