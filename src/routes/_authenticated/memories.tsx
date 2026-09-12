import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Brain, CircleDot, UserRound } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { listMemories } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/memories")({
  component: Memories,
});

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

function Memories() {
  const loadMemories = useServerFn(listMemories);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadMemories({})
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          return;
        }
        setMemories(result.memories);
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

  return (
    <AppShell title="Memories">
      {loading ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading Emery’s memory…</p>
        </div>
      ) : error ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-20 text-center" role="alert">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertCircle className="size-6" />
          </div>
          <h2 className="text-base font-semibold">Memory unavailable</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="emery-glass rounded-3xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.07] text-primary">
                  <UserRound className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">About Adam</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">Core profile</h2>
                </div>
              </div>
              <div className="rounded-full border border-primary/20 bg-primary/[0.07] px-2.5 py-1 text-[11px] font-semibold text-primary">
                {memories.length} {memories.length === 1 ? "memory" : "memories"}
              </div>
            </div>

            {profileError ? (
              <p className="mt-4 text-sm text-destructive" role="alert">{profileError}</p>
            ) : profile && Object.values(profile).some(Boolean) ? (
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {profile.display_name ? (
                  <div className="rounded-2xl border border-border/50 bg-card/55 p-3.5">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Name</dt>
                    <dd className="mt-1 text-sm font-semibold">{profile.display_name}</dd>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-border/50 bg-card/55 p-3.5">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Companion</dt>
                  <dd className="mt-1 text-sm font-semibold">{profile.assistant_name || "Emery"}</dd>
                </div>
                {profile.timezone ? (
                  <div className="rounded-2xl border border-border/50 bg-card/55 p-3.5">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Timezone</dt>
                    <dd className="mt-1 text-sm font-semibold">{profile.timezone}</dd>
                  </div>
                ) : null}
                {profile.profile_summary ? (
                  <div className="rounded-2xl border border-border/50 bg-card/55 p-3.5 sm:col-span-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Profile</dt>
                    <dd className="mt-1 text-sm leading-6">{profile.profile_summary}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Emery will build your profile from the durable things you share over time.
              </p>
            )}
          </section>

          <div className="flex items-center justify-between px-1">
            <div>
              <p className="text-sm font-semibold">Memory bank</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Long-term context Emery carries across chats.</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <CircleDot className="size-3.5" /> Online
            </div>
          </div>

          {memories.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="Memory is ready"
              description="Preferences, goals, relationships and durable context Emery learns will appear here."
            />
          ) : (
            <ul className="space-y-3">
              {memories.map((memory) => (
                <li key={memory.id} className="emery-glass rounded-3xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.055] text-primary">
                      <Brain className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {memory.title ? <h2 className="text-sm font-semibold">{memory.title}</h2> : null}
                        <span className="rounded-full border border-border/60 bg-card/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {memory.memory_type.replaceAll("_", " ")}
                        </span>
                        {memory.importance >= 4 ? (
                          <span className="rounded-full border border-primary/15 bg-primary/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                            important
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/95">{memory.content}</p>
                      <p className="mt-3 text-[11px] text-muted-foreground">
                        Saved {new Date(memory.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppShell>
  );
}
