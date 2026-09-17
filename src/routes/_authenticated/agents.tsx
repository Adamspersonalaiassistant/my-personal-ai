import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, ChevronRight, Compass, Crown, Plus, Search, Users, X } from "lucide-react";
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
  if (agent.slug === "hpo-agent") return "Hudson Pro operations";
  if (agent.slug === "research-agent") return "Research & synthesis";
  if (agent.slug === "strategy-agent") return "Strategy & challenge";
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
      } catch (caught) {
        console.error(caught);
        if (!cancelled) setError("Couldn't load Emery's specialist team.");
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
    } catch (caught) {
      console.error(caught);
      setError("Couldn't create that specialist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Agents">
      <div className="mx-auto max-w-3xl pb-3">
        <div className="flex items-end justify-between gap-4 pb-4">
          <div>
            <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">Agents</h1>
            <p className="mt-1 text-sm text-muted-foreground">Specialists under one Emery.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="emery-press flex min-h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" /> Add
          </button>
        </div>

        <section className="mb-4 flex items-center gap-3 rounded-xl border border-border/35 bg-card/24 px-3.5 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.065] text-primary">
            <Crown className="size-4" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Emery is the commander</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Specialists advise. Emery keeps your full context and owns the final synthesis.
            </p>
          </div>
        </section>

        {error ? (
          <p className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/28">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-[86px] animate-pulse border-b border-border/30 last:border-b-0">
                <div className="mx-4 mt-6 h-3 w-2/3 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : agents.length ? (
          <section className="overflow-hidden rounded-2xl border border-border/40 bg-card/28" aria-label="Emery specialist team">
            {agents.map((agent, index) => {
              const Icon = agentIcon(agent.slug);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })}
                  className={`emery-press group flex min-h-[86px] w-full items-start gap-3 px-3.5 py-3.5 text-left hover:bg-white/[0.025] ${index < agents.length - 1 ? "border-b border-border/30" : ""}`}
                >
                  <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.055] text-primary">
                    <Icon className="size-[18px]" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="truncate text-[14px] font-semibold">{agent.name}</p>
                          <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-primary/75">
                            {agentRole(agent)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {agent.mission || agent.description}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>

                    {agent.children?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {agent.children.map((child) => (
                          <span key={child.id} className="rounded-md bg-white/[0.035] px-2 py-1 text-[9px] font-medium text-muted-foreground">
                            {child.name.replace(" Agent", "")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </section>
        ) : (
          <div className="py-14 text-center">
            <BrainCircuit className="mx-auto size-7 text-primary/75" strokeWidth={1.7} />
            <p className="mt-3 text-sm font-medium">No specialists yet.</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
              Create one for a recurring area where Emery benefits from a dedicated second set of eyes.
            </p>
          </div>
        )}
      </div>

      {showCreate ? (
        <div
          className="fixed inset-0 z-[80] flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowCreate(false)}
        >
          <form
            onSubmit={handleCreate}
            onClick={(event) => event.stopPropagation()}
            className="emery-sheet-in max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[1.6rem] border border-border/50 bg-[oklch(0.125_0.034_255/0.985)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-24px_70px_rgba(0,0,0,0.45)] sm:rounded-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/12 sm:hidden" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold">New specialist</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Give it one clear job.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="emery-press flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/[0.04]"
                aria-label="Close create agent"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Specialist name"
                autoFocus
                className="min-h-12 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[16px] outline-none focus:border-primary/40"
              />
              <textarea
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                placeholder="What should this specialist own?"
                rows={3}
                className="w-full rounded-xl border border-border/55 bg-card/45 px-3.5 py-3 text-[16px] leading-6 outline-none focus:border-primary/40"
              />
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Specialty (optional)"
                className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[15px] outline-none focus:border-primary/40"
              />
              <input
                value={persona}
                onChange={(event) => setPersona(event.target.value)}
                placeholder="Working style (optional)"
                className="min-h-11 w-full rounded-xl border border-border/55 bg-card/45 px-3.5 text-[15px] outline-none focus:border-primary/40"
              />
              <button
                type="submit"
                disabled={!name.trim() || !mission.trim() || saving}
                className="emery-press flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-40"
              >
                <BrainCircuit className="size-4" />
                {saving ? "Creating…" : "Create specialist"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
