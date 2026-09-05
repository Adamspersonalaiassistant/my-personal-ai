import { createFileRoute } from "@tanstack/react-router";
import { FolderKanban } from "lucide-react";
import { AppShell, EmptyState } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/projects")({
  component: () => (
    <AppShell title="Projects">
      <EmptyState
        icon={FolderKanban}
        title="No projects yet"
        description="Ongoing work, with the people and notes attached to it, will live here."
      />
    </AppShell>
  ),
});
