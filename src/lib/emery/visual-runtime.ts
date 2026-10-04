import type { EmeryVisualState } from "@/components/emery-visual/emery-visual.types";

export type EmeryVisualRuntimeDetail = {
  state: EmeryVisualState;
  source: "chat" | "voice" | "tool" | "system";
  label?: string | null;
  at: number;
};

const EVENT_NAME = "emery:visual-state";
let latest: EmeryVisualRuntimeDetail = {
  state: "idle",
  source: "system",
  label: null,
  at: 0,
};

export function publishEmeryVisualState(
  state: EmeryVisualState,
  input?: { source?: EmeryVisualRuntimeDetail["source"]; label?: string | null },
) {
  const detail: EmeryVisualRuntimeDetail = {
    state,
    source: input?.source ?? "system",
    label: input?.label ?? null,
    at: Date.now(),
  };
  latest = detail;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<EmeryVisualRuntimeDetail>(EVENT_NAME, { detail }));
  }
  return detail;
}

export function currentEmeryVisualState() {
  return latest;
}

export function subscribeEmeryVisualState(
  listener: (detail: EmeryVisualRuntimeDetail) => void,
) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    listener((event as CustomEvent<EmeryVisualRuntimeDetail>).detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
