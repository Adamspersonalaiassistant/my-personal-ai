import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Brain, CircleDot, UserRound } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { listMemories } from "@/lib/chat.functions";

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
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
          <div className="emery-breathe emery-icon-well flex size-14 items-center justify-center rounded-[1.1rem]">
            <Brain className="size-5" />
          </div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            Loading Emery’s memory…
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
                    What Emery carries forward
                  </h2>
                </div>
              </div>
              <span className="emery-chip shrink-0">
                {memories.length} {memories.length === 1 ? "memory" : "memories"}
              </span>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Durable context that helps Emery understand priorities, preferences, responsibilities
              and the life around the work.
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

          <div className="flex items-center justify-between px-1">
            <div>
              <p className="text-sm font-semibold">Memory bank</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Long-term context across your Emery system.
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
          ) : (
            <ul className="space-y-3">
              {memories.map((memory, index) => (
                <li
                  key={memory.id}
                  className="emery-fade-up emery-glass rounded-[1.5rem] p-4"
                  style={{ animationDelay: `${index * 24}ms` }}
                >
                  <div className="flex items-start gap-3.5">
                    <div className="emery-icon-well mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl">
                      <Brain className="size-4" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {memory.title ? (
                          <h3 className="text-sm font-semibold">{memory.title}</h3>
                        ) : null}
                        <span className="emery-chip text-muted-foreground">
                          {memory.memory_type.replaceAll("_", " ")}
                        </span>
                        {memory.importance >= 4 ? (
                          <span className="emery-chip">Important</span>
                        ) : null}
                      </div>
                      <p className="mt-2.5 whitespace-pre-wrap text-sm leading-6 text-foreground/95">
                        {memory.content}
                      </p>
                      <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
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
