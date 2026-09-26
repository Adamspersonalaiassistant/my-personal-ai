export const MODEL_POLICY = {
  primary: process.env["EMERY_PRIMARY_MODEL"] || "gpt-5.6-luna",
  action: process.env["EMERY_ACTION_MODEL"] || "gpt-5.6-luna",
  memory: process.env["EMERY_MEMORY_MODEL"] || "gpt-5.6-luna",
  evaluation: process.env["EMERY_EVALUATION_MODEL"] || "gpt-5.6-luna",
  realtime: process.env["EMERY_REALTIME_MODEL"] || "gpt-realtime-2.1",
  transcription: process.env["EMERY_TRANSCRIPTION_MODEL"] || "gpt-4o-transcribe",
  tts: process.env["EMERY_TTS_MODEL"] || "gpt-4o-mini-tts",
} as const;

export type EmeryModelRole = keyof typeof MODEL_POLICY;
