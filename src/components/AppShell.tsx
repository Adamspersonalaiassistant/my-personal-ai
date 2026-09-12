import { Link } from "@tanstack/react-router";
import {
  MessageCircle,
  UsersRound,
  CheckSquare,
  CalendarDays,
  FolderKanban,
  Settings as SettingsIcon,
  Brain,
} from "lucide-react";
import type { ReactNode } from "react";
import brainImage from "@/assets/neural-brain.png";

const navItems = [
  { to: "/chat", label: "Emery", icon: MessageCircle },
  { to: "/agents", label: "Agents", icon: UsersRound },
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
  const showSectionTitle = title !== "Chat" && title !== "Emery";

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-background/72 text-foreground md:min-h-[calc(100dvh-36px)] md:rounded-[2rem] md:border md:border-border/60 md:shadow-[0_30px_100px_rgba(0,0,0,0.5)]">
      <div aria-hidden className="emery-grid pointer-events-none absolute inset-x-0 top-0 h-[34rem] opacity-90" />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-28 top-28 size-64 rounded-full bg-primary/[0.055] blur-[90px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-[38%] size-56 rounded-full bg-emerald-300/[0.035] blur-[90px]"
      />

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border/45 bg-background/78 px-4 pb-2.5 pt-[max(0.7rem,env(safe-area-inset-top))] backdrop-blur-2xl supports-[backdrop-filter]:bg-background/68 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex size-11 shrink-0 items-center justify-center">
            <div className="emery-orbit absolute inset-0 rounded-[1.05rem] bg-[conic-gradient(from_180deg,transparent,oklch(0.805_0.175_155/0.42),transparent_48%)] p-px opacity-70">
              <div className="size-full rounded-[1.02rem] bg-background" />
            </div>
            <div className="relative flex size-10 items-center justify-center overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.055] shadow-[0_0_26px_oklch(0.805_0.175_155/0.11)]">
              <img src={brainImage} alt="" className="h-9 w-9 object-cover object-center opacity-95" />
            </div>
            <span className="absolute bottom-0.5 right-0.5 size-2.5 rounded-full border-2 border-background bg-primary shadow-[0_0_10px_oklch(0.805_0.175_155/0.72)]" />
          </div>

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[15px] font-semibold tracking-[-0.015em]">Emery</p>
              {showSectionTitle ? (
                <>
                  <span className="text-border">/</span>
                  <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
                </>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground">
              <span className="text-primary">ONLINE</span>
              <span className="size-0.5 rounded-full bg-border" />
              <span>memory connected</span>
            </div>
          </div>
        </div>

        <Link
          to="/settings"
          aria-label="Open Emery system settings"
          className="emery-press emery-surface flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:border-primary/25 hover:bg-primary/[0.06] hover:text-foreground"
        >
          <SettingsIcon className="size-[18px]" />
        </Link>
      </header>

      <main className={`relative z-10 flex-1 ${padded ? "px-4 py-5 sm:px-6 sm:py-6" : ""}`}>
        {children}
      </main>

      <div className="sticky bottom-0 z-40 border-t border-border/45 bg-background/82 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/72 sm:px-3">
        <nav className="emery-surface mx-auto grid max-w-2xl grid-cols-5 gap-1 rounded-[1.45rem] p-1.5" aria-label="Primary">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="emery-press group relative flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-[1.05rem] px-1.5 text-[10px] font-semibold text-muted-foreground transition-colors"
              activeProps={{
                className:
                  "bg-primary/[0.095] text-primary shadow-[inset_0_0_0_1px_oklch(0.805_0.175_155/0.14),0_0_18px_oklch(0.805_0.175_155/0.05)]",
              }}
            >
              <Icon className="size-[18px] transition-transform duration-200 group-active:scale-95" strokeWidth={1.9} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>
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
    <div className="emery-fade-up mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
      <div className="relative">
        <div className="absolute inset-2 rounded-full bg-primary/15 blur-2xl" />
        <div className="emery-glass relative flex size-16 items-center justify-center rounded-[1.35rem] text-primary">
          <Icon className="size-6" strokeWidth={1.8} />
        </div>
      </div>
      <h2 className="mt-1 text-base font-semibold tracking-tight">{title}</h2>
      <p className="max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
