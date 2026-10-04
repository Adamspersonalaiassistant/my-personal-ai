import { AlertTriangle, Check, Circle, Mic, Radio, Sparkles } from "lucide-react";
import { StatusChip } from "@/components/ui/emery/StatusChip";
import { EMERY_VISUAL_STATE_LABELS, type EmeryVisualState } from "./emery-visual.types";

export function EmeryStateLabel({ state }: { state: EmeryVisualState }) {
  const tone = state === "error" ? "error" : state === "success" ? "success" : state === "listening" || state === "speaking" ? "live" : state === "idle" || state === "waiting" ? "neutral" : "primary";
  const icon = state === "error" ? <AlertTriangle /> : state === "success" ? <Check /> : state === "listening" ? <Mic /> : state === "speaking" ? <Radio /> : state === "idle" ? <Circle /> : <Sparkles />;
  return (
    <StatusChip tone={tone} icon={icon} pulse={["listening", "speaking", "thinking", "searching", "planning", "using_tool", "executing", "syncing"].includes(state)} role="status" aria-live="polite">
      {EMERY_VISUAL_STATE_LABELS[state]}
    </StatusChip>
  );
}
