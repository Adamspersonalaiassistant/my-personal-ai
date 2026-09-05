import { createFileRoute } from "@tanstack/react-router";
import { Brain } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/memories")({
  component: () => (
    <AppShell title="Memories">
      <EmptyState
        icon={Brain}
        title="Nothing here yet"
        description="Long-term memories your assistant keeps about people, preferences and past conversations will appear here."
      />
    </AppShell>
  ),
});
