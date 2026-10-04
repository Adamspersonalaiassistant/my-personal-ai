export const VOICE_FOLLOW_UP_WINDOW_MS = 18_000;
export const VOICE_ECHO_WINDOW_MS = 8_000;

export type VoiceTurnDisposition =
  | "normal"
  | "correction"
  | "short_follow_up"
  | "stop_speaking"
  | "end_session"
  | "likely_echo";

export function normalizeVoiceText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVoiceEndSessionCommand(value: string) {
  const text = normalizeVoiceText(value);
  return /^(end voice|end the voice|stop listening|close voice|exit voice|end conversation|end the conversation|goodbye emery|bye emery)$/.test(
    text,
  );
}

export function isVoiceStopSpeakingCommand(value: string) {
  const text = normalizeVoiceText(value);
  if (isVoiceEndSessionCommand(text)) return false;
  return /^(stop|stop talking|hold on|hang on|wait|wait a second|one second|quiet|thats enough|enough)$/.test(
    text,
  );
}

export function isVoiceCorrectionTurn(value: string) {
  const text = normalizeVoiceText(value);
  return /^(actually\b|correction\b|sorry\b|no i meant\b|i meant\b|make that\b|not .+ make it\b|change that to\b|instead\b)/.test(
    text,
  );
}

export function isShortContextualVoiceFollowUp(value: string) {
  const text = normalizeVoiceText(value);
  if (!text) return false;
  const words = text.split(" ").filter(Boolean);
  if (words.length <= 7) {
    if (
      /\b(there|here|that|this|she|he|they|them|it|next|same|again|do that|take me there|what did she say|what did he say|what did they say)\b/.test(
        text,
      )
    ) {
      return true;
    }
  }
  return isVoiceCorrectionTurn(text);
}

function tokenSet(value: string) {
  return new Set(
    normalizeVoiceText(value)
      .split(" ")
      .filter((token) => token.length >= 2),
  );
}

export function voiceTranscriptSimilarity(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function isLikelyAssistantVoiceEcho(input: {
  userTranscript: string;
  assistantTranscript: string;
  assistantTranscriptAgeMs: number;
}) {
  const user = normalizeVoiceText(input.userTranscript);
  const assistant = normalizeVoiceText(input.assistantTranscript);
  if (!user || !assistant) return false;
  if (input.assistantTranscriptAgeMs < 0 || input.assistantTranscriptAgeMs > VOICE_ECHO_WINDOW_MS) {
    return false;
  }
  if (user.length < 12 || assistant.length < 12) return false;
  if (user === assistant) return true;
  if (user.length >= 24 && assistant.includes(user)) return true;
  if (assistant.length >= 24 && user.includes(assistant)) return true;
  return voiceTranscriptSimilarity(user, assistant) >= 0.82;
}

export function classifyVoiceTurn(input: {
  transcript: string;
  lastAssistantTranscript?: string | null;
  lastAssistantAt?: number | null;
  now?: number;
  followUpUntil?: number | null;
}): VoiceTurnDisposition {
  const now = input.now ?? Date.now();
  if (isVoiceEndSessionCommand(input.transcript)) return "end_session";
  if (isVoiceStopSpeakingCommand(input.transcript)) return "stop_speaking";
  if (
    input.lastAssistantTranscript &&
    input.lastAssistantAt &&
    isLikelyAssistantVoiceEcho({
      userTranscript: input.transcript,
      assistantTranscript: input.lastAssistantTranscript,
      assistantTranscriptAgeMs: now - input.lastAssistantAt,
    })
  ) {
    return "likely_echo";
  }
  if (isVoiceCorrectionTurn(input.transcript)) return "correction";
  if (
    input.followUpUntil &&
    now <= input.followUpUntil &&
    isShortContextualVoiceFollowUp(input.transcript)
  ) {
    return "short_follow_up";
  }
  return "normal";
}

export function contextualizeVoiceCorrection(
  request: string,
  recent: Array<{ role?: string; text?: string }> = [],
) {
  if (!isVoiceCorrectionTurn(request)) return request;
  const requestNorm = normalizeVoiceText(request);
  const previousUser = [...recent]
    .reverse()
    .find((turn) => {
      if (turn.role !== "user") return false;
      const candidate = String(turn.text ?? "").trim();
      return Boolean(candidate) && normalizeVoiceText(candidate) !== requestNorm;
    });
  const prior = String(previousUser?.text ?? "").trim();
  if (!prior) return request;
  return `${request}\n\nVOICE CORRECTION: This corrects the immediately previous user-requested action: “${prior.slice(0, 500)}”. Resolve the same target from authoritative current context and recent conversation. Replace/supersede the corrected detail; do not create a duplicate action.`;
}

export const NATURAL_VOICE_CONTRACT = `NATURAL VOICE CONTINUITY CONTRACT:
- Treat a short follow-up in the same live Voice session as a continuation of the immediately prior conversational thread when the referent is clear.
- Resolve “there,” “here,” “she,” “he,” “they,” “that office,” “this account,” “do that,” and similar references from authoritative Current Context plus the recent same-Emery conversation. Ask one short clarification only when there is a real ambiguity.
- Corrections supersede the immediately prior intended action. “Actually Thursday,” “sorry, Friday,” “make that 2 PM,” and equivalent corrections must update/replace the prior detail rather than create a duplicate.
- For an explicit correction to a completed write, use the canonical controller to update/reschedule the same target when possible. Never silently create a second copy of the prior action.
- If Adam interrupts while Emery is speaking, stop yielding audio and listen. Continue naturally from the interruption instead of restarting the whole answer.
- “Stop,” “hold on,” “wait,” or “quiet” means stop the current spoken output but keep the live Voice conversation available. “End voice,” “stop listening,” or “close voice” means end the Voice session.
- Keep spoken responses compact and conversational: normally one direct answer plus, when useful, one next action. Do not read JSON, URLs, markdown syntax, receipt metadata, or tool mechanics aloud.
- A successful-sounding confirmation requires a canonical performed=true result or successful execution receipt. If a write fails or needs clarification, say that plainly and briefly.
- Never treat likely speaker echo or Emery's own recently played speech as a new user instruction.`;
