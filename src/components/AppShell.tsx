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
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/60 bg-background/85 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        <Link
          to="/settings"
          aria-label="Settings"
          className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <SettingsIcon className="size-5" />
        </Link>
      </header>

      <main className={`flex-1 ${padded ? "px-4 py-5" : ""}`}>{children}</main>

      <nav className="sticky bottom-0 z-20 grid grid-cols-5 border-t border-border/60 bg-background/95 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium text-muted-foreground transition-colors"
            activeProps={{ className: "text-primary" }}
          >
            <Icon className="size-5" />
            {label}
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
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
