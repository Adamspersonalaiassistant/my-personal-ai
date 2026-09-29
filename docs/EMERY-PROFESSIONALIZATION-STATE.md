# Emery Professionalization State

Last updated: 2026-09-29

## Run identity

- Current production/main checkpoint: `bf9d9035176b4fa2f6ba3415e36e6defcb4dd6b3`
- Working branch: `codex/emery-professionalization-continue`
- Previous published checkpoint PR: #7 (merged)
- Production branch: `main` — keep protected from partial work
- Persistent objective: one typed, receipt-driven Emery orchestration system shared by Chat and Voice, with professional field continuity, trustworthy data, native-feeling mobile behavior, proactive health reporting, and executable QA.
- Lovable AI generation credits used by this professionalization branch so far: 0
- Durable continuation instructions: `docs/CHATGPT-WORK-RESUME.md`
- Mandatory acceptance ledger: `docs/EMERY-PROFESSIONALIZATION-COVERAGE.md`

## Current branch checkpoint

The current scoped checkpoint includes:
- HPO Field OS regression validator repaired to follow the collision-safe atomic reorder implementation.
- Planner → resolver → dependency-aware executor → typed receipt path used by both Chat and Voice for multi-intent day-plan requests.
- Calendar/HPO coexistence for the exact Jason request and three natural variants.
- Typed Today’s Plan plus persistent owner-scoped Field Session and expected-note target.
- Bounded, idempotent set-stops undo backed by execution-ledger before-state and conflict detection.
- Central source hierarchy protecting explicit/live relationship truth from lower-authority research, memory, or inference.

Earlier branch checkpoints include:
- `9ad44ff0` — atomic HPO set-remaining-stops / Field Session RPC migration
- `20c40e4f` — safe “only remaining stop” route command + HPO contact-assisted resolution
- `517a51f6` — planner wired into Emery multi-intent HPO orchestration
- `c4418c61` — improved nearby scoring / relationship reasoning
- `4393e590` — explicit preferred stop for HPO note capture
- subsequent accessibility/theme/map-eligibility and orchestration type/lint fixes
- `ee6514b2` — durable ChatGPT Work completion handoff

Always inspect current branch history before editing because additional commits may have landed after this file was written.

## Milestones

| Milestone | Status | Evidence / next proof needed |
| --- | --- | --- |
| A — baseline, ledgers, regression reproduction | COMPLETE | 270-row coverage ledger exists; Calendar-recognition gate reproduced. |
| B — typed context/plan/capabilities/risk/receipts | COMPLETE | RequestContext, ActionPlan, capability registry, risk policy, safe errors, receipt aggregation and orchestration validator exist. |
| C — multi-intent planner/entity resolver/Jason regression | COMPLETE | Exact Jason sentence plus three variants pass planner/executor dependency tests; Calendar reads and HPO writes coexist without recognition gating. |
| D — Today’s Plan/Field Session/safe set-stops | COMPLETE | Typed Today’s Plan, owner-scoped persistent Field Session, atomic remaining-stop replacement, note targeting, idempotency and bounded undo are implemented and validated. |
| E — shared Voice context/Talk to Emery/audition | PARTIAL | Chat and Realtime Voice now use the same multi-intent planner/executor and structured HPO context. The separate Voice UX/audition items remain for rows 31–50. |
| F — route reliability/errors/scoring | PARTIAL | Nearby scoring improved. Reorder/optimization error handling, transactional safety and regression tests remain. |
| G — CRM normalization/safe research bridge | PENDING | Existing safe prospect write layer on main must be extended, not replaced. |
| H — map/geocoding/multi-location | PARTIAL | Route-eligibility metadata/filter groundwork added. Full filters/geocoding/multi-location requirements remain. |
| I — CRM intelligence/timeline/follow-up links | PENDING | — |
| J — navigation/PWA/offline/mobile/accessibility | PARTIAL | Accessibility viewport and semantic-color improvements landed; broad navigation/PWA/offline/mobile work remains. |
| K — integrations/notifications/performance/streaming | PENDING | — |
| L — hybrid/entity memory/source hierarchy | PARTIAL | Central source-authority policy is implemented and tested; semantic/hybrid retrieval remains for its later assigned scope. |
| M — capability health/self-improvement wiring | PENDING | Existing telemetry/backlog/self-evaluation foundations should be reused. |
| N — executable QA/CI | PARTIAL | Orchestration validator exists; full unit/integration/E2E/a11y/visual/performance/network tests remain. |
| O — 270 coverage/full production gate/deploy | PENDING | No merge/publish until all 270 rows have final allowed status and final gate is green. |

## Architectural direction

The target is **planner → resolver → executor → receipt**, shared by Chat and Voice.

Rules:
- “recognized” is never equivalent to “performed”.
- Cross-domain requests can execute multiple compatible actions in one turn.
- Entity resolution uses live structured records before fuzzy memory guesses.
- Important writes are idempotent and receipt-backed.
- High-impact changes preserve history and use risk-aware confirmation.
- User-facing responses state what actually succeeded and what still needs clarification.
- Capability truth/health prevents Emery from promising unhealthy or disconnected actions.
- Structured live CRM/current correction outranks stale memory/research inference.

## Protected product foundations

Do not regress:
- Leaflet is the primary HPO map; do not restore MapLibre.
- Current dark HPO visual system.
- Existing CRM/account/contact/interaction/route history.
- Ownership and route exclusions.
- Realtime Voice foundation.
- Controlled prospect-write safeguards.
- Offline HPO outbox/drafts already present.
- Production data must never be populated with fake testing records.

## Database/migrations

Professionalization migrations now include atomic authenticated set-remaining-stops behavior plus
`20260929152000_emery_field_sessions_and_route_undo.sql`, which adds owner-scoped Field Session persistence, route metadata synchronization and conflict-safe bounded undo. Before applying or extending migrations:
- inspect live schema/RLS;
- preserve authenticated owner scoping;
- preserve completed route history;
- avoid destructive data rewrite;
- create safe rollback/forward-fix path;
- verify postconditions.

## Tests and CI

Scoped verification at this checkpoint:
- `npm run validate:orchestration` — PASS
- `npm run validate:hpo-field-os` — PASS
- `npx tsc --noEmit` — PASS
- focused ESLint for changed orchestration/HPO files — PASS

Existing broader gates include build, phase0/behavior validators and CRM-write validation.

The branch has a draft PR, so GitHub Actions run on branch pushes. Historical failures during iteration are not a blocker by themselves; the final branch must be green.

Final completion cannot rely on static validators alone. Add executable:
- unit/integration tests;
- browser E2E;
- accessibility checks;
- visual/mobile regression;
- offline/network/idempotency tests;
- performance/latency budget;
- production-safe runtime smoke checks.

## Blockers

- No blocker justifies stopping unrelated work.
- External OAuth/native-only capabilities may finish as `EXTERNAL ACTIVATION REQUIRED + CODE COMPLETE`.
- PWA/iOS platform limits may finish as `PLATFORM LIMIT + BEST AVAILABLE UX VERIFIED`.
- Routine design/engineering choices should be made autonomously from the brief.

## Deployment rule

A verified checkpoint through IDs 1–30 and 204–223 has now been published so Adam can test real route workflows. Continue remaining audit work on this continuation branch. Publish later checkpoints only when their scoped tests and CI are green.

Only after the 270 ledger contains no OPEN rows and the final gate is green:
1. inspect full diff against main;
2. confirm data/migrations are safe;
3. update STATE + COVERAGE with exact evidence;
4. make PR #7 ready;
5. merge to main with the safest supported method;
6. publish through the existing Lovable deployment path without Lovable AI generation;
7. verify project ready/production commit;
8. run non-destructive production smoke checks;
9. report exact merge/deployment and only the real-iPhone checks that automation cannot truthfully perform.

## Published checkpoint

- Production merge commit: `bf9d9035176b4fa2f6ba3415e36e6defcb4dd6b3`
- Lovable production: published and ready
- Supabase migrations applied: set-stops/field-session RPC, atomic route order RPC, persistent Field Session + bounded undo
- IDs formally closed before publish: 1–30 and 204–223
- Both GitHub validation workflows were green before merge.

## Next exact action

Continue with coverage rows 31–71 only: finish Voice/hands-free and route-reliability items from this new continuation branch. Do not reopen rows 1–30 or 204–223 unless a regression proves they failed.
