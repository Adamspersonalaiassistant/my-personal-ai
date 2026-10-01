import { Activity, CalendarDays, MapPinned, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export type HpoFieldView = "planner" | "map" | "accounts" | "activity";

const areas = [
  { key: "planner", label: "Planner", icon: CalendarDays },
  { key: "map", label: "Maps", icon: MapPinned },
  { key: "accounts", label: "Accounts", icon: UsersRound },
  { key: "activity", label: "Activity", icon: Activity },
] as const;

export function HpoFieldNav({
  view,
  onChange,
}: {
  view: HpoFieldView;
  onChange: (view: HpoFieldView) => void;
}) {
  return (
    <nav
      aria-label="HPO field areas"
      className="hpo-field-nav shrink-0 border-b border-border bg-background px-3 py-2 sm:px-4"
    >
      <div className="mx-auto grid max-w-5xl grid-cols-4 gap-1.5">
        {areas.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            type="button"
            variant={view === key ? "default" : "outline"}
            onClick={() => onChange(key)}
            aria-current={view === key ? "page" : undefined}
            className="h-12 min-w-0 flex-col gap-0.5 rounded-xl px-0.5 text-[11px] font-semibold shadow-none sm:flex-row sm:gap-2 sm:text-sm"
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Button>
        ))}
      </div>
    </nav>
  );
}
