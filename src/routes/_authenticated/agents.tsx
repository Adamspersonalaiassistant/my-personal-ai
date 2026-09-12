import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BrainCircuit,
  ChevronRight,
  Compass,
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
  children: ChildAgent[];
};

function agentIcon(slug: string) {
  if (slug === "hpo-agent") return Users;
  if (slug === "research-agent") return Search;
  if (slug === "strategy-agent") return Compass;
  return BrainCircuit;
}

function agentAccent(slug: string) {
  if (slug === "hpo-agent") return "from-emerald-300/14 to-primary/4";
  if (slug === "research-agent") return "from-cyan-300/10 to-primary/4";
  if (slug === "strategy-agent") return "from-lime-200/10 to-primary/4";
  return "from-primary/12 to-primary/3";
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
      <div className="space-y-4">
        <section className="emery-glass-strong overflow-hidden rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="size-4" />
                <p className="emery-kicker">Emery's team</p>
              </div>
              <h2 className="mt-2 text-[1.35rem] font-semibold tracking-[-0.025em]">
                One family. Different specialties.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Emery stays in command while specialists bring focused judgment to the work that needs it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-[0_0_22px_oklch(0.805_0.175_155/0.1)]"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Create agent</span>
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-primary/12 bg-primary/[0.035] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            Specialists inherit Emery's privacy, truthfulness and approval boundaries by default.
          </div>
        </section>

        {error ? (
          <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-3 py-1">
            {[0, 1, 2].map((item) => (
              <div key={item} className="emery-glass h-36 animate-pulse rounded-[1.6rem] opacity-60" />
            ))}
          </div>
        ) : (
          <section className="space-y-3">
            {agents.map((agent, index) => {
              const Icon = agentIcon(agent.slug);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })}
                  className="emery-press emery-glass group relative w-full overflow-hidden rounded-[1.6rem] p-4 text-left hover:border-primary/25 sm:p-5"
                  style={{ animationDelay: `${index * 45}ms` }}
                >
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${agentAccent(agent.slug)} opacity-80`} />
                  <div className="relative flex items-start gap-3.5">
                    <div className="emery-icon-well flex size-12 shrink-0 items-center justify-center rounded-[1.05rem]">
                      <Icon className="size-5" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold tracking-[-0.015em]">{agent.name}</h3>
                            <span className="emery-chip">Active</span>
                          </div>
                          <p className="mt-1 text-xs font-medium text-primary/85">{agent.description}</p>
                        </div>
                        <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                      <p className="mt-2.5 text-sm leading-6 text-muted-foreground">{agent.mission}</p>

                      {agent.children?.length ? (
                        <div className="emery-surface mt-4 rounded-2xl p-3.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">HPO internal team</p>
                            <span className="text-[10px] font-medium text-primary/75">Reports to HPO Agent</span>
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {agent.children.map((child) => (
                              <span key={child.id} className="emery-chip text-foreground/90">
                                <span className="size-1.5 rounded-full bg-primary/70" />
                                {child.name.replace(" Agent", "")}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2.5 text-[11px] leading-5 text-muted-foreground">
                            Scout, Route and Relationship work behind the scenes. Adam never has to manage them directly.
                          </p>
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
        <div className="fixed inset-0 z-50 flex items-end bg-black/65 p-3 backdrop-blur-md sm:items-center sm:justify-center" onClick={() => setShowCreate(false)}>
          <form
            onSubmit={handleCreate}
            onClick={(event) => event.stopPropagation()}
            className="emery-glass-strong max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[1.8rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="emery-kicker">Agent builder</p>
                <h3 className="mt-1.5 text-lg font-semibold tracking-tight">Create a specialist</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Emery stays in charge. Give the new family member one clear mission.
                </p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Close create agent">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Agent name — e.g. Finance Agent" autoFocus className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none focus:border-primary/40" />
              <textarea value={mission} onChange={(event) => setMission(event.target.value)} placeholder="What should this agent be responsible for?" rows={4} className="w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 py-3 text-sm outline-none focus:border-primary/40" />
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short specialty (optional)" className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 text-sm outline-none focus:border-primary/40" />
              <textarea value={persona} onChange={(event) => setPersona(event.target.value)} placeholder="Personality / working style (optional)" rows={3} className="w-full rounded-2xl border border-border/60 bg-card/60 px-3.5 py-3 text-sm outline-none focus:border-primary/40" />
              <button type="submit" disabled={!name.trim() || !mission.trim() || saving} className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground shadow-[0_0_22px_oklch(0.805_0.175_155/0.1)] disabled:opacity-40">
                <BrainCircuit className="size-4" />
                {saving ? "Creating…" : "Create agent"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
