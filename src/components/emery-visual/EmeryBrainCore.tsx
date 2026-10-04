import brainImage from "@/assets/neural-brain.png";
import { cn } from "@/lib/utils";
import { EmeryBrainCanvas } from "./EmeryBrainCanvas";
import { EmeryBrainRings } from "./EmeryBrainRings";
import type { EmeryVisualState } from "./emery-visual.types";

export function EmeryBrainCore({
  state = "idle",
  compact = false,
  className,
}: {
  state?: EmeryVisualState;
  compact?: boolean;
  className?: string;
}) {
  const active = state !== "idle" && state !== "waiting";
  return (
    <div
      className={cn(
        "relative isolate grid shrink-0 place-items-center rounded-full",
        compact ? "size-[104px]" : "size-[188px] lg:size-[208px]",
        className,
      )}
      aria-hidden="true"
      data-emery-visual-state={state}
    >
      <div className="absolute inset-[9%] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.10),rgba(59,130,246,0.035)_44%,transparent_72%)] blur-md" />
      <EmeryBrainCanvas state={state} compact={compact} />
      <EmeryBrainRings state={state} />
      <div className={cn("relative z-10 grid place-items-center rounded-full border border-live/10 bg-background/40 shadow-[inset_0_0_34px_rgba(34,211,238,0.04)]", compact ? "size-[54px]" : "size-[92px] lg:size-[102px]", active && "emery-live-glow")}>
        <img
          src={brainImage}
          alt=""
          draggable={false}
          className={cn("emery-blue-brain object-contain", compact ? "size-[48px]" : "size-[84px] lg:size-[92px]", state === "idle" ? "emery-breathe" : "")}
        />
      </div>
    </div>
  );
}
