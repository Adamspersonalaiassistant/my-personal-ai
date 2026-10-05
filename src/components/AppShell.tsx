import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
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
import { Button } from "@/components/ui/button";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import {
  emeryReturnLabel,
  isEmeryReturnPath,
  normalizePrefill,
  resolveEmeryReturn,
  type EmeryReturnPath,
} from "@/lib/emery-handoff";

const primaryNav = [
  { to: "/chat", label: "Emery", icon: MessageCircle },
  { to: "/hpo", label: "HPO", icon: BriefcaseBusiness },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
] as const;

const desktopNav = [
  ...primaryNav,
  { to: "/personal", label: "Personal", icon: Heart },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/meetings", label: "Meetings", icon: CalendarDays },
  { to: "/agents", label: "Agents", icon: UsersRound },
  { to: "/memories", label: "Memories", icon: Brain },
] as const;

const moreItems = [
  { to: "/personal", label: "Personal", description: "Life, goals and personal context", icon: Heart, group: "Your Space" },
  { to: "/projects", label: "Projects", description: "Outcomes, priorities and next actions", icon: FolderKanban, group: "Your Space" },
  { to: "/meetings", label: "Meetings", description: "Meeting history and conversation context", icon: CalendarDays, group: "Your Space" },
  { to: "/agents", label: "Agents", description: "Specialists working behind Emery", icon: UsersRound, group: "Emery System" },
  { to: "/memories", label: "Memories", description: "What Emery carries forward about you", icon: Brain, group: "Emery System" },
  { to: "/settings", label: "Settings", description: "Voice, iPhone access and system controls", icon: SettingsIcon, group: "Emery System" },
] as const;

const RETURN_KEY = "emery:return";
const PREFILL_KEY = "emery:prefill";
const EMERY_BUILD_ID = "2026-10-05-phase9-voice-first-home-v1";

export function AppShell({ title, children, padded = true, askEmery }: { title: string; children: ReactNode; padded?: boolean; askEmery?: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const returnTo = resolveEmeryReturn(pathname);
  const prefill = normalizePrefill(askEmery);
  const onDashboard = pathname === "/chat";
  const onConversation = pathname.startsWith("/conversation");
  const onEmerySurface = onDashboard || onConversation;
  const onHpo = pathname.startsWith("/hpo");
  const [lastReturn, setLastReturn] = useState<EmeryReturnPath | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const moreActive = moreItems.some((item) => pathname.startsWith(item.to));

  useEffect(() => {
    if (!onConversation || typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(RETURN_KEY);
    setLastReturn(isEmeryReturnPath(stored) ? stored : null);
  }, [onConversation]);

  useEffect(() => setMoreOpen(false), [pathname]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let cancelled = false;
    let checking = false;
    async function checkForFreshBuild() {
      if (cancelled || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch(`/emery-build.json?check=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache", pragma: "no-cache", "x-emery-build-check": EMERY_BUILD_ID },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { buildId?: string };
        if (payload.buildId && payload.buildId !== EMERY_BUILD_ID) setUpdateAvailable(true);
      } catch {
        // Update discovery must never interrupt field work.
      } finally { checking = false; }
    }
    const onVisible = () => { if (document.visibilityState === "visible") void checkForFreshBuild(); };
    void checkForFreshBuild();
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void checkForFreshBuild(), 60_000);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); window.clearInterval(timer); };
  }, []);

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
    <div className="relative mx-auto grid h-[100dvh] w-full max-w-[1680px] grid-cols-1 overflow-hidden bg-background text-foreground md:my-4 md:h-[calc(100dvh-32px)] md:grid-cols-[228px_minmax(0,1fr)] md:rounded-2xl md:border md:border-border/70 md:shadow-[0_24px_80px_rgba(0,0,0,.42)]">
      <div className="emery-grid pointer-events-none absolute inset-0 z-0 opacity-70" aria-hidden="true" />
      <aside className="relative z-20 hidden min-h-0 overflow-hidden border-r border-sidebar-border bg-sidebar/95 md:flex md:flex-col">
        <div className="flex shrink-0 items-center gap-3 px-4 pb-5 pt-5">
          <Link to="/chat" className="relative flex size-10 items-center justify-center overflow-hidden rounded-xl border border-live/20 bg-live/[0.04] shadow-[0_0_24px_rgba(34,211,238,.06)] focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open Emery">
            <img src={brainImage} alt="" className="emery-blue-brain size-9 object-cover" />
          </Link>
          <div><p className="text-sm font-semibold tracking-[-0.01em]">Emery</p><p className="text-[11px] uppercase tracking-[.12em] text-muted-foreground">Personal Intelligence</p></div>
        </div>

        <nav className="emery-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {desktopNav.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to === "/chat" && returnTo ? "/conversation" : to} onClick={() => { if (to === "/chat" && returnTo) rememberEmeryHandoff(); }} className="emery-press flex min-h-11 items-center gap-3 rounded-xl border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground" activeProps={{ className: "border-primary/20 bg-primary/10 text-primary [&_svg]:stroke-[2.2]" }}>
              <Icon className="size-[17px]" /><span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border/35 p-2">
          <Link to="/settings" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground" activeProps={{ className: "bg-primary/[0.08] text-primary" }}><SettingsIcon className="size-[17px]" />Settings</Link>
        </div>
      </aside>

      <div className="relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className={`z-40 flex shrink-0 items-center justify-between border-b border-border/55 bg-surface/90 px-3 pt-[max(0.35rem,env(safe-area-inset-top))] backdrop-blur-lg sm:px-5 ${onEmerySurface ? "min-h-[44px] pb-1 md:min-h-[54px]" : "min-h-[54px] pb-1.5"}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {!onEmerySurface ? <Link to="/conversation" onClick={rememberEmeryHandoff} className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-live/18 bg-live/[0.035] md:hidden" aria-label="Open Emery conversation"><img src={brainImage} alt="" className="emery-blue-brain size-8 object-cover" /></Link> : null}
             <div className="min-w-0"><p className="truncate text-[13px] font-semibold uppercase tracking-[0.08em] sm:text-base sm:normal-case sm:tracking-normal">{onDashboard ? "Emery" : title}</p>{!onEmerySurface ? <p className="hidden truncate text-[10px] uppercase tracking-[.12em] text-muted-foreground md:block">Emery System</p> : null}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
             {!onEmerySurface && !onHpo ? <EmeryVoiceControl /> : null}
             {onConversation && lastReturn ? <Link to={lastReturn} onClick={clearReturnContext} className="flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-xs text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"><ArrowLeft className="size-4" /><span className="max-w-24 truncate">{emeryReturnLabel(lastReturn)}</span></Link> : null}
          </div>
        </header>

        {updateAvailable ? <div className="z-30 flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-primary/15 bg-primary/[0.055] px-3 text-xs sm:px-5"><span className="text-muted-foreground">A newer Emery build is ready.</span><button type="button" onClick={() => { const next = new URL(window.location.href); next.searchParams.set("_emery_build", EMERY_BUILD_ID); next.searchParams.set("_refresh", String(Date.now())); window.location.replace(next.toString()); }} className="min-h-10 shrink-0 rounded-lg px-3 font-semibold text-primary hover:bg-primary/[0.08]">Reload latest</button></div> : null}

        <main className={`emery-route-enter relative min-h-0 flex-1 ${padded ? "emery-scrollbar overflow-y-auto overscroll-contain px-4 py-4 [touch-action:pan-y] [-webkit-overflow-scrolling:touch] sm:px-5 md:px-7 md:py-6" : "overflow-hidden"}`}>{children}</main>

        <nav className="emery-mobile-nav z-40 grid shrink-0 grid-cols-4 gap-1 border-t border-border/65 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 md:hidden" aria-label="Primary navigation">
          {primaryNav.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="emery-press relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium text-muted-foreground transition-all" activeProps={{ className: "emery-nav-active text-live font-semibold [&_svg]:stroke-[2.35]" }}><Icon className="size-[20px]" /><span>{label}</span></Link>
          ))}
          <Button variant="ghost" type="button" onClick={() => setMoreOpen(true)} aria-label="Open more navigation" aria-expanded={moreOpen} className={`emery-press flex h-auto min-h-[52px] w-full flex-col items-center justify-center gap-1 rounded-md p-0 text-[11px] font-medium transition-all ${moreActive ? "emery-nav-active text-live" : "text-muted-foreground"}`}><MoreHorizontal className="size-[20px]" /><span>More</span></Button>
        </nav>
      </div>

      {moreOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end bg-background/72 backdrop-blur-[6px] md:hidden" onClick={() => setMoreOpen(false)} role="presentation">
          <section className="emery-sheet-in max-h-[82dvh] w-full overflow-hidden rounded-t-[1.6rem] border-t border-border/55 bg-popover/98 px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-20px_60px_rgba(0,0,0,0.38)]" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="More Emery destinations">
            <div className="mx-auto mt-0.5 h-1 w-10 rounded-full bg-border/80" />
            <div className="flex shrink-0 items-center justify-between px-1 pb-2 pt-3"><div><p className="text-[15px] font-semibold">More</p><p className="mt-0.5 text-[11px] text-muted-foreground">Everything important, without crowding your daily navigation.</p></div><Button variant="ghost" type="button" onClick={() => setMoreOpen(false)} className="size-10 rounded-xl text-muted-foreground hover:bg-white/[0.03] hover:text-foreground" aria-label="Close more navigation"><X className="size-4" /></Button></div>
            <div className="emery-scrollbar max-h-[calc(82dvh-5.5rem)] space-y-4 overflow-y-auto overscroll-contain pb-1 [-webkit-overflow-scrolling:touch]">
              {["Your Space", "Emery System"].map((group) => {
                const items = moreItems.filter((item) => item.group === group);
                return <section key={group}><p className="mb-1.5 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">{group}</p><div className="overflow-hidden rounded-2xl border border-border/40 bg-card/38">{items.map(({ to, label, description, icon: Icon }, index) => <Link key={to} to={to} className={`emery-press flex min-h-[68px] items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-white/[0.025] ${index ? "border-t border-border/30" : ""}`}><div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/[0.055] text-primary"><Icon className="size-[17px]" /></div><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">{label}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p></div></Link>)}</div></section>;
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: typeof Brain; title: string; description: string }) {
  return <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-14 text-center"><div className="flex size-11 items-center justify-center rounded-xl bg-primary/[0.06] text-primary"><Icon className="size-5" /></div><h2 className="text-[15px] font-semibold">{title}</h2><p className="text-sm leading-6 text-muted-foreground">{description}</p></div>;
}
