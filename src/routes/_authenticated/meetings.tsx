import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/meetings")({
  component: () => (
    <AppShell title="Meetings">
      <section className="emery-glass rounded-3xl p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Meeting intelligence</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Turn conversations into useful context.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Meeting and call transcripts will eventually feed Emery decisions, follow-ups and memory without cluttering your chat.
        </p>
      </section>
      <EmptyState
        icon={CalendarDays}
        title="Ready for transcripts"
        description="Nothing has been connected here yet. PLAUD and meeting intelligence remain a later layer."
      />
    </AppShell>
  ),
});
