import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BrainCircuit,
  ChevronRight,
  Compass,
  Crown,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { createAgent, listAgents } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/agents")({ component: Agents });

type ChildAgent = { id: string; name: string; slug: string; description: string };
type Agent = {
  id: string;
  name: string;
  slug: string;
  description: string;
  mission: string;
  is_custom: boolean;
  children: ChildAgent[];
};

function agentIcon(slug: string) {
  if (slug === "hpo-agent") return Users;
  if (slug === "research-agent") return Search;
  if (slug === "strategy-agent") return Compass;
  return BrainCircuit;
}

function agentRole(agent: Agent) {
  if (agent.slug === "hpo-agent") return "Hudson Pro leadership";
  if (agent.slug === "research-agent") return "Research & synthesis";
  if (agent.slug === "strategy-agent") return "Decision challenge";
  return agent.is_custom ? "Custom specialist" : "Core specialist";
}

function Agents() {
  const navigate = useNavigate();
  const loadAgents = useServerFn(listAgents);
  const addAgent = useServerFn(createAgent);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [description, setDescription] = useState("");
  const [persona, setPersona] = useState("");

  async function refresh() {
    const result = await loadAgents({});
    setAgents((result?.agents ?? []) as Agent[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadAgents({});
        if (!cancelled) setAgents((result?.agents ?? []) as Agent[]);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Couldn't load Emery's agent family.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAgents]);

  const specialistCount = useMemo(
    () => agents.filter((agent) => !agent.is_custom).length,
    [agents],
  );
  const customCount = useMemo(() => agents.filter((agent) => agent.is_custom).length, [agents]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !mission.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await addAgent({ data: { name, mission, description, persona } });
      setShowCreate(false);
      setName("");
      setMission("");
      setDescription("");
      setPersona("");
      await refresh();
      if (result?.agent?.id) {
        navigate({ to: "/agents/$agentId", params: { agentId: result.agent.id } });
      }
    } catch (err) {
      console.error(err);
      setError("Couldn't create that agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Agents">
      <div className="space-y-5">
        <section className="emery-glass-strong overflow-hidden rounded-[1.8rem] p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-primary">
                <Crown className="size-4" />
                <p className="emery-kicker">Emery leads</p>
              </div>
              <h2 className="mt-2 max-w-xl text-[1.45rem] font-semibold tracking-[-0.035em] sm:text-[1.6rem]">
                Your specialist team, organized around one leader.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                You talk to Emery. She brings in the right specialist, keeps the bigger picture in
                view, and stays responsible for the final recommendation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="emery-press flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_12px_30px_oklch(0.3_0.09_158/0.18)]"
            >
              <Plus className="size-4" />
              Create specialist
            </button>
          </div>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="emery-surface rounded-2xl p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.055] text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">One Emery, many specialties</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    Core specialists are always available. Custom specialists join the same family.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:min-w-[190px]">
              <TeamMetric label="Core" value={specialistCount} />
              <TeamMetric label="Custom" value={customCount} />
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-primary/10 bg-primary/[0.025] px-3.5 py-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Every specialist inherits Emery's privacy, truthfulness, and approval boundaries. You
              can also ask Emery in the main chat to create a new specialist for a recurring need.
            </span>
          </div>
        </section>

        {error ? (
          <p
            className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-3 py-1">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="emery-glass h-40 animate-pulse rounded-[1.6rem] opacity-55"
              />
            ))}
          </div>
        ) : (
          <section className="space-y-3" aria-label="Emery specialist team">
            <div className="flex items-center justify-between px-1">
              <div>
                <p className="text-sm font-semibold">Specialists</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tap a specialist to open the persistent group chat.
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {agents.length} active
              </span>
            </div>

            {agents.map((agent) => {
              const Icon = agentIcon(agent.slug);
              const hasTeam = Boolean(agent.children?.length);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() =>
                    navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })
                  }
                  className="emery-press emery-glass group w-full rounded-[1.65rem] p-4 text-left hover:border-primary/25 sm:p-5"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="emery-icon-well flex size-12 shrink-0 items-center justify-center rounded-[1.05rem]">
                      <Icon className="size-5" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 className="truncate text-base font-semibold tracking-[-0.018em]">
                              {agent.name}
                            </h3>
                            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-primary/80">
                              {agentRole(agent)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                            {agent.description}
                          </p>
                        </div>
                        <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>

                      <p className="mt-2.5 text-sm leading-6 text-foreground/88">{agent.mission}</p>

                      {hasTeam ? (
                        <div className="mt-4 rounded-2xl border border-border/45 bg-background/20 p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                                Internal HPO team
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Works behind the scenes under HPO Agent
                              </p>
                            </div>
                            <span className="rounded-full border border-primary/12 bg-primary/[0.04] px-2.5 py-1 text-[10px] font-semibold text-primary/85">
                              {agent.children.length} specialists
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {agent.children.map((child) => (
                              <div
                                key={child.id}
                                className="rounded-xl border border-border/40 bg-card/35 px-3 py-2.5"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="size-1.5 rounded-full bg-primary/75" />
                                  <span className="text-xs font-semibold">
                                    {child.name.replace(" Agent", "")}
                                  </span>
                                </div>
                                {child.description ? (
                                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                                    {child.description}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </section>
        )}
      </div>

      {showCreate ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/65 p-2 backdrop-blur-md sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowCreate(false)}
        >
          <form
            onSubmit={handleCreate}
            onClick={(event) => event.stopPropagation()}
            className="emery-glass-strong max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-[1.9rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="emery-kicker">New specialist</p>
                <h3 className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">
                  Give Emery another expert.
                </h3>
                <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
                  Start with one clear responsibility. Emery will remain the leader and bring this
                  specialist in when it helps.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:bg-white/5 hover:text-foreground"
                aria-label="Close create agent"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <Field label="Name" hint="Keep it simple and recognizable.">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Finance Agent"
                  autoFocus
                  className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
                />
              </Field>

              <Field label="Mission" hint="The one job this specialist should own.">
                <textarea
                  value={mission}
                  onChange={(event) => setMission(event.target.value)}
                  placeholder="Help me understand my finances, prioritize debt and savings, and challenge weak money decisions."
                  rows={4}
                  className="w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 py-3 text-[16px] leading-6 outline-none transition focus:border-primary/40 sm:text-sm"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Specialty" hint="Optional short description.">
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Personal finance"
                    className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
                  />
                </Field>
                <Field label="Working style" hint="Optional personality cue.">
                  <input
                    value={persona}
                    onChange={(event) => setPersona(event.target.value)}
                    placeholder="Direct, conservative, numbers-first"
                    className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/55 px-3.5 text-[16px] outline-none transition focus:border-primary/40 sm:text-sm"
                  />
                </Field>
              </div>

              <div className="rounded-2xl border border-primary/10 bg-primary/[0.025] px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                After creation, you’ll go straight into a persistent{" "}
                <span className="font-semibold text-foreground">Adam + Emery + specialist</span>{" "}
                group chat.
              </div>

              <button
                type="submit"
                disabled={!name.trim() || !mission.trim() || saving}
                className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_12px_30px_oklch(0.3_0.09_158/0.18)] disabled:opacity-40"
              >
                <BrainCircuit className="size-4" />
                {saving ? "Creating specialist…" : "Create specialist"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}

function TeamMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="emery-surface rounded-2xl px-3 py-2.5 text-center">
      <p className="text-lg font-semibold tracking-tight">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}
