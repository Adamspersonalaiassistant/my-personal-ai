import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

const status = [
  { label: "Sign-in and database", value: "Connected" },
  { label: "AI brain", value: "Not connected yet" },
  { label: "Voice", value: "Coming later" },
  { label: "File uploads", value: "Coming later" },
  { label: "Meeting transcripts", value: "Coming later" },
  { label: "Automations", value: "Coming later" },
  { label: "WhatsApp", value: "Coming later" },
];

function Settings() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase?.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <AppShell title="Settings">
      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Signed in as</p>
        <p className="mt-1 break-all text-sm font-medium">{user?.email}</p>
      </section>

      <section className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card">
        {status.map((row, i) => (
          <div
            key={row.label}
            className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${
              i > 0 ? "border-t border-border/60" : ""
            }`}
          >
            <span>{row.label}</span>
            <span className="text-right text-muted-foreground">{row.value}</span>
          </div>
        ))}
      </section>

      <Button variant="outline" className="mt-6 h-12 w-full" onClick={signOut}>
        Sign out
      </Button>
    </AppShell>
  );
}
