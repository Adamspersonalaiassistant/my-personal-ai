import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Engine } from "./engine.ts";
import { GithubOps } from "./github-ops.ts";
import { OpenAiPlanner } from "./llm.ts";
import { SupabaseStore } from "./store-supabase.ts";
import { lovablePublisher, servedCommitFrom } from "./release.ts";

const PUBLISHED_URL = "https://emery-personal-ai.lovable.app";
const LOVABLE_PROJECT_ID = "9d966392-55bb-436a-bf8b-bf2dee556f11";

// JARVIS background engineering worker. Invoked by ONE cron job
// (jarvis-worker-tick → jarvis_kick_worker) or an explicit kick. Authenticated
// with an internal key validated in-database; secrets never leave the server.
// The tick runs in the background (EdgeRuntime.waitUntil) so the scheduler's
// short HTTP timeout cannot interrupt work. Overlapping ticks are safe: claims
// are leased and every write is fenced.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return json({ error: "Server configuration missing" }, 500);
  const db = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const supplied = request.headers.get("x-jarvis-worker-key") ?? "";
  if (!supplied) return json({ error: "Unauthorized" }, 401);
  const { data: valid, error } = await db.rpc("validate_internal_cron_token", {
    p_name: "jarvis_worker",
    p_token: supplied,
  });
  if (error || valid !== true) return json({ error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const githubToken = Deno.env.get("JARVIS_GITHUB_TOKEN") || null;
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || null;
  const model =
    Deno.env.get("JARVIS_ENGINEER_MODEL") || Deno.env.get("EMERY_PRIMARY_MODEL") || "gpt-5.6-luna";
  const store = new SupabaseStore(db);
  const engine = new Engine({
    store,
    github: githubToken ? new GithubOps({ token: githubToken, fetcher: fetch }) : null,
    planner: openAiKey ? new OpenAiPlanner(openAiKey, model) : null,
    workerId: `edge-${crypto.randomUUID().slice(0, 8)}`,
    budgetMs: 110_000,
    forceRadar: String(body?.source ?? "").startsWith("radar"),
    releases: {
      servedCommit: () => servedCommitFrom(PUBLISHED_URL, fetch),
      // Lovable's publish API needs a Business plan key; without it JARVIS asks Adam to tap Publish.
      publisher: lovablePublisher(
        Deno.env.get("JARVIS_LOVABLE_API_KEY") || null,
        LOVABLE_PROJECT_ID,
        fetch,
      ),
      // Kill switch: set JARVIS_RELEASE_OPERATOR=off in Edge Function secrets to stop all releases.
      enabled: Deno.env.get("JARVIS_RELEASE_OPERATOR") !== "off",
    },
  });

  const work = engine.tick().then(
    async (report) => {
      const owner = await store.ownerId();
      await store.logEvent(owner, {
        event_type: "jarvis_worker",
        action: "tick",
        status: "ok",
        metadata: {
          ...report,
          source: body?.source ?? null,
          github: Boolean(githubToken),
          planner: Boolean(openAiKey),
        },
      });
    },
    async (err) => {
      console.error("[jarvis-worker] tick failed", String(err?.message ?? err).slice(0, 300));
      try {
        const owner = await store.ownerId();
        await store.logEvent(owner, {
          event_type: "jarvis_worker",
          action: "tick",
          status: "error",
          metadata: { error: String(err?.message ?? err).slice(0, 300) },
        });
      } catch {
        /* ignore */
      }
    },
  );
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return json({ accepted: true, github: Boolean(githubToken), planner: Boolean(openAiKey) }, 202);
});
