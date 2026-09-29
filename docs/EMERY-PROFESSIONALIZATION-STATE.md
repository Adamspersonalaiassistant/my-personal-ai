# Emery Professionalization State

Last updated: 2026-09-29

## Run identity

- Starting commit: 5f7af39e677e225cf4b56d87cc2ff164de61db14
- Working branch: codex/emery-professionalization
- Production branch: main (protected from partial work)
- Persistent objective: one typed, receipt-driven Emery orchestration system shared by Chat and Voice, with professional field continuity and executable QA.
- Lovable AI generation credits used: 0

## Milestones

| Milestone | Status | Evidence |
| --- | --- | --- |
| A — baseline, ledgers, regression reproduction | IN PROGRESS | Calendar recognition currently gates every HPO controller in emery.functions.ts. |
| B — typed context/plan/capabilities/risk/receipts | PENDING | — |
| C — multi-intent planner/entity resolver/Jason regression | PENDING | — |
| D — Today's Plan/Field Session/safe set-stops | PENDING | — |
| E — shared Voice context/Talk to Emery/audition | PENDING | — |
| F — route reliability/errors/scoring | PENDING | — |
| G — CRM normalization/safe research bridge | PENDING | — |
| H — map/geocoding/multi-location | PENDING | — |
| I — CRM intelligence/timeline/follow-up links | PENDING | — |
| J — navigation/PWA/offline/mobile/accessibility | PENDING | — |
| K — integrations/notifications/performance/streaming | PENDING | — |
| L — hybrid/entity memory/source hierarchy | PENDING | — |
| M — capability health/self-improvement wiring | PENDING | — |
| N — executable QA/CI | PENDING | — |
| O — 270 coverage/full production gate/deploy | PENDING | — |

## Current architecture findings

- sendEmeryMessage is a monolithic composition root.
- Calendar executes first and calendarAction.recognized suppresses HPO read, route, stop, and relationship controllers—even when Calendar recognized but did not perform.
- Execution ledger already provides begin/complete/clarify/fail/recent receipt primitives and should be extended rather than replaced.
- Existing capability registry is descriptive but not yet a typed executable registry.
- Improvement backlog, self-evaluations, metrics, rollback, and runtime events already exist and should be connected into capability health rather than duplicated.
- HPO production UI is dark and Leaflet is the protected map engine.
- Controlled prospect-write functions exist and must be extended, never replaced by unrestricted SQL.

## Database/migrations

- Existing execution ledger migration: 20260927194500_emery_execution_ledger.sql.
- No migration created in Milestone A.
- All future exposed tables/functions must preserve authenticated owner scoping and RLS.

## Tests

- Existing gates discovered: build, TypeScript, phase0, behavior, HPO Field OS, CRM-write validator, ESLint.
- Critical Jason multi-intent fixture does not yet exist and is the first executable regression target.

## Blockers

- None for Milestone A.
- External OAuth/native platform limitations must not block unrelated milestones.

## Deployment

- No professionalization branch deployment yet.
- Latest production-safe main at run start: 5f7af39e677e225cf4b56d87cc2ff164de61db14.

## Latest safe commit

- Baseline: 5f7af39e677e225cf4b56d87cc2ff164de61db14

## Next exact action

Create typed orchestration contracts and an executable natural-language regression fixture proving that Calendar recognition cannot suppress HPO route planning.

