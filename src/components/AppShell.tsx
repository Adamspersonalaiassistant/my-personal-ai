import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Settings as SettingsIcon,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import brainImage from "@/assets/neural-brain.png";
import {
  emeryReturnLabel,
  isEmeryReturnPath,
  normalizePrefill,
  resolveEmeryReturn,
  type EmeryReturnPath,
} from "@/lib/emery-handoff";

const primaryNav = [
  { to: "/chat", label: "Emery", icon: MessageCircle },
  { to: "/personal", label: "Personal", icon: Heart },
  { to: "/hpo", label: "HPO", icon: BriefcaseBusiness },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
] as const;

const desktopNav = [
  ...primaryNav,
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/meetings", label: "Meetings", icon: CalendarDays },
  { to: "/agents", label: "Agents", icon: UsersRound },
  { to: "/memories", label: "Memories", icon: Brain },
] as const;

const moreItems = [
  {
    to: "/projects",
    label: "Projects",
    description: "Outcomes, priorities and next actions",
    icon: FolderKanban,
  },
  {
    to: "/agents",
    label: "Agents",
    description: "Specialists working behind Emery",
    icon: UsersRound,
  },
  {
    to: "/memories",
    label: "Memories",
    description: "What Emery carries forward about you",
    icon: Brain,
  },
  {
    to: "/meetings",
    label: "Meetings",
    description: "Internal meetings and conversation context",
    icon: CalendarDays,
  },
  {
    to: "/settings",
    label: "Settings",
    description: "Emery, iPhone access and system controls",
    icon: SettingsIcon,
  },
] as const;

const RETURN_KEY = "emery:return";
const PREFILL_KEY = "emery:prefill";

export function AppShell({
  title,
  children,
  padded = true,
  askEmery,
}: {
  title: string;
  children: ReactNode;
  padded?: boolean;
  askEmery?: string;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const returnTo = resolveEmeryReturn(pathname);
  const prefill = normalizePrefill(askEmery);
  const onChat = pathname.startsWith("/chat");
  const [lastReturn, setLastReturn] = useState<EmeryReturnPath | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreItems.some((item) => pathname.startsWith(item.to));

  useEffect(() => {
    if (!onChat || typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(RETURN_KEY);
    setLastReturn(isEmeryReturnPath(stored) ? stored : null);
  }, [onChat]);

  useEffect(() => setMoreOpen(false), [pathname]);

  // AppShell owns the viewport. Pages scroll inside the shell so navigation never
  // disappears behind document scrolling on iPhone/PWA.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, []);

  function rememberEmeryHandoff() {
    if (typeof window === "undefined" || !returnTo) return;
    window.sessionStorage.setItem(RETURN_KEY, returnTo);
    if (prefill) window.sessionStorage.setItem(PREFILL_KEY, prefill);
    else window.sessionStorage.removeItem(PREFILL_KEY);
  }

  function clearReturnContext() {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(RETURN_KEY);
      window.sessionStorage.removeItem(PREFILL_KEY);
    }
    setLastReturn(null);
  }

  return (
    <div className="relative mx-auto grid h-[100dvh] w-full max-w-[1180px] grid-cols-1 overflow-hidden bg-background/84 text-foreground md:my-[18px] md:h-[calc(100dvh-36px)] md:grid-cols-[220px_minmax(0,1fr)] md:rounded-[1.45rem] md:border md:border-border/45 md:shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
      <div aria-hidden className="emery-grid pointer-events-none absolute inset-0 opacity-20" />

      <aside className="relative z-20 hidden min-h-0 overflow-hidden border-r border-border/40 bg-[oklch(0.105_0.03_255/0.82)] md:flex md:flex-col">
        <div className="flex shrink-0 items-center gap-3 px-4 pb-5 pt-5">
          <Link
            to="/chat"
            onClick={rememberEmeryHandoff}
            className="relative flex size-10 items-center justify-center overflow-hidden rounded-xl border border-primary/18 bg-primary/[0.045]"
            aria-label="Open Emery"
          >
            <img src={brainImage} alt="" className="emery-blue-brain size-9 object-cover" />
          </Link>
          <div>
            <p className="text-sm font-semibold">Emery</p>
            <p className="text-[10px] text-muted-foreground">Personal intelligence</p>
          </div>
        </div>

        <nav className="emery-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {desktopNav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => {
                if (to === "/chat") rememberEmeryHandoff();
              }}
              className="emery-press flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-muted-foreground hover:bg-white/[0.035] hover:text-foreground"
              activeProps={{ className: "bg-primary/[0.09] text-foreground" }}
            >
              <Icon className="size-[17px]" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border/35 p-2">
          <Link
            to="/settings"
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
          >
            <SettingsIcon className="size-[17px]" />
            Settings
          </Link>
        </div>
      </aside>

      <div className="relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="z-40 flex min-h-[58px] shrink-0 items-center justify-between border-b border-border/35 bg-background/92 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-2xl">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              to="/chat"
              onClick={rememberEmeryHandoff}
              className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/16 bg-primary/[0.04] md:hidden"
              aria-label="Open Emery"
            >
              <img src={brainImage} alt="" className="emery-blue-brain size-9 object-cover" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{onChat ? "Emery" : title}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {onChat ? "Your continuous conversation" : "Same Emery · one OS"}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onChat && lastReturn ? (
              <Link
                to={lastReturn}
                onClick={clearReturnContext}
                className="flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-xs text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                <span className="max-w-24 truncate">{emeryReturnLabel(lastReturn)}</span>
              </Link>
            ) : null}
            <Link
              to="/settings"
              className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/[0.03] hover:text-foreground md:hidden"
              aria-label="Open Settings"
            >
              <SettingsIcon className="size-[18px]" />
            </Link>
          </div>
        </header>

        <main
          className={`emery-route-enter relative min-h-0 flex-1 ${padded
            ? "emery-scrollbar overflow-y-auto overscroll-contain px-4 py-4 [touch-action:pan-y] [-webkit-overflow-scrolling:touch] sm:px-5 md:px-7 md:py-6"
            : "overflow-hidden"
          }`}
        >
          {children}
        </main>

        <nav
          className="z-40 grid shrink-0 grid-cols-5 border-t border-border/35 bg-background/96 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-2xl md:hidden"
          aria-label="Primary navigation"
        >
          {primaryNav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => {
                if (to === "/chat") rememberEmeryHandoff();
              }}
              className="emery-press flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[9px] font-semibold text-muted-foreground"
              activeProps={{ className: "text-primary" }}
            >
              <Icon className="size-[19px]" />
              <span>{label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Open more navigation"
            aria-expanded={moreOpen}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-semibold ${moreActive ? "text-primary" : "text-muted-foreground"}`}
          >
            <MoreHorizontal className="size-[20px]" />
            <span>More</span>
          </button>
        </nav>
      </div>

      {moreOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMoreOpen(false)}
          role="presentation"
        >
          <section
            className="emery-sheet-in max-h-[78dvh] w-full overflow-hidden rounded-t-[1.6rem] border-t border-border/55 bg-[oklch(0.125_0.034_255/0.99)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="More Emery destinations"
          >
            <div className="flex shrink-0 items-center justify-between px-1 py-2">
              <div>
                <p className="text-sm font-semibold">More</p>
                <p className="text-[11px] text-muted-foreground">Everything else Emery manages.</p>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
                aria-label="Close more navigation"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="emery-scrollbar max-h-[calc(78dvh-4.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border/45 bg-card/38 [-webkit-overflow-scrolling:touch]">
              {moreItems.map(({ to, label, description, icon: Icon }, index) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex min-h-[70px] items-center gap-3 px-3.5 py-2.5 ${index ? "border-t border-border/35" : ""}`}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.055] text-primary">
                    <Icon className="size-[17px]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}
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
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-primary/[0.06] text-primary">
        <Icon className="size-5" />
      </div>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
