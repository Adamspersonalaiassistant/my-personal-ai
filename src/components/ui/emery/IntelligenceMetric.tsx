import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface IntelligenceMetricProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  live?: boolean;
}

export function IntelligenceMetric({ label, value, detail, icon, live = false, className, ...props }: IntelligenceMetricProps) {
  return (
    <div className={cn("emery-panel-matte min-w-0 rounded-xl border px-3 py-2.5", live && "border-live/25", className)} {...props}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {icon ? <span aria-hidden="true" className={cn("shrink-0 [&_svg]:size-3.5", live && "text-live")}>{icon}</span> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-2">
        <span className="truncate text-lg font-semibold text-foreground">{value}</span>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
      </div>
    </div>
  );
}
