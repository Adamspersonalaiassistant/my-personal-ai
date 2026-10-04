# Emery Phase 9 — Professional Jarvis Redesign & Visual Convergence

## Direction
One Emery product, one premium dark command-center language. Preserve the completed Phase 1–8 intelligence architecture and the approved British female Emery voice. This is a presentation-system build, not an AI rewrite.

## Permanent protected boundaries
- Preserve one main Emery conversation, Current Context, Capability Router, existing planner/executor/controllers, Smart Memory, unified Chat/Voice, Ambient Context, self-evaluation, device continuity, Calendar/tasks, HPO CRM, account history, notes, follow-ups, route persistence, Field Session, execution receipts, idempotency, undo and existing Supabase data.
- HPO remains exactly Planner / Maps / Accounts / Activity. Planner stays primary.
- KEEP LEAFLET. Do not replace it with MapLibre/WebGL.
- No new CRM, memory system, conversation system, planner or assistant runtime.
- No Supabase schema migration for redesign.

## Visual system
- App background #04070D; primary surface #08111D; elevated surface #0C1726.
- Fine cool borders; cobalt #3B82F6 for primary interaction; live cyan #22D3EE for real intelligence/activity; #F4F7FB primary text; #A6B4C8 secondary; semantic green/amber/rose for success/warning/error.
- Keep Inter/system typography. Use restrained uppercase/monospace only for telemetry labels.
- Matte dark panels, thin borders, selective blur, subtle architectural grid at edges, restrained glow only for Emery Core, current state and primary interaction.

## Emery visual brain
Build a presentation-only Emery Core using SVG + Canvas 2D + CSS, with static/SVG fallback. Do not add a second state machine. It must consume real existing runtime/Voice/action states only: Idle, Listening, Thinking, Remembering, Searching, Planning, Using Tool, Executing, Syncing, Speaking, Waiting, Success, Error. If a fine-grained state is unavailable, fall back to the nearest truthful state such as Thinking.

## Desktop Chat
Keep existing AppShell/navigation. Use a professional command-center composition: left navigation, central Emery presence deck, conversation below, premium composer, optional right Current Context rail on large widths. Keep reading column constrained. Core roughly 180–240px during normal Chat; expand during active Voice.

## iPhone Chat
Same Emery, not a tiny desktop. Compact 88–112px Core when useful, conversation-first layout, composer above bottom nav/safe area, context in collapsible sheet/drawer. Preserve 16px inputs, 44px targets, keyboard/IME behavior and no horizontal overflow.

## HPO
Keep workflows and handlers unchanged.
- Planner: field command center, selected day, route progress, next stop, relationship signal, ordered route, existing actions.
- Maps: visually reframe existing Leaflet only; professional chrome, search/control/selection trays, no engine change.
- Accounts: relationship-intelligence presentation using canonical data only.
- Activity: restrained chronological field mission log.
Dense HPO screens should be flatter and less theatrical than Chat.

## Secondary surfaces
After Chat/HPO are stable, apply same design primitives to Calendar, Memories, Personal, Projects, Meetings, Agents/Tools, drawers/modals, setup and Quick Capture without changing persistence/workflows.

## Performance/accessibility
Pause Canvas offscreen/background; reduce particle count/DPR on small devices; preserve static/SVG fallback; respect prefers-reduced-motion; animations never required to understand state; visual layers aria-hidden while nearby text announces state; preserve focus/contrast/keyboard/safe areas.

## Final build order
1. Foundation + design tokens/primitives/shell.
2. Emery Command Center + live state-driven brain + responsive Chat/Voice.
3. HPO visual convergence: shell/nav → Planner → Maps chrome → Accounts/detail → Activity.
4. Align Calendar/Memories/secondary surfaces.
5. Cross-device polish, accessibility/performance hardening, regression validation, publish.

## Release gate
Finished means: one recognizable Emery Core across Chat/Voice; same conversation/actions/memory; HPO Planner/Maps/Accounts/Activity unchanged functionally; Leaflet retained; CRM/history/notes/follow-ups intact; Calendar intact; one responsive iPhone/computer experience; no design-introduced regressions.