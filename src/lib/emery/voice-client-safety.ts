export type RealtimeControlChannel = Pick<RTCDataChannel, "readyState" | "send">;

function send(channel: RealtimeControlChannel | null | undefined, event: Record<string, unknown>) {
  if (!channel || channel.readyState !== "open") return false;
  try {
    channel.send(JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}

/**
 * WebRTC + VAD already cancels/truncates normal barge-in server-side.
 * This explicit control is for a spoken "stop/hold on" command or echo fallback.
 */
export function stopCurrentRealtimeSpeech(channel: RealtimeControlChannel | null | undefined) {
  const cancelled = send(channel, { type: "response.cancel" });
  const cleared = send(channel, { type: "output_audio_buffer.clear" });
  return cancelled || cleared;
}

export function clearRealtimeOutput(channel: RealtimeControlChannel | null | undefined) {
  return send(channel, { type: "output_audio_buffer.clear" });
}

export function voiceEventBelongsToAttempt(currentAttempt: number, eventAttempt: number) {
  return currentAttempt === eventAttempt;
}
