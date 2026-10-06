// Reads the signed-in owner's bearer token from the current server-function request
// so it can be forwarded to the protected jarvis-github edge function. Server-only:
// the token is never returned to the client or stored.
export async function currentBearerToken(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const header = getRequest()?.headers.get("authorization") ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : null;
  } catch {
    return null;
  }
}
