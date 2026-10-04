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
      <section className="emery-mobile-deck relative isolate h-[220px] w-full shrink-0 overflow-hidden border-b border-live/20 sm:hidden" aria-label="Emery Core">
        <div className="emery-grid pointer-events-none absolute inset-0 opacity-90" aria-hidden="true" />
        <div className="emery-deck-arc pointer-events-none absolute left-1/2 top-[19px] size-[174px] -translate-x-1/2 rounded-full" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-4 top-3 z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em]">
          <span className="text-live">Emery Core</span>
          <span className="text-secondary-foreground">Personal Intelligence</span>
        </div>
        <div className="absolute inset-x-0 top-[22px] flex justify-center"><EmeryBrainCore state={state} compact /></div>
        <div className="absolute inset-x-0 bottom-[26px] z-10 flex justify-center"><EmeryStateLabel state={state} /></div>
        <div className="absolute inset-x-0 bottom-2 z-10 flex items-center justify-center gap-2 text-[9px] font-medium uppercase tracking-[0.08em] text-secondary-foreground" aria-label="Private conversation with Current Context">
          <span>Private</span><span aria-hidden="true" className="size-0.5 rounded-full bg-live/60" /><span>Current Context</span>
        </div>
      </section>
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
