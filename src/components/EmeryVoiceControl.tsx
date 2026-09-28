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
  executeVoiceHpoRouteNote,
  getVoiceReadiness,
  persistVoiceTranscript,
  refreshVoiceContext,
  searchWebForVoice,
  updateVoiceDeliveryFromLive,
} from "@/lib/voice.functions";

type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

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
  hpoRouteId,
}: {
  onConversationChanged?: () => void;
  hpoRouteId?: string | null;
}) {
  const readReadiness = useServerFn(getVoiceReadiness);
  const mintSecret = useServerFn(createRealtimeClientSecret);
  const persistTranscript = useServerFn(persistVoiceTranscript);
  const executeCalendarAction = useServerFn(executeVoiceCalendarAction);
  const executeHpoAction = useServerFn(executeVoiceHpoAction);
  const executeHpoFieldRead = useServerFn(executeVoiceHpoFieldRead);
  const executeHpoRouteCommand = useServerFn(executeVoiceHpoRouteCommand);
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
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const savedEventsRef = useRef(new Set<string>());
  const processedToolCallsRef = useRef(new Set<string>());
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const attemptRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);

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
  }, []);

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
      if (!clean || savedEventsRef.current.has(eventKey)) return;
      savedEventsRef.current.add(eventKey);
      try {
        await persistTranscript({ data: { role, text: clean, eventKey, sessionId: sessionIdRef.current } });
        onConversationChanged?.();
      } catch (caught) {
        console.error("Voice transcript persistence failed", caught);
      }
    },
    [onConversationChanged, persistTranscript],
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

      let args: { query?: string; request?: string } = {};
      try {
        args = JSON.parse(rawArguments) as { query?: string; request?: string };
      } catch {
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
            data: { request: String(args.request ?? "") },
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

        if (name === "execute_hpo_route_command") {\n          const result = await executeHpoRouteCommand({\n            data: {\n              request: String(args.request ?? ""),\n              requestId: `voice:${sessionIdRef.current ?? "session"}:${callId}`,\n            },\n          });\n          sendToolOutput(callId, JSON.stringify(result));\n          onConversationChanged?.();\n          return;\n        }\n\n        if (name === "execute_hpo_route_note") {
          const result = await executeHpoRouteNote({
            data: {
              request: String(args.request ?? ""),
              routeId: hpoRouteId ?? null,
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
        sendToolOutput(callId, "That tool is temporarily unavailable. Answer without inventing its result.");
      }
    },
    [executeCalendarAction, executeHpoAction, executeHpoFieldRead, executeHpoRouteCommand, executeHpoRouteNote, hpoRouteId, onConversationChanged, refreshContext, searchWeb, sendToolOutput, updateVoiceDelivery],
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
          setStatus("thinking");
          break;
        case "response.output_audio.delta":
          setStatus("speaking");
          break;
        case "response.done":
          if (activeRef.current) setStatus("listening");
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (event.transcript && event.item_id) {
            void saveTranscript("user", event.transcript, `voice:user:${event.item_id}`);
          }
          break;
        case "response.output_audio_transcript.done":
          if (event.transcript && event.item_id) {
            void saveTranscript("assistant", event.transcript, `voice:assistant:${event.item_id}`);
          }
          break;
        case "response.function_call_arguments.done":
          void handleToolCall(event);
          break;
        case "response.output_item.done":
          if (event.item?.type === "function_call") void handleToolCall(event);
          break;
        case "error":
          setError(event.error?.message || "Emery Voice hit a recoverable session error.");
          if (!activeRef.current) setStatus("error");
          break;
      }
    },
    [handleToolCall, saveTranscript],
  );

  const startVoice = useCallback(async () => {
    if (activeRef.current || startingRef.current || status === "connecting") return;

    startingRef.current = true;
    const attemptId = ++attemptRef.current;
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
        const remote = event.streams[0];
        if (remote) {
          audio.srcObject = remote;
          void audio.play().catch(() => undefined);
        }
      };

      peer.onconnectionstatechange = () => {
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
        activeRef.current = true;
        setStatus("listening");
      };
      channel.onmessage = (message) => {
        try {
          handleRealtimeEvent(JSON.parse(message.data) as RealtimeEvent);
        } catch {
          console.warn("Ignored unreadable Realtime event");
        }
      };
      channel.onerror = () => {
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
  }, [closeVoice, handleRealtimeEvent, mintSecret, refreshReadiness, status]);

  const active = ["listening", "thinking", "speaking"].includes(status);

  return (
    <>
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
            ? "bg-primary text-primary-foreground shadow-[0_0_22px_rgba(41,142,255,0.28)]"
            : "text-primary/85 hover:bg-primary/[0.07]"
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
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-400 ring-2 ring-background" />
        ) : null}
      </button>

      {active ? (
        <div className="pointer-events-none fixed left-1/2 top-[max(4.4rem,env(safe-area-inset-top))] z-[80] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-primary/18 bg-background/92 px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-2xl">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/50" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            <span>
              {status === "speaking"
                ? "Emery is speaking"
                : status === "thinking"
                  ? "Emery is thinking"
                  : "Emery is listening"}
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[80] mx-auto max-w-md rounded-2xl border border-destructive/25 bg-background/96 p-3 shadow-xl backdrop-blur-2xl">
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
            className="emery-sheet-in w-full rounded-t-[1.6rem] border-t border-border/55 bg-background/98 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-md sm:rounded-2xl sm:border"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Emery Voice readiness"
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/15 sm:hidden" />
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary">
                <Mic className="size-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Voice infrastructure is ready.</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  The secure Realtime connection, same-Emery memory/history, interruption handling,
                  speech transcription, current-context refresh, and live web search are wired. The
                  remaining step is approving Emery’s final voice identity.
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
            <div className="mt-4 rounded-xl border border-primary/12 bg-primary/[0.035] p-3">
              <div className="flex items-start gap-2">
                <Search className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  Once the voice is approved, this same mic becomes the live conversation control.
                  No second assistant and no second conversation are created.
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
