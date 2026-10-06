import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Play } from "lucide-react";
import {
  getJarvisVoiceSettings,
  previewJarvisVoice,
  selectJarvisVoice,
} from "@/lib/jarvis.functions";

type Settings = Awaited<ReturnType<typeof getJarvisVoiceSettings>>;

/**
 * JARVIS Voice audition: the supported masculine candidates read the same test
 * phrase with the same delivery instructions, so Adam picks the voice by ear.
 * The choice is stored on the JARVIS agent only — Emery's voice is untouched.
 */
export function JarvisVoiceAudition() {
  const load = useServerFn(getJarvisVoiceSettings);
  const preview = useServerFn(previewJarvisVoice);
  const select = useServerFn(selectJarvisVoice);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [phrase, setPhrase] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    load()
      .then(setSettings)
      .catch(() => setNote("Voice settings are unavailable right now."));
    return () => audioRef.current?.pause();
  }, [load]);

  const play = async (voice: string) => {
    setBusy(`play:${voice}`);
    setNote(null);
    try {
      const result = await preview({ data: { voice, phrase } });
      if ("error" in result) {
        setNote(result.error);
        return;
      }
      audioRef.current?.pause();
      audioRef.current = new Audio(result.audio);
      await audioRef.current.play();
    } catch {
      setNote("That preview couldn't play.");
    } finally {
      setBusy(null);
    }
  };

  const choose = async (voice: string) => {
    setBusy(`use:${voice}`);
    setNote(null);
    try {
      const result = await select({ data: { voice } });
      if ("error" in result) setNote(result.error);
      else {
        setSettings((s) => (s ? { ...s, voice: result.voice, selectedBy: "adam" } : s));
        setNote("Saved. The next JARVIS Voice session uses this voice.");
      }
    } catch {
      setNote("Couldn't save the voice.");
    } finally {
      setBusy(null);
    }
  };

  if (!settings) return note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null;

  return (
    <div className="rounded-xl border border-border/40 bg-card/25 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          JARVIS voice
        </p>
        <p className="text-[10px] text-muted-foreground">
          {settings.selectedBy === "adam" ? "Your choice" : "Default"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setPhrase((p) => (p + 1) % settings.phrases.length)}
        className="mt-1.5 w-full text-left text-[12px] leading-5 text-foreground/85"
        aria-label="Next test phrase"
      >
        “{settings.phrases[phrase]}”
        <span className="ml-1 text-[10px] text-primary/80">next phrase</span>
      </button>
      <div className="mt-2 space-y-1.5">
        {settings.candidates.map((candidate) => {
          const current = candidate.id === settings.voice;
          return (
            <div key={candidate.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void play(candidate.id)}
                disabled={busy !== null}
                aria-label={`Play ${candidate.label}`}
                className="emery-press flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-card/40 disabled:opacity-50"
              >
                {busy === `play:${candidate.id}` ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-4">{candidate.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{candidate.note}</p>
              </div>
              {current ? (
                <span className="flex items-center gap-1 text-[11px] text-primary">
                  <Check className="size-3.5" /> In use
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void choose(candidate.id)}
                  disabled={busy !== null}
                  className="rounded-lg border border-border/50 px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
                >
                  {busy === `use:${candidate.id}` ? "Saving…" : "Use"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        Previews use the same built-in voice and delivery instructions as live Voice; live
        conversation can sound slightly different.
        {note ? <span className="block pt-1 text-foreground/80">{note}</span> : null}
      </p>
    </div>
  );
}
