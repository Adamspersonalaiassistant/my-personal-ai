import { Ear, EarOff } from "lucide-react";

export function EmeryAmbientContextToggle({
  enabled,
  snippetCount,
  onToggle,
}: {
  enabled: boolean;
  snippetCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Turn Ambient Context off" : "Turn Ambient Context on"}
      title={
        enabled
          ? "Ambient Context is on. Nearby speech is temporary and expires automatically."
          : "Ambient Context is off. Turn it on when you want Emery to follow nearby conversation temporarily."
      }
      className={`pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-medium shadow-lg backdrop-blur-2xl transition ${
        enabled
          ? "border-primary/25 bg-primary/10 text-primary"
          : "border-border/60 bg-background/92 text-muted-foreground"
      }`}
    >
      {enabled ? <Ear className="size-3.5" /> : <EarOff className="size-3.5" />}
      <span>{enabled ? "Ambient on" : "Ambient off"}</span>
      {enabled && snippetCount > 0 ? (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] tabular-nums">
          {snippetCount}
        </span>
      ) : null}
    </button>
  );
}
