import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionHeadingProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
}

export function SectionHeading({ title, description, eyebrow, action, className, ...props }: SectionHeadingProps) {
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-3", className)} {...props}>
      <div className="min-w-0">
        {eyebrow ? <p className="emery-kicker mb-1">{eyebrow}</p> : null}
        <h2 className="text-balance text-base font-semibold leading-tight text-foreground sm:text-lg">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
