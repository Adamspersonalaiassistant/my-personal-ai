import { Activity, CalendarDays, MapPinned, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export type HpoFieldView = "planner" | "map" | "accounts" | "activity";

const areas = [
  { key: "planner", label: "Planner", icon: CalendarDays },
  { key: "map", label: "Maps", icon: MapPinned },
  { key: "accounts", label: "Accounts", icon: UsersRound },
  { key: "activity", label: "Activity", icon: Activity },
] as const;

export function HpoFieldNav({ view, onChange }: { view: HpoFieldView; onChange: (view: HpoFieldView) => void }) {
  return (
    <nav aria-label="HPO field areas" className="hpo-field-nav shrink-0 border-b border-border px-3 py-2 sm:px-4">
      <div className="mx-auto flex max-w-5xl items-center gap-1 rounded-lg border border-border/60 bg-surface/75 p-1 shadow-sm">
        {areas.map(({ key, label, icon: Icon }) => {
          const active = view === key;
          return (
            <Button
              key={key}
              type="button"
              variant="ghost"
              onClick={() => onChange(key)}
              aria-current={active ? "page" : undefined}
              className={`emery-press relative h-12 min-w-0 flex-1 flex-col gap-0.5 rounded-md border px-0.5 text-[11px] font-semibold shadow-none sm:flex-row sm:gap-2 sm:text-sm ${
                active
                  ? "border-live/25 bg-live/10 text-live emery-nav-active"
                  : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-elevated hover:text-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
              {active ? <span aria-hidden="true" className="absolute inset-x-5 -bottom-1 h-px bg-gradient-to-r from-transparent via-live to-transparent" /> : null}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
