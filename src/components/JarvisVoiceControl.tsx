/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic, MicOff } from "lucide-react";
import { createJarvisRealtimeSecret, sendJarvisMessage } from "@/lib/jarvis.functions";
import { toSpeakable } from "@/lib/assistant-format";
import { claimExclusiveEmeryVoice, releaseExclusiveEmeryVoice } from "@/lib/voice-session-guard";

type Status = "idle" | "connecting" | "listening" | "thinking" | "error";

type TurnResult = Awaited<ReturnType<typeof sendJarvisMessage>>;

/**
 * JARVIS Voice. Same Realtime/WebRTC pattern as Emery Voice, but a separate
 * session and voice identity. Every engineering request is routed through
 * sendJarvisMessage(channel: "voice"), so typed and spoken JARVIS are one
 * conversation with the same knowledge, task state and self-awareness.
 * Uses the shared exclusive-voice guard so Emery and JARVIS never talk over
 * each other.
 */
export function JarvisVoiceControl({ onTurn }: { onTurn: (result: TurnResult) => void }) {
  const mintSecret = useServerFn(createJarvisRealtimeSecret);
  const sendTurn = useServerFn(sendJarvisMessage);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const handledCalls = useRef(new Set<string>());

  const stop = useCallback(() => {
    channelRef.current?.close();
    peerRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.remove();
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    audioRef.current = null;
    handledCalls.current.clear();
    releaseExclusiveEmeryVoice(stop);
    setStatus("idle");
  }, []);

  useEffect(() => () => stop(), [stop]);

  const handleToolCall = useCallback(
    async (event: any) => {
      const callId = event.call_id ?? event.item?.call_id;
      const name = event.name ?? event.item?.name;
      if (!callId || name !== "jarvis_turn" || handledCalls.current.has(callId)) return;
      handledCalls.current.add(callId);
      let request = "";
      try {
        request = String(
          JSON.parse(event.arguments ?? event.item?.arguments ?? "{}").request ?? "",
        );
      } catch {
        request = "";
      }
      setStatus("thinking");
      let output = "JARVIS could not complete that turn.";
      try {
        const result = await sendTurn({
          data: { message: request || "(inaudible request)", channel: "voice" },
        });
        onTurn(result);
        // The full written answer stays in the shared thread; Voice gets it
        // without markdown symbols so nothing like "hash hash" is ever spoken.
        output = toSpeakable(result.agentMessage?.content ?? result.error ?? output) || output;
      } catch (caught) {
        console.error(caught);
      }
      const channel = channelRef.current;
      if (channel?.readyState === "open") {
        channel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output: output.slice(0, 6000) },
          }),
        );
        channel.send(JSON.stringify({ type: "response.create" }));
      }
      setStatus("listening");
    },
    [onTurn, sendTurn],
  );

  const start = useCallback(async () => {
    setError(null);
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      setError("This browser does not support a realtime microphone connection.");
      setStatus("error");
      return;
    }
    setStatus("connecting");
    claimExclusiveEmeryVoice(stop);
    try {
      const token = await mintSecret();
      if (!("clientSecret" in token) || !token.clientSecret)
        throw new Error("error" in token ? token.error : "Voice session unavailable.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audio.style.display = "none";
      document.body.appendChild(audio);
      audioRef.current = audio;
      peer.ontrack = (event) => {
        if (event.streams[0]) {
          audio.srcObject = event.streams[0];
          void audio.play().catch(() => undefined);
        }
      };
      peer.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) stop();
      };
      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onopen = () => setStatus("listening");
      channel.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data);
          if (event.type === "response.function_call_arguments.done") void handleToolCall(event);
          else if (
            event.type === "response.output_item.done" &&
            event.item?.type === "function_call"
          )
            void handleToolCall(event);
          else if (
            event.type === "error" &&
            !/cancel|no active response/i.test(event.error?.message ?? "")
          )
            setError(event.error?.message ?? "Voice error");
        } catch {
          /* ignore unreadable events */
        }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdp = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(token.model)}`,
        {
          method: "POST",
          body: offer.sdp ?? null,
          headers: {
            Authorization: `Bearer ${token.clientSecret}`,
            "Content-Type": "application/sdp",
          },
        },
      );
      if (!sdp.ok) throw new Error("The secure realtime voice connection was rejected.");
      await peer.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
    } catch (caught) {
      console.error(caught);
      stop();
      setError(caught instanceof Error ? caught.message : "JARVIS Voice could not start.");
      setStatus("error");
    }
  }, [handleToolCall, mintSecret, stop]);

  const active = status === "listening" || status === "thinking" || status === "connecting";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (active ? stop() : void start())}
        aria-label={active ? "Stop JARVIS Voice" : "Talk to JARVIS"}
        aria-pressed={active}
        className={`emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl border ${active ? "border-primary/40 bg-primary/15 text-primary" : "border-border/50 bg-card/40 text-muted-foreground"}`}
      >
        {status === "connecting" || status === "thinking" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : active ? (
          <MicOff className="size-4" />
        ) : (
          <Mic className="size-4" />
        )}
      </button>
      {error ? (
        <span className="max-w-[10rem] truncate text-[10px] text-destructive" role="alert">
          {error}
        </span>
      ) : status === "listening" ? (
        <span className="text-[10px] text-muted-foreground" aria-live="polite">
          Listening…
        </span>
      ) : null}
    </div>
  );
}
