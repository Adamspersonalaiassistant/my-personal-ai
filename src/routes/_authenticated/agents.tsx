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
        <section className="emery-glass overflow-hidden rounded-3xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="size-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em]">Emery's team</p>
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">
                One family. Different specialties.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Emery stays in charge. You can work with a specialist here without losing the
                context, judgment and accountability of your main assistant.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Create agent</span>
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/[0.045] px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            New agents inherit Emery's privacy, truthfulness and approval boundaries by default.
          </div>
        </section>

        {error ? (
          <p className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Gathering the team…</p>
        ) : (
          <section className="space-y-3">
            {agents.map((agent) => {
              const Icon = agentIcon(agent.slug);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() =>
                    navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })
                  }
                  className="emery-glass group w-full rounded-3xl p-4 text-left transition hover:border-primary/25"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.07] text-primary shadow-[0_0_22px_oklch(0.78_0.19_154/0.08)]">
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold tracking-tight">{agent.name}</h3>
                          <p className="mt-0.5 text-xs font-medium text-primary/90">
                            {agent.description}
                          </p>
                        </div>
                        <ChevronRight className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {agent.mission}
                      </p>

                      {agent.children?.length ? (
                        <div className="mt-3 rounded-2xl border border-border/55 bg-card/55 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            HPO internal team
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {agent.children.map((child) => (
                              <span
                                key={child.id}
                                className="rounded-full border border-primary/15 bg-primary/[0.05] px-2.5 py-1 text-[11px] font-medium text-foreground/90"
                              >
                                {child.name.replace(" Agent", "")}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                            They report to HPO Agent. You never have to manage them directly.
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
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center"
          onClick={() => setShowCreate(false)}
        >
          <form
            onSubmit={handleCreate}
            onClick={(event) => event.stopPropagation()}
            className="emery-glass max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Create a specialist</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Emery stays in charge. Give the new family member one clear mission.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Agent name — e.g. Finance Agent"
                autoFocus
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40"
              />
              <textarea
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                placeholder="What should this agent be responsible for?"
                rows={4}
                className="w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 py-3 text-sm outline-none focus:border-primary/40"
              />
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Short specialty (optional)"
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40"
              />
              <textarea
                value={persona}
                onChange={(event) => setPersona(event.target.value)}
                placeholder="Personality / working style (optional)"
                rows={3}
                className="w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 py-3 text-sm outline-none focus:border-primary/40"
              />
              <button
                type="submit"
                disabled={!name.trim() || !mission.trim() || saving}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
              >
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
