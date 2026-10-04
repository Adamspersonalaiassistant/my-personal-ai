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
        compact ? "size-[168px]" : "size-[188px] lg:size-[208px]",
        className,
      )}
      aria-hidden="true"
      data-emery-visual-state={state}
    >
      <div className="emery-core-halo absolute inset-[9%] rounded-full blur-md" />
      <EmeryBrainCanvas state={state} compact={compact} />
      <EmeryBrainRings state={state} />
      <div className={cn("emery-core-center relative z-10 grid place-items-center rounded-full border border-live/20 bg-background/40", compact ? "size-[88px]" : "size-[92px] lg:size-[102px]", active && "emery-live-glow")}>
        <img
          src={brainImage}
          alt=""
          draggable={false}
          className={cn("emery-blue-brain object-contain", compact ? "size-[80px]" : "size-[84px] lg:size-[92px]", state === "idle" ? "emery-breathe" : "")}
        />
      </div>
    </div>
  );
}
