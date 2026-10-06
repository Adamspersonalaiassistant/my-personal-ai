import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSsml, parseLabRequest } from "./lab.ts";

// JARVIS Voice Lab (owner-only). Previews the official Microsoft Azure British
// neural voices for Adam's audition. AZURE_SPEECH_KEY / AZURE_SPEECH_REGION live
// only in Supabase Edge Function Secrets (free F0 tier); until they exist the
// function reports configured:false and nothing is called.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function isOwner(request: Request) {
  try {
    const header = request.headers.get("Authorization") ?? "";
    if (!header.startsWith("Bearer ")) return false;
    const token = header.slice(7);
    if (token.split(".").length !== 3) return false;
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!url || !key) return false;
    const client = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: claims, error } = await client.auth.getClaims(token);
    if (error || !claims?.claims?.sub) return false;
    const { data: owner, error: ownerError } = await client.rpc("is_emery_owner");
    return !ownerError && owner === true;
  } catch {
    return false; // malformed or forged tokens fail closed
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await isOwner(request))) return json({ error: "Unauthorized" }, 401);
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const key = Deno.env.get("AZURE_SPEECH_KEY");
  const region = Deno.env.get("AZURE_SPEECH_REGION");
  if ((body as { op?: string })?.op === "status")
    return json({ configured: Boolean(key && region) });
  if (!key || !region)
    return json(
      { configured: false, error: "Microsoft voices need a free Azure Speech key." },
      412,
    );
  const lab = parseLabRequest(body);
  if (!lab) return json({ error: "Unknown voice or phrase." }, 400);
  const started = Date.now();
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "emery-jarvis-voice-lab",
    },
    body: buildSsml(lab),
  });
  if (!response.ok) {
    console.error("[jarvis-voice-lab] azure tts failed", response.status);
    return json(
      { configured: true, error: `Microsoft voice preview failed (${response.status}).` },
      502,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return json({
    configured: true,
    audio: `data:audio/mpeg;base64,${btoa(binary)}`,
    latency_ms: Date.now() - started,
  });
});
