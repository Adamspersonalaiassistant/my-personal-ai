# Overnight Emery OS Sprint Status

Last updated: 2026-09-12

## Earlier stages

- Foundation / Agent Team groundwork: present in the repository. Validation state should be treated as ongoing until final QA.
- Visual redesign, Memories command center, and Agent Family work: scheduled/ongoing in the overnight sprint; do not assume complete without repo validation.

## Phase 5 — Upgrade Emery Intelligence

Status: COMPLETE — production build, TypeScript, and focused lint validated.

Implemented and validated:

- Rolling bounded conversation-state summary stored in conversation metadata and refreshed conservatively rather than on every message.
- Relevance-ranked memory selection with core-memory retention and strict prompt character/item budgets.
- Richer bounded task/project/meeting context plus quiet executive focus signals for overdue/high-priority work, projects missing next actions, and the nearest meeting.
- Rolling conversation state included in control-plane parsing for stronger short-follow-up continuity.
- Conservative automatic specialist routing capped at one user-facing specialist consultation per main-chat turn, while preserving explicit HPO/Research/Strategy requests.
- Raw recent-history prompt window tightened because rolling state now carries longer continuity.
- Pagination-capable main-chat server retrieval added for Phase 7 UI adoption; existing history UI remains unchanged for safety.
- No Emery Voice behavior/design changes.

Remaining for later phases:

- Main chat UI still uses the legacy history loader; Phase 7 should adopt the pagination endpoint with load-older/infinite scroll while preserving attachment access.
- Memory retrieval is intentionally deterministic/lexical to avoid adding an embedding/model call on every message.
- Final end-to-end product QA still belongs to Phase 8.

Validation:

- Production build passed.
- TypeScript (`npx tsc --noEmit`) passed after correcting the selected-memory type contract.
- Focused lint passed on the changed intelligence files.

## Phase 6 — Unify Emery Life OS

Status: COMPLETE — production build, TypeScript, and focused lint validated.

Implemented and validated:

- Added a bounded, user-scoped operating-system snapshot joining active tasks, projects, upcoming meetings, recent memories, recent Emery attachments, and visible specialist agents.
- Main Emery chat now surfaces a compact Current Context card driven by real structured data, with one highest-leverage focus and links into Tasks, Projects, Meetings, and recent files.
- Manual Tasks can now link to active Projects; task cards show project context.
- Meetings can now link to active Projects through existing meeting metadata; meeting cards show the relationship without a destructive schema change.
- Projects now expose connected execution context including open-task counts and linked meeting cues.
- Settings now surfaces recent Emery files/attachments with short-lived signed access while preserving the original conversation attachment system.
- Emery's bounded action-context prompt now translates linked project IDs into human project names for tasks and meetings, improving answers such as “what do I have going on?” without adding a large new prompt block.
- No Emery Voice behavior/design changes.

Remaining for later phases:

- Phase 7 should adopt paginated main-chat loading and complete mobile/performance polish.
- File context remains attachment-oriented by design; no separate document library or external-drive sync was invented.

Validation:

- Production build passed.
- TypeScript (`npx tsc --noEmit`) passed.
- Focused lint passed on all changed Phase 6 files.

## Phase 7 — Mobile + Performance Polish

Status: NOT STARTED

## Phase 8 — Final QA + Morning Handoff

Status: NOT STARTED
