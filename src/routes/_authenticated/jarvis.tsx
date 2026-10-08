import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  GitBranch,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AssistantText } from "@/components/AssistantText";
import { JarvisRoom } from "@/components/JarvisRoom";
import { JarvisVoiceControl } from "@/components/JarvisVoiceControl";
import {
  getJarvisControlCenterIssues,
  getJarvisStatusPanel,
} from "@/lib/jarvis.functions";

export const Route = createFileRoute("/_authenticated/jarvis")({
  component: JarvisControlCenter,
});

type Panel = Awaited<ReturnType<typeof getJarvisStatusPanel>>;
type Issues = Awaited<ReturnType<typeof getJarvisControlCenterIssues>>;

const CHANGE_STEPS = [
  { title: "Evidence", description: "Confirm the current problem using source code and runtime state" },
  { title: "Candidate", description: "Build an isolated, reversible implementation" },
  { title: "Verification", description: "Run relevant checks and inspect actual failures" },
  { title: "Release", description: "Require approval when needed, then verify production" },
];

function JarvisControlCenter() {
  const loadPanel = useServerFn(getJarvisStatusPanel);
  const loadIssues = useServerFn(getJarvisControlCenterIssues);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [issues, setIssues] = useState<Issues | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [view, setView] = useState<"overview" | "conversation">("overview");
  const [selectedIdea, setSelectedIdea] = useState<string | null>(null);
  const [lastSpokenAnswer, setLastSpokenAnswer] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [livePanel, liveIssues] = await Promise.allSettled([loadPanel(), loadIssues()]);
    if (livePanel.status === "fulfilled") {
      setPanel(livePanel.value);
      setPanelError(null);
    } else {
      setPanelError("Production and engineering status could not be refreshed.");
    }
    if (liveIssues.status === "fulfilled") {
      setIssues(liveIssues.value);
      setIssuesError(null);
    } else {
      setIssuesError("Recent diagnostic events could not be refreshed.");
    }
    setRefreshing(false);
    setLoading(false);
  }, [loadPanel, loadIssues]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (view === "conversation") {
    return <JarvisRoom onBack={() => {
      setView("overview");
      void refresh();
    }} />;
  }

  const status = panel?.status;
  const production = panel?.production;
  const sync = production?.in_sync === true ? "In sync" : production?.in_sync === false ? "Out of sync" : "Not verified";
  const ideas = status?.proposed_tasks ?? [];
  const pendingReleases = status?.release_queue ?? [];
  const problems = issues?.recent_problems ?? [];
  const selected = ideas.find((idea) => idea.id === selectedIdea);

  return (
    <AppShell title="JARVIS Control Center">
      <div className="mx-auto max-w-5xl space-y-5 pb-8 text-foreground">
        <header className="flex items-center justify-between gap-3">
          <Link
            to="/settings"
            aria-label="Back to Settings"
            className="emery-press flex min-h-10 items-center gap-2 rounded-xl border border-border/50 bg-card/30 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Settings
          </Link>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="emery-press flex min-h-10 items-center gap-2 rounded-xl border border-border/50 bg-card/30 px-3 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`} />
            Refresh live state
          </button>
        </header>

        <section className="relative isolate overflow-hidden rounded-[1.7rem] border border-cyan-400/20 bg-[radial-gradient(ellipse_at_50%_15%,rgba(19,78,138,0.32),transparent_58%),linear-gradient(165deg,#061629,#050b19_68%,#0b1330)] px-4 pb-6 pt-6 text-white shadow-[0_16px_60px_rgba(0,22,48,0.2)] sm:px-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-cyan-200/70">
              Engineering intelligence
            </p>
            <h1 className="mt-2 text-[1.6rem] font-semibold tracking-[-0.045em] sm:text-3xl">
              JARVIS Control Center
            </h1>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-300">
              Your engineering partner. Live system evidence, technical ideas, diagnostics and release oversight.
            </p>
          </div>

          <div className="mt-5 flex flex-col items-center gap-4">
            <JarvisVoiceControl
              variant="core"
              onTurn={(result) => {
                const answer = result.agentMessage?.content;
                if (answer) setLastSpokenAnswer(answer);
                void refresh();
              }}
            />
            <button
              type="button"
              onClick={() => setView("conversation")}
              className="emery-press flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-5 text-sm font-medium text-cyan-100 hover:bg-cyan-300/15"
            >
              <MessageSquare className="size-4" /> Open engineering conversation
              <ChevronRight className="size-4" />
            </button>
          </div>
          {lastSpokenAnswer ? (
            <div className="mx-auto mt-5 max-w-2xl rounded-xl border border-cyan-300/20 bg-slate-950/50 p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">
                JARVIS · latest spoken turn
              </p>
              <div className="max-h-56 overflow-y-auto text-sm leading-6 text-slate-100">
                <AssistantText text={lastSpokenAnswer} />
              </div>
            </div>
          ) : null}
        </section>

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/50 p-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Reading current engineering state…
          </div>
        ) : null}
        {panelError ? <Notice text={panelError} /> : null}
        {issuesError ? <Notice text={issuesError} /> : null}

        <section aria-label="Production status" className="space-y-3">
          <SectionHeading icon={Activity} title="Production overview" description="Live engineering state where available; unknown values stay unknown." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Production commit" value={production?.commit?.slice(0, 7) ?? "Unknown"} />
            <Metric label="GitHub main" value={production?.github_main?.slice(0, 7) ?? "Unknown"} />
            <Metric label="Deployment sync" value={sync} caution={production?.in_sync === false} />
            <Metric label="Tasks today" value={status ? `${status.accepted_today} / ${status.capacity}` : "Unknown"} />
          </div>
          {production?.discrepancies?.length ? (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-3.5">
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                <AlertTriangle className="size-4" /> Deployment discrepancies
              </p>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                {production.discrepancies.slice(0, 4).map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
          ) : null}
        </section>

        <section aria-label="Engineering work" className="space-y-3">
          <SectionHeading icon={Cpu} title="Engineering operations" description="Real production tasks only; fixtures are excluded from capacity and work counts." />
          <div className="grid grid-cols-3 gap-2">
            <Metric label="In progress" value={status ? String(status.ready_for_more_tasks.in_flight) : "—"} />
            <Metric label="Blocked" value={status ? String(status.status_counts.blocked ?? 0) : "—"} caution={Boolean(status?.status_counts.blocked)} />
            <Metric label="Completed" value={status ? String(status.status_counts.completed ?? 0) : "—"} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {(status?.open_tasks ?? []).slice(0, 5).map((task) => (
              <article key={task.id} className="rounded-xl border border-border/45 bg-card/30 p-3.5">
                <p className="text-sm font-medium">{task.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatePill value={task.status} />
                  <span className="text-[10px] text-muted-foreground">Priority {task.priority ?? "not rated"}</span>
                </div>
                {task.blocker ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{task.blocker}</p> : null}
              </article>
            ))}
          </div>
          {status && status.open_tasks.length === 0 ? <Empty text="No approved engineering tasks currently in progress." /> : null}
        </section>

        <section aria-label="Issue radar" className="space-y-3">
          <SectionHeading icon={AlertTriangle} title="Diagnostics and issues" description="Recent observed errors and failed actions, not an invented complete bug list." />
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Failed executions · 7d" value={issues ? String(issues.failed_executions) : "Unknown"} caution={Boolean(issues?.failed_executions)} />
            <Metric label="Needs clarification · 7d" value={issues ? String(issues.unresolved_executions) : "Unknown"} />
          </div>
          {problems.length ? (
            <div className="divide-y divide-border/35 overflow-hidden rounded-2xl border border-border/45 bg-card/25">
              {problems.slice(0, 6).map((problem, i) => (
                <div key={`${problem.at}-${i}`} className="flex items-start justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="break-words text-xs font-medium">{problem.domain ?? problem.event_type} · {problem.action ?? "Unspecified action"}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{problem.event_type} · {new Date(problem.at).toLocaleString()}</p>
                  </div>
                  <StatePill value={problem.status} />
                </div>
              ))}
            </div>
          ) : issues ? <Empty text="No recent problems returned by the bounded telemetry view." /> : null}
          <button type="button" onClick={() => setView("conversation")} className="emery-press text-xs font-medium text-primary hover:underline">
            Ask JARVIS to investigate these signals <ArrowUpRight className="inline size-3" />
          </button>
        </section>

        <section aria-label="Improvement ideas" className="space-y-3">
          <SectionHeading icon={Lightbulb} title="Improvement Lab" description="Real proposed engineering work. Open a proposal to inspect its path to production." />
          {ideas.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {ideas.slice(0, 10).map((idea) => (
                <button
                  type="button"
                  key={idea.id}
                  aria-expanded={selectedIdea === idea.id}
                  onClick={() => setSelectedIdea((current) => current === idea.id ? null : idea.id)}
                  className={`emery-press rounded-xl border p-4 text-left transition-colors hover:border-primary/40 ${selectedIdea === idea.id ? "border-primary/40 bg-primary/[0.055]" : "border-border/45 bg-card/30"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{idea.title}</p>
                    <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${selectedIdea === idea.id ? "rotate-180" : ""}`} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Priority {idea.priority ?? "unrated"} · {idea.status} · awaiting approval</p>
                </button>
              ))}
            </div>
          ) : status ? <Empty text="No unapproved improvement ideas are recorded in the current task window." /> : null}
          {selected ? (
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.025] p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Proposal pathway · not a built preview</p>
              <h3 className="mt-2 text-sm font-semibold">{selected.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Existing task evidence and required delivery stages. JARVIS must research and validate an actual design before claiming a working preview.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                {CHANGE_STEPS.map((step, i) => (
                  <div key={step.title} className="relative rounded-xl border border-border/45 bg-card/45 p-3">
                    <p className="text-[10px] font-semibold text-primary">0{i + 1} · {step.title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{step.description}</p>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setView("conversation")} className="emery-press mt-4 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary">
                Discuss this proposal with JARVIS
              </button>
            </div>
          ) : null}
          {(status?.self_improvement_research ?? []).length > 0 ? (
            <div className="rounded-xl border border-border/45 bg-card/25 p-3.5">
              <p className="text-xs font-semibold">Latest self-research</p>
              {(status?.self_improvement_research ?? []).slice(0, 3).map((finding) => (
                <p key={finding.id} className="mt-2 text-xs leading-5 text-muted-foreground">
                  {finding.topic} · {finding.classification}
                </p>
              ))}
            </div>
          ) : null}
        </section>

        <section aria-label="Release approvals" className="space-y-3">
          <SectionHeading icon={GitBranch} title="Release Control" description="A proposal is not deployed. Approval, checks and served-production verification are separate steps." />
          {pendingReleases.length ? (
            <div className="space-y-2">
              {pendingReleases.map((release) => (
                <div key={release.task_id} className="rounded-xl border border-border/45 bg-card/25 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{release.title}</p>
                    <StatePill value={release.state} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{release.note ?? "Inspect the exact candidate before deciding whether to release."}</p>
                  {release.pr_url?.startsWith("https://github.com/Adamspersonalaiassistant/my-personal-ai/pull/") ? (
                    <a href={release.pr_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      Review candidate PR <ArrowUpRight className="size-3" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : status ? <Empty text="No release candidates are currently listed." /> : null}
          {status?.approvals_required?.length ? (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] px-3.5 py-3 text-xs text-amber-100/90">
              {status.approvals_required.length} approval item(s) need review in the engineering conversation.
            </div>
          ) : null}
        </section>

        <footer className="flex items-start gap-2 rounded-xl border border-border/45 bg-card/25 p-3.5 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          JARVIS uses owner-authenticated existing engineering tools and guarded releases. This dashboard does not grant autonomous production access, mark unverified fixes as deployed, or count validation fixtures as actual work.
        </footer>
      </div>
    </AppShell>
  );
}

type IconType = typeof Cpu;

function SectionHeading({ icon: Icon, title, description }: { icon: IconType; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.055] text-primary">
        <Icon className="size-[17px]" strokeWidth={1.8} />
      </span>
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, caution = false }: { label: string; value: string; caution?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/45 bg-card/30 px-3 py-3">
      <p className="text-[10px] leading-4 text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold tabular-nums ${caution ? "text-amber-200" : ""}`} title={value}>{value}</p>
    </div>
  );
}

function StatePill({ value }: { value: string }) {
  const tone = /^(completed|verified|released)$/i.test(value)
    ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200"
    : /^(blocked|error|failed|deployment_failed)$/i.test(value)
      ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-200"
      : "border-border/50 bg-card/40 text-muted-foreground";
  return <span className={`inline-flex shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

function Notice({ text }: { text: string }) {
  return <div role="alert" className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3 text-xs text-amber-200">{text}</div>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-border/35 bg-card/20 p-3 text-xs text-muted-foreground">{text}</p>;
}
