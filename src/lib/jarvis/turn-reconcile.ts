// Ambiguous-completion handling for JARVIS turns. A rejected browser/server
// transport does NOT mean the turn failed: the server may have committed the
// user message, the tool writes and the answer before the response was lost.
// The canonical thread is the source of truth, so after any rejection we
// reconcile against it by turn id. Re-sending the same turn id is idempotent on
// the server (it returns the stored result and never re-runs the runtime).
// Pure and dependency-free so it is unit-testable and safe in any client.

export const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function newTurnId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export type TurnMessage = {
  id: string;
  speaker: "user" | "agent";
  speaker_name: string;
  content: string;
  created_at: string;
  metadata?: { turn_id?: string; recoverable_error?: boolean } | null;
};

export type TurnSendResult = {
  userMessage: TurnMessage;
  agentMessage: TurnMessage | null;
  error: string | null;
  inProgress?: boolean;
};

export type TurnState = { user: TurnMessage | null; agent: TurnMessage | null };

/** What the canonical thread says about one turn. */
export function turnState(messages: TurnMessage[], turnId: string): TurnState {
  const mine = messages.filter((m) => m.metadata?.turn_id === turnId);
  return {
    user: mine.find((m) => m.speaker === "user") ?? null,
    agent: mine.find((m) => m.speaker === "agent") ?? null,
  };
}

export type TurnOutcome =
  /** The persisted result exists (directly, or recovered after a lost response). */
  | { kind: "completed"; result: TurnSendResult; reconciled: boolean }
  /** The thread confirms the turn did not complete. Safe to show a retry error. */
  | { kind: "failed" }
  /** Completion could not be established yet. Do not allow a duplicate submission. */
  | { kind: "unconfirmed"; userMessage: TurnMessage | null };

export type RunTurnDeps = {
  turnId: string;
  send: () => Promise<TurnSendResult>;
  loadMessages: () => Promise<TurnMessage[]>;
  wait: (ms: number) => Promise<void>;
  /** Called once when a transport rejection forces a reconciliation. */
  onChecking?: () => void;
  /** Milliseconds to wait before each re-check. Tests override this. */
  delays?: number[];
};

export const RECONCILE_DELAYS_MS = [700, 1500, 2500, 4000, 6000, 8000, 10000, 12000];

function completed(state: TurnState, reconciled: boolean): TurnOutcome | null {
  if (!state.user || !state.agent) return null;
  const failedRun = Boolean(state.agent.metadata?.recoverable_error);
  return {
    kind: "completed",
    reconciled,
    result: {
      userMessage: state.user,
      agentMessage: state.agent,
      error: failedRun ? "JARVIS couldn't finish that turn." : null,
    },
  };
}

/**
 * Send one turn; if the call rejects (or reports the turn as still running),
 * reconcile against the canonical thread by turn id instead of assuming failure.
 */
export async function runJarvisTurn(deps: RunTurnDeps): Promise<TurnOutcome> {
  const { turnId } = deps;
  let first: TurnSendResult | null = null;
  try {
    first = await deps.send();
  } catch {
    first = null;
  }
  if (first && !first.inProgress) return { kind: "completed", result: first, reconciled: false };

  deps.onChecking?.();
  const delays = deps.delays ?? RECONCILE_DELAYS_MS;
  let user: TurnMessage | null = first?.userMessage ?? null;
  let resent = false;
  let confirmedMissing = 0;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    await deps.wait(delays[attempt]!);
    let state: TurnState | null = null;
    try {
      state = turnState(await deps.loadMessages(), turnId);
    } catch {
      state = null; // Reading the thread failed too: completion is still unknown.
    }
    if (state) {
      const done = completed(state, true);
      if (done) return done;
      if (state.user) {
        user = state.user;
        confirmedMissing = 0;
      } else {
        confirmedMissing += 1;
      }
    }
    // Re-sending the SAME turn id is idempotent: it returns the stored result,
    // reports "in progress", or (if the request never arrived) runs the turn once.
    const shouldResend =
      (state && !state.user && !resent) || (state?.user && !state.agent && attempt >= 3);
    if (shouldResend) {
      resent = true;
      try {
        const again = await deps.send();
        if (!again.inProgress) return { kind: "completed", result: again, reconciled: true };
      } catch {
        /* a second rejection is settled by the next thread read */
      }
    }
    if (state && !state.user && confirmedMissing >= 2) return { kind: "failed" };
  }
  return { kind: "unconfirmed", userMessage: user };
}
