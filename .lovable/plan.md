# Emery Phase 9 — Professional Jarvis Redesign & Visual Convergence

## Current status
The Phase 9 visual architecture is implemented on `emery-phase9-professional-redesign`. Do **not** restart the redesign, regenerate the application, or replace working Phase 1–8 systems. Remaining work is bounded visual polish, compile/test repair, cross-device smoke testing, and release hardening.

## Direction
One Emery product, one premium dark command-center language. Preserve the completed Phase 1–8 intelligence architecture and the approved British female Emery voice. This is a presentation-system build, not an AI rewrite.

## Permanent protected boundaries
- Preserve one main Emery conversation, Current Context, Capability Router, existing planner/executor/controllers, Smart Memory, unified Chat/Voice, Ambient Context, self-evaluation, device continuity, Calendar/tasks, HPO CRM, account history, notes, follow-ups, route persistence, Field Session, execution receipts, idempotency, undo and existing Supabase data.
- HPO remains exactly Planner / Maps / Accounts / Activity. Planner stays primary.
- KEEP LEAFLET. Do not replace it with MapLibre/WebGL.
- No new CRM, memory system, conversation system, planner or assistant runtime.
- No Supabase schema migration for redesign.

## Implemented visual system
- App background #04070D; primary surface #08111D; elevated surface #0C1726.
- Fine cool borders; cobalt #3B82F6 for primary interaction; live cyan #22D3EE for real intelligence/activity; #F4F7FB primary text; #A6B4C8 secondary; semantic green/amber/rose for success/warning/error.
- Inter/system typography. Restrained uppercase telemetry labels only where useful.
- Matte dark panels, thin borders, selective blur, subtle architectural grid, restrained glow concentrated on the Emery Core/current state/primary interaction.
- Shared primitives live under `src/components/ui/emery/`.

## Implemented Emery visual Core
The presentation-only Core lives under `src/components/emery-visual/` and uses SVG + Canvas 2D + CSS rather than a separate WebGL renderer.

It supports truthful states:
Idle, Listening, Thinking, Remembering, Searching, Planning, Using Tool, Executing, Syncing, Speaking, Waiting, Success, Error.

Do not add a second state machine. The Chat/Voice runtime already feeds the Core observable state. If finer-grained truth is unavailable, use the nearest truthful broad state.

## Desktop Chat
Implemented command-center composition: left navigation, central Emery presence deck, conversation below, premium composer, optional right Current Context rail on large widths. Keep reading column constrained and preserve existing Chat history/send/attachment behavior.

## iPhone Chat
Implemented as the same Emery with a compact Core, conversation-first layout, composer above mobile nav/safe area, 16px input and touch-friendly controls. Do not compress desktop UI into mobile.

## Voice
Preserve existing Realtime/WebRTC behavior, ambient context, interruption/cancellation safety, transcript persistence and canonical tools. Phase 9 maps real Voice/tool states into the visual Core; do not rewrite Voice.

## HPO
Keep workflows and handlers unchanged.
- Planner: remains the main HPO workflow and route command center.
- Maps: existing Leaflet only; Phase 9 changes chrome/controls/popups, not the engine.
- Accounts: relationship-intelligence presentation using canonical data only.
- Activity: restrained chronological field log.
Dense HPO screens remain flatter and more professional than the Chat presence deck.

## Secondary surfaces
Calendar and existing Personal/Projects/Meetings/Agents/Memories surfaces should inherit the shared design tokens/AppShell. Only apply bounded component polish if a real visual inconsistency is observed. Do not redesign persistence or workflows.

## Performance/accessibility
- Canvas pauses in background and uses lower particle count/DPR on small devices.
- Respect `prefers-reduced-motion` and `prefers-reduced-transparency`.
- Animations are never required to understand state.
- Visual layers are decorative/aria-hidden while nearby text communicates state.
- Preserve focus, contrast, keyboard/IME behavior, safe areas and no-horizontal-overflow guarantees.

## Final polish order
1. Run `npm run validate:phase9`, build, TypeScript and focused lint.
2. Repair only Phase 9 regressions.
3. Smoke-test Chat + real Voice Core states.
4. Smoke-test desktop and iPhone/PWA layout, keyboard and safe areas.
5. Smoke-test HPO Planner / Maps / Accounts / Activity and Leaflet route workflow.
6. Confirm British Voice starts from a fresh Realtime session.
7. Apply only small visual consistency fixes proven by those tests.
8. Merge/publish only when green.

## Release gate
Finished means: one recognizable Emery Core across Chat/Voice; same conversation/actions/memory; HPO Planner/Maps/Accounts/Activity unchanged functionally; Leaflet retained; CRM/history/notes/follow-ups intact; Calendar intact; one responsive iPhone/computer experience; no design-introduced regressions.

## Voice-first Emery home workflow

### Build
- Keep `/chat` as the Emery navigation and PWA destination, but replace its transcript with a responsive voice-first command dashboard.
- Move the existing typed conversation UI intact to `/conversation`; reuse its current server calls, history, attachments, composer, state handling, and storage.
- Point contextual Emery handoffs and prefills to `/conversation`, while ordinary Emery navigation continues to `/chat`.
- Extend `EmeryVoiceControl` with a presentation-only Core variant and bounded dashboard options: ephemeral transcript persistence and one verified opening briefing after connection. Preserve existing icon behavior by default.
- Compose the dashboard around the existing animated Core, truthful live state, Current Context, and restrained links to Chat, HPO, Calendar, Memories, Projects, Meetings, and Settings.
- Update the matching app build markers; keep the installed-app start URL at `/chat`.

### Technical boundaries
- Do not create a new conversation, memory, voice runtime, or data path.
- Dashboard voice may skip transcript writes, but all tools continue through existing canonical actions.
- The opening brief is an ephemeral Realtime instruction sent once after the existing connection succeeds; it must require verified context and avoid invented status.
- Do not alter HPO workflows, Leaflet, server intelligence, schema, or production data.

### Verification
- Check route metadata, typed-conversation continuity, handoff routing, accessible Core controls, mobile safe areas and overflow at 390×844 and 430×932, and desktop at 1440×900.
- Run typecheck, Phase 9, orchestration, voice and natural-voice validators, focused lint, production/preview diagnostics, and browser navigation checks.
