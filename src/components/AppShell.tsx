import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  MessageCircle,
  UsersRound,
  CheckSquare,
  BriefcaseBusiness,
  FolderKanban,
  Settings as SettingsIcon,
  Brain,
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

const navItems = [
  { to: "/chat", label: "Emery", compactLabel: "Emery", icon: MessageCircle },
  { to: "/hpo", label: "HPO", compactLabel: "HPO", icon: BriefcaseBusiness },
  { to: "/tasks", label: "Tasks", compactLabel: "Tasks", icon: CheckSquare },
  { to: "/agents", label: "Agents", compactLabel: "Agents", icon: UsersRound },
  { to: "/projects", label: "Projects", compactLabel: "Projects", icon: FolderKanban },
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
  /** Optional bounded context saved for the next handoff into the main Emery chat. */
  askEmery?: string;
}) {
  const showSectionTitle = title !== "Chat" && title !== "Emery";
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const returnTo = resolveEmeryReturn(pathname);
  const prefill = normalizePrefill(askEmery);
  const onChat = pathname.startsWith("/chat");
  const [lastReturn, setLastReturn] = useState<EmeryReturnPath | null>(null);

  useEffect(() => {
    if (!onChat || typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(RETURN_KEY);
    setLastReturn(isEmeryReturnPath(stored) ? stored : null);
  }, [onChat]);

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
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-background/82 text-foreground md:min-h-[calc(100dvh-36px)] md:rounded-[2rem] md:border md:border-border/55 md:shadow-[0_30px_90px_rgba(0,0,0,0.46)]">
      <div
        aria-hidden
        className="emery-grid pointer-events-none absolute inset-x-0 top-0 h-[28rem] opacity-45"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-20 size-52 rounded-full bg-primary/[0.035] blur-[96px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-[42%] size-48 rounded-full bg-blue-300/[0.028] blur-[96px]"
      />

      <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between border-b border-border/40 bg-background/84 px-4 pb-2.5 pt-[max(0.7rem,env(safe-area-inset-top))] backdrop-blur-2xl supports-[backdrop-filter]:bg-background/76 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/chat"
            aria-label={onChat ? "Emery main conversation" : "Return to Emery main conversation"}
            title={onChat ? "Emery" : "Return to Emery"}
            onClick={rememberEmeryHandoff}
            className="emery-press relative flex size-11 shrink-0 items-center justify-center rounded-[1.05rem]"
          >
            <div className="relative flex size-10 items-center justify-center overflow-hidden rounded-2xl border border-primary/18 bg-primary/[0.045] shadow-[0_0_24px_oklch(0.72_0.185_250/0.11)]">
              <img
                src={brainImage}
                alt=""
                className="emery-blue-brain h-9 w-9 object-cover object-center opacity-95"
              />
            </div>
            <span className="absolute bottom-0.5 right-0.5 size-2.5 rounded-full border-2 border-background bg-primary shadow-[0_0_9px_oklch(0.72_0.185_250/0.68)]" />
          </Link>

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[15px] font-semibold tracking-[-0.018em]">Emery</p>
              {showSectionTitle ? (
                <>
                  <span className="text-border/80">/</span>
                  <span className="truncate text-xs font-medium text-muted-foreground">
                    {title}
                  </span>
                </>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />
              <span>{onChat ? "Main conversation · memory connected" : "Tap Emery anytime"}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onChat && lastReturn ? (
            <Link
              to={lastReturn}
              onClick={clearReturnContext}
              aria-label={`Back to ${emeryReturnLabel(lastReturn)}`}
              title={`Back to ${emeryReturnLabel(lastReturn)}`}
              className="emery-press emery-surface flex min-h-11 items-center gap-2 rounded-2xl px-3 text-xs font-semibold text-muted-foreground hover:border-primary/20 hover:bg-primary/[0.045] hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
              <span className="hidden min-[390px]:inline">{emeryReturnLabel(lastReturn)}</span>
            </Link>
          ) : null}
          <Link
            to="/settings"
            aria-label="Open Emery system settings"
            className="emery-press emery-surface flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:border-primary/20 hover:bg-primary/[0.045] hover:text-foreground"
          >
            <SettingsIcon className="size-[18px]" />
          </Link>
        </div>
      </header>

      <main
        className={`relative z-10 min-h-0 flex-1 ${padded ? "overflow-y-auto px-4 py-5 sm:px-6 sm:py-6" : ""}`}
      >
        {children}
      </main>

      <div className="sticky bottom-0 z-40 shrink-0 border-t border-border/40 bg-background/88 px-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/78 sm:px-3">
        <nav
          className="emery-surface mx-auto grid max-w-2xl grid-cols-5 gap-0.5 rounded-[1.45rem] p-1 sm:gap-1 sm:p-1.5"
          aria-label="Primary"
        >
          {navItems.map(({ to, label, compactLabel, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-label={label}
              onClick={() => {
                if (to === "/chat") rememberEmeryHandoff();
              }}
              className="emery-press group relative flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-[1.05rem] px-0.5 text-[9px] font-semibold text-muted-foreground transition-colors min-[390px]:px-1.5 min-[390px]:text-[10px]"
              activeProps={{
                className:
                  "bg-primary/[0.09] text-primary shadow-[inset_0_0_0_1px_oklch(0.72_0.185_250/0.16)]",
              }}
            >
              <Icon
                className="size-[18px] transition-transform duration-200 group-active:scale-95"
                strokeWidth={1.9}
              />
              <span className="max-w-full truncate sm:hidden">{compactLabel}</span>
              <span className="hidden sm:inline">{label}</span>
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
        <div className="absolute inset-2 rounded-full bg-primary/10 blur-2xl" />
        <div className="emery-glass relative flex size-16 items-center justify-center rounded-[1.35rem] text-primary">
          <Icon className="size-6" strokeWidth={1.8} />
        </div>
      </div>
      <h2 className="mt-1 text-base font-semibold tracking-tight">{title}</h2>
      <p className="max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
