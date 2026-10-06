import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleGithubProxy, JARVIS_REPO } from "./proxy.ts";

// JARVIS GitHub gateway (protected). Free-first architecture:
//   Emery/JARVIS server -> this function -> GitHub API
// JARVIS_GITHUB_TOKEN lives only in Supabase Edge Function Secrets. It is read
// here at request time, attached to the outbound GitHub call, and never returned,
// logged, or stored. Callers must present an Emery OWNER session (Supabase JWT).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function requireOwner(request: Request) {
  try {
    return await verifyOwner(request);
  } catch {
    return false; // malformed/forged tokens fail closed as 401
  }
}

async function verifyOwner(request: Request) {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
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
  const { data: isOwner, error: ownerError } = await client.rpc("is_emery_owner");
  return !ownerError && isOwner === true;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await requireOwner(request))) return json({ error: "Unauthorized" }, 401);

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const token = Deno.env.get("JARVIS_GITHUB_TOKEN") || null;
  if (payload?.op === "status") {
    // Presence only — the value is never exposed.
    return json({ configured: Boolean(token), repo: JARVIS_REPO, version: 1 });
  }

  const result = await handleGithubProxy(
    { method: payload?.method, path: payload?.path, body: payload?.body, accept: payload?.accept },
    { token, fetcher: fetch },
  );
  if (result.refused) console.warn(`[jarvis-github] refused: ${result.refused.slice(0, 160)}`);
  return json(result);
});
