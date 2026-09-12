import { Link } from "@tanstack/react-router";
import {
  MessageCircle,
  Brain,
  CheckSquare,
  CalendarDays,
  FolderKanban,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import brainImage from "@/assets/neural-brain.png";

const navItems = [
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/memories", label: "Memories", icon: Brain },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/meetings", label: "Meetings", icon: CalendarDays },
  { to: "/projects", label: "Projects", icon: FolderKanban },
] as const;

export function AppShell({
  title,
  children,
  padded = true,
}: {
  title: string;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col overflow-x-hidden bg-background text-foreground md:border-x md:border-border/50 md:shadow-2xl">
      <div aria-hidden className="emery-grid pointer-events-none absolute inset-x-0 top-0 h-80 opacity-70" />
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/50 bg-background/80 px-4 pb-2.5 pt-[max(0.7rem,env(safe-area-inset-top))] backdrop-blur-2xl">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-primary/25 bg-primary/8 shadow-[0_0_24px_oklch(0.78_0.19_154/0.15)]">
            <img src={brainImage} alt="" className="h-9 w-9 object-cover object-center opacity-95" />
            <span className="absolute bottom-1 right-1 size-2 rounded-full border border-background bg-primary shadow-[0_0_8px_oklch(0.78_0.19_154)]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="truncate text-[15px] font-semibold tracking-tight">Emery</p>
              {title !== "Chat" ? (
                <span className="truncate text-xs text-muted-foreground">/ {title}</span>
              ) : null}
            </div>
            <p className="truncate text-[11px] font-medium text-muted-foreground">
              Personal AI <span className="mx-1 text-primary/70">•</span> Memory online
            </p>
          </div>
        </div>

        <Link
          to="/settings"
          aria-label="Emery settings"
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-card/70 text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-foreground"
        >
          <SettingsIcon className="size-[18px]" />
        </Link>
      </header>

      <main className={`relative z-10 flex-1 ${padded ? "px-4 py-5 sm:px-6" : ""}`}>
        {children}
      </main>

      <nav className="sticky bottom-0 z-30 grid grid-cols-5 gap-0.5 border-t border-border/50 bg-background/88 px-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-2xl">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-medium text-muted-foreground transition-colors"
            activeProps={{
              className:
                "bg-primary/[0.09] text-primary shadow-[inset_0_0_0_1px_oklch(0.78_0.19_154/0.12)]",
            }}
          >
            <Icon className="size-[19px] transition-transform group-active:scale-95" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Brain;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
      <div className="emery-glass flex size-16 items-center justify-center rounded-[1.35rem] text-primary emery-glow">
        <Icon className="size-6" />
      </div>
      <h2 className="mt-1 text-base font-semibold tracking-tight">{title}</h2>
      <p className="max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
