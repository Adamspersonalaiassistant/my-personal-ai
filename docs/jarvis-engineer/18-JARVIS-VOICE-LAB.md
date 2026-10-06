# JARVIS Voice Lab — research and decision record

Date: 2026-10-06. Scope: find the best legally usable voice for JARVIS in Emery, a mobile web app used on iPhone.

## Repos and models inspected

| Source                                | What it is                                                                                                                                                                  | Voice it uses                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `huggingface.co/jgkawell/jarvis`      | Piper ONNX models `jarvis-high` (114 MB, fine-tuned from US "lessac") and `jarvis-medium` (64 MB, from GB "alan"), plus training checkpoints and `metadata.csv` (460 lines) | itself                                                                                                                        |
| `comblox/jarvis-voice-system` (MIT)   | GPU Piper server + Wyoming/Home Assistant                                                                                                                                   | jgkawell `jarvis-high` ("authentic Marvel JARVIS voice")                                                                      |
| `Dix01/JARVIS` (MIT)                  | local assistant with a HUD                                                                                                                                                  | tier 1 jgkawell Piper ("community Paul-Bettany-style model … fan-use only"), tier 3 Edge TTS `en-GB-ThomasNeural` at rate −6% |
| `cam-hm/jarvis` (MIT)                 | web assistant; Piper hosted on Render                                                                                                                                       | jgkawell `jarvis-high` ("not licensed for commercial use")                                                                    |
| `open-jarvis/OpenJarvis` (Apache-2.0) | local-first personal AI                                                                                                                                                     | no JARVIS voice model                                                                                                         |
| `alexylem/jarvis` ("OpenJarvis", MIT) | Raspberry Pi assistant                                                                                                                                                      | pluggable engines, no JARVIS voice model                                                                                      |
| `hexgrad/Kokoro-82M` (Apache-2.0)     | 82M-parameter open TTS                                                                                                                                                      | `bm_daniel`, `bm_fable`, `bm_lewis`, `bm_george`                                                                              |
| Microsoft Azure Speech                | official prebuilt neural voices                                                                                                                                             | `en-GB-ThomasNeural`, `en-GB-RyanNeural`                                                                                      |
| OpenAI Realtime / gpt-4o-mini-tts     | current live engine                                                                                                                                                         | `cedar`, `ballad`, `ash`                                                                                                      |

## Provenance and licences

- **jgkawell/jarvis — not usable.**
  - The repo is tagged MIT, and its README says it "emulate[s] the voice of JARVIS from the Marvel movies".
  - The training transcript (`metadata.csv`, all `caged_*` clips) is in-app dialogue from Marvel's 2013 official JARVIS iOS app, voiced by Paul Bettany (alarm, weather, Wi-Fi, "sir or ma'am" setup, battery lines).
  - The uploader's MIT tag cannot license Marvel-owned recordings or a real actor's voice and likeness.
  - The projects that use it describe it themselves as "fan-use only" and "not licensed for commercial use".
  - **Decision:** not deployed, not hosted, not auditioned. Its published sample was used only as an acoustic reference.
- **Kokoro-82M — usable.** Apache-2.0 weights, "trained exclusively on permissive/non-copyrighted audio"; the card welcomes production use. Generated audio carries no licence obligation; the source and licence are recorded here.
- **Azure prebuilt voices — usable** under Azure terms. The F0 free tier gives 0.5M neural characters a month, throttled rather than billed when exhausted. It needs an Azure account and key (Adam's approval). HD voices are not in the free tier.
- **Edge Read Aloud (`edge-tts`) — not used.** It is an unofficial use of the Edge browser endpoint, not a licensed API for apps.
- **OpenAI built-in voices — usable** (current provider).

## Measurements (this container, 4 vCPU Xeon, no GPU)

Kokoro v1.0 via `kokoro-onnx`, en-GB, speed 0.95, the five Voice Lab phrases:

| Model         | Load  | Real-time factor            | Mean per sentence |
| ------------- | ----- | --------------------------- | ----------------- |
| fp32 (326 MB) | 3.2 s | 0.24–0.30                   | 1.0–1.3 s         |
| int8 (92 MB)  | 1.9 s | 1.24–1.39 (slower: no VNNI) | 4.7–6.0 s         |

Intelligibility (faster-whisper `small.en` back-transcription, word error rate): daniel 0%, fable 0%, lewis 0%, george 1.9% ("Emery" heard as "Emory").

Acoustics (Praat). Reference = the jgkawell published sample, analysed only.

| Voice                              | Median F0    | F0 spread (10–90%, semitones) |
| ---------------------------------- | ------------ | ----------------------------- |
| Reference (jgkawell high / medium) | 121 / 120 Hz | 6.2 / 5.3                     |
| Kokoro bm_daniel                   | 121.5 Hz     | 8.5                           |
| Kokoro bm_fable                    | 114 Hz       | 12.3                          |
| Kokoro bm_lewis                    | 82 Hz        | 9.6                           |
| Kokoro bm_george                   | 140 Hz       | 10.5                          |

The reference's calm presence shows up as a ~120 Hz centre with a narrow pitch spread. bm_daniel matches the centre and is the most restrained of the Kokoro voices. Azure and OpenAI voices could not be measured here: no Azure key, and no OpenAI key in this container.

## Hosting reality for a mobile web app

| Path                                                | Verdict                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supabase Edge Functions                             | Cannot run Kokoro or Piper: 256 MB memory, 2 s CPU per request, 20 MB bundle, no native addons. Fine as a thin proxy (used for Azure).                                                                 |
| Lovable Cloudflare Worker                           | Cannot run ONNX TTS (memory/CPU).                                                                                                                                                                      |
| In-browser on iPhone (kokoro-js / Piper WASM)       | Possible but poor: 92–326 MB download, slow WASM on iOS, battery and memory pressure. Not recommended for live Voice.                                                                                  |
| Free Hugging Face CPU Space (2 vCPU) running Kokoro | Free and Apache-compatible. Expect about 2× this container's time (~2–2.5 s per sentence), a cold start after idle, and a public endpoint unless a token is added. Needs Adam's HF account (approval). |
| Azure Speech F0                                     | Free, official, fast streaming synthesis; needs Adam's Azure key (approval).                                                                                                                           |
| OpenAI Realtime (today)                             | Speech-to-speech in one hop: lowest latency, built-in voices only.                                                                                                                                     |

Using Kokoro or Azure for _live_ JARVIS changes the voice pipeline: Realtime text output → sentence chunking → TTS → an iPhone audio queue with barge-in. That adds about 0.4 s (Azure) to 1–2.5 s (Kokoro on CPU) before first audio, compared with Realtime speech-to-speech.

## What shipped (Voice Lab)

In JARVIS Engineer's status panel, every candidate reads the same five phrases:

- **OpenAI** cedar / ballad / ash — live previews; "Use" sets the live JARVIS voice.
- **Microsoft** Thomas / Ryan — owner-only `jarvis-voice-lab` Edge Function. It allows fixed phrases and allowlisted voices only, at rate −6%, and reports "needs free Azure key" until `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are added to Supabase Edge Function Secrets.
- **Kokoro** daniel / fable / lewis / george — pre-rendered static MP3s (712 KB). They play instantly on iPhone and need no server.
- "Prefer" records Adam's choice for non-live engines (`agents.metadata.voice_lab_preference`) without changing live Voice.
- iPhone fix: playback is unlocked inside the tap gesture, so iOS Safari does not block previews that arrive after a network call.
