import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Brain } from "lucide-react";
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
        <p className="py-20 text-center text-sm text-muted-foreground">Loading your memories…</p>
      ) : error ? (
        <div
          className="mx-auto flex max-w-sm flex-col items-center gap-3 py-20 text-center"
          role="alert"
        >
          <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertCircle className="size-6" />
          </div>
          <h2 className="text-base font-semibold">Memories unavailable</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-border/60 bg-card p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">About Me</p>
            {profileError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {profileError}
              </p>
            ) : profile && Object.values(profile).some(Boolean) ? (
              <dl className="mt-3 space-y-2 text-sm">
                {profile.display_name ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Name</dt>
                    <dd className="font-medium">{profile.display_name}</dd>
                  </div>
                ) : null}
                {profile.assistant_name ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Assistant name</dt>
                    <dd className="font-medium">{profile.assistant_name}</dd>
                  </div>
                ) : null}
                {profile.timezone ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Timezone</dt>
                    <dd className="font-medium">{profile.timezone}</dd>
                  </div>
                ) : null}
                {profile.profile_summary ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Profile</dt>
                    <dd className="leading-relaxed">{profile.profile_summary}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Profile details learned from your conversations will appear here.
              </p>
            )}
          </section>

          {memories.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="Nothing here yet"
              description="Long-term memories your assistant keeps about people, preferences and past conversations will appear here."
            />
          ) : (
            <ul className="space-y-3">
              {memories.map((memory) => (
                <li key={memory.id} className="rounded-2xl border border-border/60 bg-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                      <Brain className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {memory.title ? (
                          <h2 className="text-sm font-semibold">{memory.title}</h2>
                        ) : null}
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {memory.memory_type.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {memory.content}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
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
