// JARVIS Voice Lab: Microsoft Azure neural voice preview. Pure (no Deno APIs) so
// it is unit-tested in Node. Only the fixed audition phrases and allowlisted
// voices can be synthesised — never arbitrary text.
// Phrases must stay identical to JARVIS_TEST_PHRASES in src/lib/jarvis/voice.ts
// (scripts/validate-jarvis-run1.mjs enforces this).

export const LAB_PHRASES = [
  "Good morning, Adam. I've reviewed the current system state.",
  "The candidate passed validation. It's ready for your review.",
  "I found the issue. The deployment is healthy; the release ledger is stale.",
  "That approach would work, but there's a safer option.",
  "Emery is running the current production release. GitHub and production are aligned.",
] as const;

export const AZURE_VOICES = ["en-GB-ThomasNeural", "en-GB-RyanNeural"] as const;

/** Slight slow-down for gravitas without the fidelity loss of pitch-shifting. */
export const AZURE_RATE = "-6%";

const escapeXml = (text: string) =>
  text.replace(
    /[<>&'"]/g,
    (c) => `&${{ "<": "lt", ">": "gt", "&": "amp", "'": "apos", '"': "quot" }[c]};`,
  );

export type LabRequest = { voice: (typeof AZURE_VOICES)[number]; phrase: number };

export function parseLabRequest(body: unknown): LabRequest | null {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const voice = String(input["voice"] ?? "").replace(/^azure:/, "");
  const phrase = Number(input["phrase"]);
  if (!(AZURE_VOICES as readonly string[]).includes(voice)) return null;
  if (!Number.isInteger(phrase) || phrase < 0 || phrase >= LAB_PHRASES.length) return null;
  return { voice: voice as LabRequest["voice"], phrase };
}

export function buildSsml(request: LabRequest) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${request.voice}"><prosody rate="${AZURE_RATE}">${escapeXml(LAB_PHRASES[request.phrase])}</prosody></voice></speak>`;
}
