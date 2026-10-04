import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type CommandPanelVariant = "matte" | "glass" | "elevated";

export interface CommandPanelProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "article" | "div";
  variant?: CommandPanelVariant;
  active?: boolean;
}

const variantClasses: Record<CommandPanelVariant, string> = {
  matte: "emery-panel-matte",
  glass: "emery-panel-glass",
  elevated: "emery-panel-elevated",
};

export function CommandPanel({ as: Component = "section", variant = "matte", active = false, className, ...props }: CommandPanelProps) {
  return (
    <Component
      className={cn("relative min-w-0 rounded-2xl border p-3.5 sm:p-4", variantClasses[variant], active && "emery-panel-active", className)}
      {...props}
    />
  );
}
