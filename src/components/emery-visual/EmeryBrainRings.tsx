import type { EmeryVisualState } from "./emery-visual.types";

const activeStates = new Set<EmeryVisualState>([
  "listening",
  "thinking",
  "remembering",
  "searching",
  "planning",
  "using_tool",
  "executing",
  "syncing",
  "speaking",
]);

export function EmeryBrainRings({ state }: { state: EmeryVisualState }) {
  const active = activeStates.has(state);
  const speaking = state === "speaking";
  const listening = state === "listening";
  const error = state === "error";
  const success = state === "success";
  const stroke = error ? "#fb7185" : success ? "#34d399" : speaking || listening ? "#22d3ee" : "#3b82f6";

  return (
    <svg viewBox="0 0 240 240" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <defs>
        <radialGradient id="emery-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="65%" stopColor={stroke} stopOpacity="0.035" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="120" cy="120" r="105" fill="url(#emery-halo)" />
      <circle cx="120" cy="120" r="89" fill="none" stroke={stroke} strokeOpacity={active ? 0.25 : 0.12} strokeWidth="1" strokeDasharray="2 7" className={active ? "emery-orbit" : undefined} />
      <g className={state === "thinking" || state === "planning" || state === "searching" ? "emery-orbit" : undefined} style={{ transformOrigin: "120px 120px" }}>
        <circle cx="120" cy="120" r="75" fill="none" stroke={stroke} strokeOpacity={active ? 0.38 : 0.16} strokeWidth="1.25" strokeDasharray={state === "executing" ? "78 18" : "34 14 7 18"} />
        <path d="M120 41 A79 79 0 0 1 183 72" fill="none" stroke={stroke} strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="120" cy="120" r="61" fill="none" stroke={stroke} strokeOpacity={speaking || listening ? 0.58 : 0.24} strokeWidth={speaking || listening ? 1.7 : 1} />
      {(speaking || listening) ? (
        <>
          <circle cx="120" cy="120" r="55" fill="none" stroke="#22d3ee" strokeOpacity="0.18" strokeWidth="1" className="emery-status-pulse" />
          <circle cx="120" cy="120" r="49" fill="none" stroke="#3b82f6" strokeOpacity="0.16" strokeWidth="1" />
        </>
      ) : null}
      {state === "searching" ? <path d="M120 120 L190 91" stroke="#22d3ee" strokeOpacity="0.42" strokeWidth="1" /> : null}
      {state === "using_tool" ? (
        <>
          <circle cx="42" cy="120" r="3.5" fill="#22d3ee" opacity="0.75" />
          <circle cx="198" cy="120" r="3.5" fill="#22d3ee" opacity="0.75" />
          <circle cx="120" cy="42" r="3.5" fill="#3b82f6" opacity="0.75" />
        </>
      ) : null}
    </svg>
  );
}
