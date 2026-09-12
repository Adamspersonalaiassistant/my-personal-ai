import { createFileRoute } from "@tanstack/react-router";
import { FolderKanban } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/projects")({
  component: () => (
    <AppShell title="Projects">
      <section className="emery-glass rounded-3xl p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Current context</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Projects give Emery the bigger picture.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Ongoing goals, workstreams and next actions will connect here without changing your existing memory system.
        </p>
      </section>
      <EmptyState
        icon={FolderKanban}
        title="Project context is next"
        description="No project data has been added yet. This screen is ready for the next build layer."
      />
    </AppShell>
  ),
});
