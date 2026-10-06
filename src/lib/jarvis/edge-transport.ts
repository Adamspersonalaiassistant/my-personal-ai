// Server-side transport that routes JARVIS GitHub calls through the protected
// Supabase Edge Function (supabase/functions/jarvis-github). The GitHub token
// exists only in Supabase Edge Function Secrets; this module never sees it.
// It adapts the function to the fetch signature so the one existing GithubClient
// (and all of its policy checks) is reused unchanged.

const GITHUB_API = "https://api.github.com";
const RAW_HOST = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/;

export type EdgeTransportOptions = {
  supabaseUrl: string;
  publishableKey: string;
  /** The signed-in owner's session JWT (forwarded; the function verifies owner status). */
  accessToken: string;
  fetcher?: typeof fetch;
};

function functionUrl(supabaseUrl: string) {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/jarvis-github`;
}

async function call(options: EdgeTransportOptions, payload: unknown) {
  const fetcher = options.fetcher ?? fetch;
  return fetcher(functionUrl(options.supabaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      apikey: options.publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function createEdgeGithubFetcher(options: EdgeTransportOptions): typeof fetch {
  const passthrough = options.fetcher ?? fetch;
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let path: string | null = null;
    let accept: "json" | "raw" = "json";
    if (url.startsWith(GITHUB_API)) path = url.slice(GITHUB_API.length);
    else {
      const raw = url.match(RAW_HOST);
      if (raw) {
        path = `/repos/${raw[1]}/contents/${raw[3]}?ref=${raw[2]}`;
        accept = "raw";
      }
    }
    if (path === null) return passthrough(input as RequestInfo, init);
    let body: unknown;
    if (typeof init.body === "string" && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }
    const response = await call(options, {
      method: (init.method ?? "GET").toUpperCase(),
      path,
      body,
      accept,
    });
    if (response.status === 401)
      return new Response(
        JSON.stringify({
          message: "JARVIS GitHub gateway rejected this session (owner sign-in required).",
        }),
        { status: 401 },
      );
    if (response.status === 404)
      return new Response(
        JSON.stringify({ message: "The jarvis-github edge function is not deployed." }),
        { status: 412 },
      );
    if (!response.ok)
      return new Response(
        JSON.stringify({ message: `JARVIS GitHub gateway error (${response.status}).` }),
        { status: 502 },
      );
    const envelope = (await response.json()) as { status: number; body: string };
    return new Response(envelope.body ?? "", { status: envelope.status });
  }) as typeof fetch;
}

/** Presence-only probe: is JARVIS_GITHUB_TOKEN configured in the edge function? */
export async function edgeGithubStatus(
  options: EdgeTransportOptions,
): Promise<{ reachable: boolean; configured: boolean }> {
  try {
    const response = await call(options, { op: "status" });
    if (!response.ok) return { reachable: false, configured: false };
    const data = (await response.json()) as { configured?: boolean };
    return { reachable: true, configured: data.configured === true };
  } catch {
    return { reachable: false, configured: false };
  }
}
