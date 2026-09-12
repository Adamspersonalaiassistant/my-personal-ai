import { createFileRoute } from "@tanstack/react-router";
import { CheckSquare } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: () => (
    <AppShell title="Tasks">
      <section className="emery-glass rounded-3xl p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Action system</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Your next moves will live here.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This is the next layer we’re building: tasks Emery can capture, prioritize and help you finish.
        </p>
      </section>
      <EmptyState
        icon={CheckSquare}
        title="Ready for action context"
        description="No task data has been added yet. Emery will use this space once task capture is connected."
      />
    </AppShell>
  ),
});
