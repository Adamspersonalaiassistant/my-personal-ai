type StopVoice = () => void;

const CHANNEL_NAME = "emery-voice-single-session-v1";
const OWNER_KEY = "emery.voice.active-owner.v1";
const TAB_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let currentStop: StopVoice | null = null;
let channel: BroadcastChannel | null = null;
let initialized = false;

function readOwner(): { tabId?: string; claimedAt?: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OWNER_KEY);
    return raw ? (JSON.parse(raw) as { tabId?: string; claimedAt?: number }) : null;
  } catch {
    return null;
  }
}

function stopLocalVoiceForOtherOwner(tabId?: string) {
  if (!tabId || tabId === TAB_ID) return;
  currentStop?.();
}

function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => {
      const payload = event.data as { type?: string; tabId?: string } | null;
      if (payload?.type === "claim") stopLocalVoiceForOtherOwner(payload.tabId);
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== OWNER_KEY || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue) as { tabId?: string };
      stopLocalVoiceForOtherOwner(payload.tabId);
    } catch {
      // Ignore malformed coordination data. Voice still has same-tab protection.
    }
  });
}

/**
 * Claims the one allowed Emery Voice session for this browser origin.
 * Any other Emery tab/PWA window is asked to stop before this session opens.
 */
export function claimExclusiveEmeryVoice(stop: StopVoice) {
  if (typeof window === "undefined") return;
  initialize();

  if (currentStop && currentStop !== stop) currentStop();
  currentStop = stop;

  const payload = { type: "claim", tabId: TAB_ID, claimedAt: Date.now() };
  channel?.postMessage(payload);
  try {
    window.localStorage.setItem(OWNER_KEY, JSON.stringify(payload));
  } catch {
    // BroadcastChannel + the in-module guard still protect the common path.
  }
}

export function releaseExclusiveEmeryVoice(stop: StopVoice) {
  if (typeof window === "undefined") return;
  if (currentStop === stop) currentStop = null;

  const owner = readOwner();
  if (owner?.tabId !== TAB_ID) return;
  try {
    window.localStorage.removeItem(OWNER_KEY);
  } catch {
    // Non-fatal; a later claim overwrites stale ownership.
  }
}
