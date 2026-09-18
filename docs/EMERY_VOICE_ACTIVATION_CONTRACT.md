# Emery Voice Activation Contract

This file defines the production boundary for Emery Voice Studio, explicit voice approval, and live Realtime activation.

## One Emery

Voice never creates a second assistant, second memory system, or second conversation.

The live microphone must use:

- the central identity in `src/lib/assistant-identity.ts`
- the same `channel = "main"` Emery conversation
- the same profile and durable memories
- the same Tasks / Projects / Meetings operating context
- HPO context only when relevant and non-PHI
- the same truthfulness and permission boundaries

## Infrastructure already wired

`src/lib/voice.functions.ts` provides:

- authenticated Realtime client-secret minting
- OpenAI Realtime model: `gpt-realtime-2.1`
- WebRTC-safe short-lived client credentials
- semantic turn detection with low eagerness so Adam can pause, restart, stutter, self-correct, and think out loud
- automatic interruption of Emery when Adam starts speaking
- input transcription for persistence
- same-main-conversation transcript persistence
- durable memory extraction from user voice turns
- live web-search tool
- current Emery-context refresh tool
- versioned live delivery-preference updates for supported requests
- voice profile injection into every live session

`src/components/EmeryVoiceControl.tsx` provides:

- microphone permission flow
- WebRTC microphone + speaker transport
- Realtime event handling
- interruption/session state UI
- user and assistant transcript persistence
- Realtime function-tool execution for web search, context refresh, and supported delivery refinements
- deduplication/fallback handling for completed Realtime function-call events
- cleanup of microphone/audio resources on end/unmount

## Activation gate

The mic becomes a live Emery Voice session only when the current user's `voice_profiles` row has:

1. a non-empty `base_voice_id`
2. a non-null `approved_at`

Until then the mic opens the readiness sheet instead of silently choosing a permanent voice.

## Voice Studio flow

Voice design happens inside the normal Emery conversation through `src/lib/voice-studio.functions.ts`.

The flow is:

1. Adam starts Voice Studio naturally in the main Emery chat.
2. Emery asks one useful design question at a time and records the design brief/preferences.
3. Emery offers only built-in Realtime candidates from the central allowlist; provider docs currently recommend `marin` and `cedar` as quality starting points, without assigning invented personality/gender/accent traits.
4. When Adam requests a candidate preview, the backend first validates that candidate against the Realtime provider.
5. If validation succeeds, the backend generates an actual AI TTS preview using the current draft Voice Profile. The app clearly labels the preview as AI-generated.
6. Previewing is not approval. Any design refinement after a preview invalidates that preview for approval and requires a fresh preview.
7. Adam must explicitly approve the exact successfully previewed candidate. The UI can send the explicit approval sentence for him.
8. Approval re-validates the candidate against Realtime, versions the existing profile, stores the full approved profile, writes `approved_at`, and only then unlocks the microphone.
9. Adam taps the same mic in the main Emery chat for the first live Realtime conversation.

Voice Studio never creates a second assistant, conversation, memory system, or HPO persona.

## Final voice-selection payload

Voice Studio updates the existing `voice_profiles` row, not a new persona.

Use these fields:

- `base_voice_id`: one supported built-in Realtime voice name OR an eligible custom voice ID such as `voice_...`
- `stable_identity`: durable vocal-character description that should remain stable across sessions
- `delivery_preferences`: supported numeric delivery targets such as pace, warmth, expressiveness, energy, and brevity
- `contextual_preferences`: how delivery may adapt by context without changing Emery's identity
- `pronunciation_preferences`: stable pronunciation guidance for names/terms
- `provider_capabilities`: only capabilities actually confirmed by the provider
- `approved_at`: set only after Adam explicitly approves that vocal identity

Before replacing an already-approved base voice, preserve the old row in `voice_profile_versions`.

## Built-in vs custom voice

The Realtime plumbing accepts both:

- built-in voice IDs such as `marin` or `cedar`
- custom voice IDs beginning with `voice_`

Do not claim a custom voice exists until the provider actually returns a custom voice ID. Custom voice creation may require account eligibility plus provider consent/sample requirements.

## Web search

Text Emery and Realtime Emery both have live-web search paths.

Realtime uses the `search_web` function tool. The browser calls the authenticated server function; the OpenAI server API key never reaches the browser.

## Speech-understanding behavior

Realtime receives Adam's audio natively. Input transcription is also enabled for durable chat history/memory. The transcription prompt explicitly expects:

- fast conversational speech
- false starts and restarts
- stuttering
- self-corrections
- pauses mid-thought
- fragmented dictation
- Emery / Adam / Hudson Pro / HPO / PIP / PCC / Supabase / Lovable / OpenAI terminology

Semantic VAD uses low eagerness so short thinking pauses are less likely to be treated as the end of Adam's thought.

## Acceptance test after final voice approval

1. Tap the mic in Emery.
2. iOS/browser asks for microphone permission only when needed.
3. Speak naturally with pauses and self-corrections.
4. Interrupt Emery mid-answer; she should stop and listen.
5. Ask a current-news/current-fact question; Realtime Emery should invoke live web search.
6. End the voice session.
7. Confirm the spoken user and Emery turns appear in the same text chat.
8. Start a new voice session and confirm continuity from saved profile/memory/history.

If these pass, Emery Voice V1 is active.
