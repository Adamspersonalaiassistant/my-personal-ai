import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/meetings")({
  component: () => (
    <AppShell title="Meetings">
      <EmptyState
        icon={CalendarDays}
        title="No meetings yet"
        description="Meeting and call notes will show up here once recordings and transcripts are connected."
      />
    </AppShell>
  ),
});
