import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "primary" | "live" | "success" | "warning" | "error";

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  icon?: ReactNode;
  pulse?: boolean;
}

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border/70 bg-elevated/70 text-secondary-foreground",
  primary: "border-primary/25 bg-primary/10 text-primary",
  live: "border-live/30 bg-live/10 text-live",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function StatusChip({ tone = "neutral", icon, pulse = false, className, children, ...props }: StatusChipProps) {
  return (
    <span className={cn("inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none", toneClasses[tone], className)} {...props}>
      {pulse ? <span aria-hidden="true" className="emery-status-pulse size-1.5 rounded-full bg-current" /> : null}
      {icon ? <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
