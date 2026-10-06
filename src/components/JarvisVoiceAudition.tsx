import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Play, Star } from "lucide-react";
import {
  getJarvisVoiceSettings,
  preferJarvisVoiceLab,
  previewJarvisVoiceLab,
  selectJarvisVoice,
} from "@/lib/jarvis.functions";

type Settings = Awaited<ReturnType<typeof getJarvisVoiceSettings>>;

const GROUPS = [
  { engine: "openai", title: "Live now · OpenAI" },
  { engine: "azure", title: "Microsoft · needs free Azure key" },
  { engine: "kokoro", title: "Open source · Kokoro" },
] as const;

// A silent WAV used to unlock playback inside the tap gesture: iOS Safari blocks
// audio.play() that starts after an awaited network call.
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/**
 * JARVIS Voice Lab: every deployable candidate reads the SAME test phrase, so
 * Adam picks by ear. Live-capable voices can be put in use; the others are
 * recorded as a preference for a later voice-pipeline change. Emery's voice is
 * never touched.
 */
export function JarvisVoiceAudition() {
  const load = useServerFn(getJarvisVoiceSettings);
  const preview = useServerFn(previewJarvisVoiceLab);
  const select = useServerFn(selectJarvisVoice);
  const prefer = useServerFn(preferJarvisVoiceLab);
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

  const audioElement = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.setAttribute("playsinline", "true");
    }
    return audioRef.current;
  };

  const play = async (id: string, engine: string) => {
    setBusy(`play:${id}`);
    setNote(null);
    const audio = audioElement();
    audio.pause();
    if (engine !== "kokoro") {
      // Unlock inside the gesture; the real clip arrives after the server call.
      audio.src = SILENCE;
      void audio.play().catch(() => undefined);
    }
    try {
      const result = await preview({ data: { id, phrase } });
      if ("error" in result) {
        setNote(result.error);
        return;
      }
      audio.src = result.audio;
      await audio.play();
    } catch {
      setNote("That preview couldn't play.");
    } finally {
      setBusy(null);
    }
  };

  const use = async (id: string) => {
    setBusy(`use:${id}`);
    setNote(null);
    try {
      const result = await select({ data: { voice: id } });
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

  const mark = async (id: string) => {
    setBusy(`use:${id}`);
    setNote(null);
    try {
      const result = await prefer({ data: { id } });
      if ("error" in result) setNote(result.error);
      else {
        setSettings((s) => (s ? { ...s, labPreference: result.id } : s));
        setNote("Preference saved. Live Voice is unchanged until the voice pipeline supports it.");
      }
    } catch {
      setNote("Couldn't save the preference.");
    } finally {
      setBusy(null);
    }
  };

  if (!settings) return note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null;

  return (
    <div className="rounded-xl border border-border/40 bg-card/25 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          JARVIS Voice Lab
        </p>
        <p className="text-[10px] text-muted-foreground">
          Live: {settings.voice} · {settings.selectedBy === "adam" ? "your choice" : "default"}
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
      {GROUPS.map((group) => {
        const rows = settings.lab.filter((c) => c.engine === group.engine);
        if (!rows.length) return null;
        return (
          <div key={group.engine} className="mt-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
              {group.title}
            </p>
            <div className="mt-1 space-y-1.5">
              {rows.map((candidate) => {
                const inUse = candidate.live && candidate.id === settings.voice;
                const preferred = !candidate.live && candidate.id === settings.labPreference;
                return (
                  <div key={candidate.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void play(candidate.id, candidate.engine)}
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
                    {inUse || preferred ? (
                      <span className="flex items-center gap-1 text-[11px] text-primary">
                        {inUse ? <Check className="size-3.5" /> : <Star className="size-3.5" />}
                        {inUse ? "In use" : "Preferred"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void (candidate.live ? use(candidate.id) : mark(candidate.id))
                        }
                        disabled={busy !== null}
                        className="rounded-lg border border-border/50 px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
                      >
                        {busy === `use:${candidate.id}`
                          ? "Saving…"
                          : candidate.live
                            ? "Use"
                            : "Prefer"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="mt-2.5 text-[10px] leading-4 text-muted-foreground">
        Same phrase for every voice. OpenAI and Microsoft previews are generated live; Kokoro
        samples are pre-rendered. Only OpenAI voices run in live Voice today.
        {note ? <span className="block pt-1 text-foreground/80">{note}</span> : null}
      </p>
    </div>
  );
}
