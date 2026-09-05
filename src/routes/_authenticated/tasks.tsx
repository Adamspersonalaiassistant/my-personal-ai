import { createFileRoute } from "@tanstack/react-router";
import { CheckSquare } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: () => (
    <AppShell title="Tasks">
      <EmptyState
        icon={CheckSquare}
        title="No tasks yet"
        description="Things to do, captured from chat or meetings, will be listed here."
      />
    </AppShell>
  ),
});
