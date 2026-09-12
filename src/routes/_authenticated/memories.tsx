import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  Brain,
  BriefcaseBusiness,
  Check,
  CircleDot,
  Clock3,
  Compass,
  Database,
  HeartHandshake,
  Pencil,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { listMemories } from "@/lib/chat.functions";
import { deleteSavedMemory, updateSavedMemory } from "@/lib/memory.functions";

export const Route = createFileRoute("/_authenticated/memories")({ component: Memories });

type Memory = {
  id: string;
  title: string | null;
  content: string;
  memory_type: string;
  importance: number;
  created_at: string;
  updated_at: string;
};
type Profile = {
  display_name: string | null;
  assistant_name: string | null;
  timezone: string | null;
  profile_summary: string | null;
};

type CategoryKey =
  | "all"
  | "goals"
  | "preferences"
  | "relationships"
  | "responsibilities"
  | "routines"
  | "projects"
  | "working"
  | "decisions"
  | "core";

const categories: Array<{
  key: CategoryKey;
  label: string;
  icon: typeof Brain;
  types: string[];
}> = [
  { key: "all", label: "All", icon: Brain, types: [] },
  { key: "goals", label: "Goals", icon: Target, types: ["goal"] },
  { key: "preferences", label: "Preferences", icon: Sparkles, types: ["preference"] },
  { key: "relationships", label: "Relationships", icon: HeartHandshake, types: ["relationship"] },
  {
    key: "responsibilities",
    label: "Responsibilities",
    icon: BriefcaseBusiness,
    types: ["responsibility"],
  },
  { key: "routines", label: "Routines", icon: Clock3, types: ["routine"] },
  { key: "projects", label: "Projects", icon: Compass, types: ["project_context"] },
  {
    key: "working",
    label: "Working style",
    icon: UsersRound,
    types: ["working_preference"],
  },
  {
    key: "decisions",
    label: "Decisions & constraints",
    icon: ShieldCheck,
    types: ["decision", "constraint"],
  },
  { key: "core", label: "Core / Other", icon: Database, types: ["core"] },
];

const editableTypes = [
  ["core", "Core / Other"],
  ["goal", "Goal"],
  ["preference", "Preference"],
  ["relationship", "Relationship"],
  ["responsibility", "Responsibility"],
  ["routine", "Routine"],
  ["project_context", "Project context"],
  ["working_preference", "Working preference"],
  ["decision", "Decision"],
  ["constraint", "Constraint"],
] as const;

function categoryForMemory(memory: Memory) {
  return (
    categories.find((category) => category.types.includes(memory.memory_type)) ?? categories.at(-1)!
  );
}

function displayType(type: string) {
  return editableTypes.find(([value]) => value === type)?.[1] ?? "Core / Other";
}

function Memories() {
  const loadMemories = useServerFn(listMemories);
  const saveMemory = useServerFn(updateSavedMemory);
  const removeMemory = useServerFn(deleteSavedMemory);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("all");
  const [editing, setEditing] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  async function refresh() {
    const result = await loadMemories({});
    if (result.error) throw new Error(result.error);
    setMemories(result.memories as Memory[]);
    setProfile(result.profile);
    setProfileError(result.profileError);
  }

  useEffect(() => {
    let cancelled = false;
    void loadMemories({})
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          return;
        }
        setMemories(result.memories as Memory[]);
        setProfile(result.profile);
        setProfileError(result.profileError);
      })
      .catch(() => {
        if (!cancelled) setError("Your saved memories couldn't be loaded. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadMemories]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryKey, number>();
    counts.set("all", memories.length);
    for (const memory of memories) {
      const category = categoryForMemory(memory);
      counts.set(category.key, (counts.get(category.key) ?? 0) + 1);
    }
    return counts;
  }, [memories]);

  const representedCategories = useMemo(
    () =>
      categories.slice(1).filter((category) => (categoryCounts.get(category.key) ?? 0) > 0).length,
    [categoryCounts],
  );
  const importantCount = memories.filter((memory) => memory.importance >= 4).length;
  const latestUpdated = memories.reduce<string | null>(
    (latest, memory) => (!latest || memory.updated_at > latest ? memory.updated_at : latest),
    null,
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const category = categories.find((item) => item.key === activeCategory);
    return [...memories]
      .filter((memory) => {
        const categoryMatch =
          activeCategory === "all" || Boolean(category?.types.includes(memory.memory_type));
        if (!categoryMatch) return false;
        if (!needle) return true;
        return [memory.title ?? "", memory.content, displayType(memory.memory_type)]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => b.importance - a.importance || b.updated_at.localeCompare(a.updated_at));
  }, [activeCategory, memories, query]);

  return (
    <AppShell title="Memories">
      {loading ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
          <div className="emery-breathe emery-icon-well flex size-14 items-center justify-center rounded-[1.1rem]">
            <Brain className="size-5" />
          </div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            Loading what Emery carries forward…
          </p>
        </div>
      ) : error ? (
        <div
          className="mx-auto flex max-w-sm flex-col items-center gap-3 py-20 text-center"
          role="alert"
        >
          <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertCircle className="size-6" />
          </div>
          <h2 className="text-base font-semibold">Memory unavailable</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="emery-glass-strong rounded-[1.7rem] p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="emery-icon-well flex size-12 items-center justify-center rounded-2xl">
                  <UserRound className="size-5" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="emery-kicker">About Adam</p>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
                    What Emery knows
                  </h2>
                </div>
              </div>
              <span className="emery-chip shrink-0">
                {memories.length} {memories.length === 1 ? "memory" : "memories"}
              </span>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Durable context that helps Emery understand the person, priorities and life behind the
              work.
            </p>
            {profileError ? (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {profileError}
              </p>
            ) : profile && Object.values(profile).some(Boolean) ? (
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {profile.display_name ? (
                  <ProfileCell label="Name" value={profile.display_name} />
                ) : null}
                <ProfileCell label="Companion" value={profile.assistant_name || "Emery"} />
                {profile.timezone ? (
                  <ProfileCell label="Timezone" value={profile.timezone} />
                ) : null}
                {profile.profile_summary ? (
                  <div className="emery-surface rounded-2xl p-3.5 sm:col-span-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Profile
                    </dt>
                    <dd className="mt-1.5 text-sm leading-6">{profile.profile_summary}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Emery will build your profile from the durable things you share over time.
              </p>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <HealthCell label="Durable memories" value={String(memories.length)} />
            <HealthCell label="Life areas" value={String(representedCategories)} />
            <HealthCell label="High importance" value={String(importantCount)} />
            <HealthCell
              label="Last updated"
              value={
                latestUpdated
                  ? new Date(latestUpdated).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : "—"
              }
            />
          </section>

          <section className="emery-glass rounded-[1.55rem] p-4">
            <div className="flex gap-3">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.055] text-primary">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Memory stays selective</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Emery carries forward durable context that can improve future conversations. Not
                  every message becomes permanent memory, and tasks, meetings or passing thoughts
                  are not treated as long-term facts just because you mentioned them. Corrections
                  should replace outdated information. These memories stay tied to your Emery
                  account.
                </p>
              </div>
            </div>
          </section>

          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search what Emery remembers…"
                className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/65 pl-10 pr-4 text-sm outline-none transition focus:border-primary/35"
              />
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {categories.map((category) => {
                const Icon = category.icon;
                const active = category.key === activeCategory;
                return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setActiveCategory(category.key)}
                    className={`flex min-h-10 shrink-0 items-center gap-2 rounded-2xl border px-3 text-xs font-semibold transition ${active ? "border-primary/25 bg-primary/[0.09] text-primary" : "border-border/55 bg-card/55 text-muted-foreground"}`}
                  >
                    <Icon className="size-3.5" />
                    {category.label}
                    <span className="opacity-70">{categoryCounts.get(category.key) ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <div>
              <p className="text-sm font-semibold">Memory bank</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {query || activeCategory !== "all"
                  ? `${filtered.length} matching memories`
                  : "Long-term context across your Emery system."}
              </p>
            </div>
            <div className="emery-chip">
              <CircleDot className="size-3.5" /> Online
            </div>
          </div>

          {memories.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="Memory is ready"
              description="Preferences, goals, relationships and durable context Emery learns will appear here."
            />
          ) : filtered.length === 0 ? (
            <div className="emery-glass rounded-[1.55rem] px-5 py-10 text-center">
              <Search className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">Nothing matches that view</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Try another search or switch back to All.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((memory, index) => {
                const category = categoryForMemory(memory);
                const Icon = category.icon;
                return (
                  <li
                    key={memory.id}
                    className="emery-fade-up emery-glass rounded-[1.5rem] p-4"
                    style={{ animationDelay: `${index * 18}ms` }}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="emery-icon-well mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl">
                        <Icon className="size-4" strokeWidth={1.8} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              {memory.title ? (
                                <h3 className="text-sm font-semibold">{memory.title}</h3>
                              ) : null}
                              <span className="emery-chip text-muted-foreground">
                                {category.label}
                              </span>
                              {memory.importance >= 4 ? (
                                <span className="emery-chip">Important</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setEditing(memory)}
                              aria-label="Correct memory"
                              className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-primary/[0.07] hover:text-primary"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleting(memory)}
                              aria-label="Delete memory"
                              className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="mt-2.5 whitespace-pre-wrap text-sm leading-6 text-foreground/95">
                          {memory.content}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                          <span>Importance {memory.importance}/5</span>
                          <span>Updated {new Date(memory.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {editing ? (
        <EditMemorySheet
          memory={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await saveMemory({ data: input });
            await refresh();
            setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteMemorySheet
          memory={deleting}
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            await removeMemory({ data: { id: deleting.id } });
            setMemories((current) => current.filter((memory) => memory.id !== deleting.id));
            setDeleting(null);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function EditMemorySheet({
  memory,
  onClose,
  onSave,
}: {
  memory: Memory;
  onClose: () => void;
  onSave: (input: {
    id: string;
    title: string;
    content: string;
    memoryType: string;
    importance: number;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(memory.title ?? "");
  const [content, setContent] = useState(memory.content);
  const [memoryType, setMemoryType] = useState(
    editableTypes.some(([value]) => value === memory.memory_type) ? memory.memory_type : "core",
  );
  const [importance, setImportance] = useState(memory.importance);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ id: memory.id, title, content, memoryType, importance });
    } catch {
      setError("That correction couldn't be saved. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="emery-glass-strong max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="emery-kicker">Correct memory</p>
            <h3 className="mt-1 text-lg font-semibold">Keep Emery accurate</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Your correction replaces the saved version of this memory.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 items-center justify-center rounded-2xl text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (optional)"
            className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none focus:border-primary/40"
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={5}
            placeholder="What should Emery remember instead?"
            className="w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 py-3 text-sm leading-6 outline-none focus:border-primary/40"
          />
          <select
            value={memoryType}
            onChange={(event) => setMemoryType(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-border/60 bg-card/70 px-3.5 text-sm outline-none"
          >
            {editableTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Importance</span>
              <span>{importance}/5</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              value={importance}
              onChange={(event) => setImportance(Number(event.target.value))}
              className="mt-2 w-full accent-[var(--primary)]"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button
            type="submit"
            disabled={!content.trim() || saving}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Check className="size-4" />
            {saving ? "Saving…" : "Save correction"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteMemorySheet({
  memory,
  onClose,
  onDelete,
}: {
  memory: Memory;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="emery-glass-strong w-full max-w-md rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <Trash2 className="size-4" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">Remove this memory?</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Emery will stop carrying this saved fact forward. This does not delete the original
          conversation it may have come from.
        </p>
        <div className="mt-3 rounded-2xl border border-border/55 bg-card/55 p-3 text-sm leading-6">
          {memory.content}
        </div>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-2xl border border-border/60 bg-card/60 text-sm font-semibold"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              setError(null);
              try {
                await onDelete();
              } catch {
                setError("That memory couldn't be removed. Please try again.");
                setDeleting(false);
              }
            }}
            className="min-h-12 rounded-2xl bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-40"
          >
            {deleting ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="emery-surface rounded-2xl p-3.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function HealthCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="emery-glass rounded-2xl p-3.5">
      <p className="text-lg font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
