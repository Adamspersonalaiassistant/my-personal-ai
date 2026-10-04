import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ContextStripProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function ContextStrip({ label, icon, action, className, children, ...props }: ContextStripProps) {
  return (
    <div className={cn("emery-context-strip flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2", className)} {...props}>
      {icon ? <span aria-hidden="true" className="shrink-0 text-live [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0 flex-1 text-sm text-secondary-foreground">
        {label ? <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
