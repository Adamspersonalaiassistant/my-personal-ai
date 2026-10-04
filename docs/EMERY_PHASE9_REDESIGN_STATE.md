# Emery Phase 9 — Professional Jarvis Redesign & Visual Convergence

## Purpose

Phase 9 is presentation convergence, not an intelligence rewrite. Phases 1–8 remain the source of truth for Current Context, capability routing, planning/execution, Smart Memory, Voice, ambient context, self-improvement, device continuity, HPO CRM, Calendar/tasks, and route persistence.

## Visual target

A premium, practical Jarvis-like personal intelligence system:

- deep midnight command-center environment
- cobalt interaction color and cyan live-intelligence color
- one state-driven Emery Core rather than decorative HUD clutter
- restrained glass, glow, grid, rings, particles and telemetry
- desktop command-center layout with a compact mobile presentation
- serious professional HPO CRM using the same design language

The design is intentionally original and does not copy proprietary Iron Man/Jarvis assets.

## Current implementation

### Shared visual system

- `src/styles.css` and `src/blue-theme.css` define the dark Emery system tokens.
- Reusable primitives live under `src/components/ui/emery/`.
- `CommandPanel`, `ContextStrip`, `IntelligenceMetric`, `SectionHeading`, and `StatusChip` are presentation-only building blocks.
- Reduced motion and reduced transparency remain supported.

### Emery Core

The visual Core lives under `src/components/emery-visual/` and uses the production-safe architecture selected by Phase 9 research:

- Canvas 2D for neural particles/activity
- SVG for precise rings and orbital geometry
- CSS for glow, depth and transitions
- existing neural-brain asset for Emery identity

Supported visual states:

`idle`, `listening`, `thinking`, `remembering`, `searching`, `planning`, `using_tool`, `executing`, `syncing`, `speaking`, `waiting`, `success`, `error`.

The Core is not allowed to invent backend activity. Chat and Voice feed it observable runtime state only.

### Chat

`src/routes/_authenticated/chat.tsx` now:

- presents Emery as a command-center presence
- keeps the same canonical `sendEmeryMessage` path
- keeps the same main conversation/history
- keeps Phase 8 device metadata
- shows Current Context as a bounded intelligence rail on large displays
- uses a compact Core on iPhone
- distinguishes truthful Chat states such as syncing attachments, thinking, success and error
- consumes live Voice runtime states through `onVisualStateChange`

### Voice

`src/components/EmeryVoiceControl.tsx` preserves the Phase 3–6 Realtime/one-brain behavior and now exposes truthful visual state:

- connecting -> syncing
- listening -> listening
- model response -> thinking/speaking
- web search -> searching
- current HPO/context reads -> remembering
- HPO route command -> planning
- canonical writes -> executing
- voice delivery update -> syncing
- tool failure/session failure -> error

It still preserves ambient context, natural follow-up behavior, cancellation safety, transcript persistence, canonical action paths and receipt-backed success semantics.

### HPO

HPO remains exactly:

**Planner · Maps · Accounts · Activity**

Planner remains the primary workflow. `HpoWeeklyPlanner`, `HpoRoutePlanner`, account detail, activity, route persistence, notes, follow-ups, Field Session and canonical write paths are protected.

Leaflet remains the map engine. Phase 9 changes only map chrome/control/popup presentation through scoped CSS.

### British Emery voice

`docs/EMERY_BRITISH_VOICE_REFERENCE.md` remains the approved voice design reference: original feminine British English, calm, precise, concise and quietly authoritative. It is a style target, not an actor/character imitation.

## Protected architecture — do not redesign/rebuild

Do not replace or fork:

- `src/lib/emery/context-engine.ts`
- `src/lib/emery/capability-router.ts`
- existing planner/executor/capability registry
- Smart Memory
- one main conversation
- unified Voice runtime
- ambient context
- execution receipts / idempotency / undo
- HPO canonical write paths
- Field Session persistence
- route optimization and completed history
- Supabase schema/data
- `src/components/hpo-map/HpoLeafletMap.tsx`

Do not introduce MapLibre/WebGL mapping.

## Remaining Phase 9 work for the final polish pass

The remaining work should be treated as validation and bounded presentation polish, not a redesign restart:

1. Compile/type-check the current branch and repair only Phase 9 regressions.
2. Run `npm run validate:phase9` plus the Phase 1–8 regression validators that still apply.
3. Smoke-test Chat Core states from typed Chat and live Voice.
4. Verify desktop/iPhone spacing, keyboard/safe-area behavior, and Voice overlay layering.
5. Apply only bounded visual polish to Calendar and secondary surfaces if they visibly diverge from the new shared tokens.
6. Verify HPO Planner/Maps/Accounts/Activity visually while preserving all workflows.
7. Verify Leaflet map/search/pins/selection/routes.
8. Confirm the British Voice profile still starts correctly from a fresh Realtime session.
9. Do not merge or publish until the branch is green and production smoke testing is complete.

## Definition of done

Phase 9 is complete when one codebase visibly and functionally presents:

- one Emery identity
- one conversation
- one memory system
- one state-driven visual Core
- one Voice system
- one design language
- one professional HPO system
- one experience across iPhone and computer

After that, stop redesigning and move to release hardening only.
