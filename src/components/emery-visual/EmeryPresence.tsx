import { ShieldCheck, Wifi } from "lucide-react";
import { CommandPanel } from "@/components/ui/emery/CommandPanel";
import { StatusChip } from "@/components/ui/emery/StatusChip";
import { EmeryBrainCore } from "./EmeryBrainCore";
import { EmeryStateLabel } from "./EmeryStateLabel";
import type { EmeryVisualState } from "./emery-visual.types";

export function EmeryPresence({
  state,
  compact = false,
  subtitle = "Personal intelligence online",
}: {
  state: EmeryVisualState;
  compact?: boolean;
  subtitle?: string;
}) {
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 px-1 py-2 sm:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <EmeryBrainCore state={state} compact />
          <div className="min-w-0">
            <p className="emery-kicker">Emery Core</p>
            <h1 className="mt-0.5 truncate text-xl font-semibold tracking-[-0.02em]">Emery</h1>
            <div className="mt-2"><EmeryStateLabel state={state} /></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CommandPanel variant="glass" active={state !== "idle"} className="relative hidden min-h-[214px] overflow-hidden sm:flex sm:items-center sm:justify-between sm:gap-5 sm:px-6 sm:py-4">
      <div className="pointer-events-none absolute inset-0 emery-grid opacity-65" aria-hidden="true" />
      <div className="relative z-10 min-w-0 max-w-[280px]">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="live" icon={<Wifi />} pulse>Connected</StatusChip>
          <StatusChip tone="neutral" icon={<ShieldCheck />}>Private</StatusChip>
        </div>
        <p className="emery-kicker mt-5">Personal Intelligence</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em]">Emery</h1>
        <p className="mt-2 text-sm leading-6 text-secondary-foreground">{subtitle}</p>
        <div className="mt-4"><EmeryStateLabel state={state} /></div>
      </div>
      <div className="relative z-10 flex flex-1 justify-center lg:justify-end">
        <EmeryBrainCore state={state} />
      </div>
    </CommandPanel>
  );
}
