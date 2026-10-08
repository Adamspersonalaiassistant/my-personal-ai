# JARVIS foundation stabilization — 2026-10-08 UTC

Scope: PR #25, `jarvis/control-center-foundation-20261007`. Source checkpoint before fixes: `ddbed89a23b1ecd47d3767d369a4686faab97a10`. No merge, production deployment, database changes, or Lovable generation.

## Proven defects fixed

- TS7006 in `/jarvis` originated in the backend adapter's `any` cast. Narrow the deployment result by its actual discriminated shape, preserving the typed discrepancy list through the server function.
- Deployment reconciliation could report synchronization from ledger agreement without a served commit, and from an unverified release. Positive sync now requires observed production, main agreement, and a verified matching release. Ledger-only agreement remains unknown; disagreement remains false.
- Pending voice setup could acquire a microphone after navigation/unmount, and an old tool result could be sent into a replacement session. Session epochs cancel obsolete continuations, release late tracks, isolate tool results, and use the latest parent callback. The original voice component fails the new cancellation reproduction (`microphone requests: 1`, expected `0`); the fixed component passes.
- Failed dashboard refreshes retained old positive health and diagnostic values. Clear the failed section and display the existing visible error, while the successful independent read remains usable.

## Validation maintenance

HPO Field OS assertions predated numbered Leaflet stop icons, the current Planner selection sheet, and extracted account/activity components. Reused the focused assertion repair already present in main `d0c3c2c4c321cb775929c837b1b50b9660419801` without importing unrelated main changes. HPO product files are unchanged.

Device-continuity checks now verify the voice home plus persistent typed conversation, the current manifest shortcut and navigation records, and the canonical-controller contract. Planner fixtures now model current active-account discovery, exact optimizer version, nullable-account query filtering, missing-record errors, and isolated field-action imports. Actual UI, Leaflet, optimizer and server handler coverage is retained.

The Emery CI workflow now runs the Control Center, identity, worker, release, device continuity and Planner checks, plus focused JARVIS lint. Planner's jsdom dependency is installed temporarily at the tested version 30.1.1; no application dependency or lockfile changed.

## Local evidence

All commands exited 0 after fixes:

- `JARVIS_REPORT=/tmp/emery-candidate-final.json node scripts/jarvis-candidate-check.mjs`: typecheck (10.4s), JARVIS integration (0.4s), Phase 0 (0.2s), behavior (0.2s), production build (7.4s); report `passed: true`, no failures.
- `node --experimental-strip-types scripts/validate-jarvis-control-center.mjs`: 8 runtime checks. Tests execute actual components/handlers with deterministic external services; they are not live-device voice tests.
- JARVIS integration: 46 checks; worker: 23 checks; release safeguards: 17 checks.
- Emery Voice: 19 checks; improvement: 10; Phase 0: 27; behavior: 16 across 15 cases; response formatting: 9; one-brain and device continuity pass.
- HPO account entry, account experience, Activity, Field OS checks pass.
- `NODE_PATH=/workspace/scratch/c7af7dbc7f2c/emery/node_modules node scripts/validate-hpo-planner-workflow.mjs`: all three runtime groups pass (UI + actual Leaflet, actual optimizer with road/transaction faults, actual owner-scoped server handlers). The external path supplies temporary jsdom 30.1.1 only.
- Focused JARVIS lint: no errors. Existing Emery OS and HPO CI lint commands: exit 0 (2 and 9 pre-existing warnings respectively).

CI results for the final pushed commit must be read from Actions; local results do not replace CI.

## Read-only production observations and remaining limits

- Supabase project `pmuanzegplyoewtombss` reported ACTIVE_HEALTHY. RLS is enabled for all nine inspected JARVIS/agent/diagnostic/release tables. Dashboard handlers use owner middleware and explicit user scoping. Diagnostics exclude free-text metadata and execution error messages from responses.
- Existing JARVIS records: one agent, one thread, 25 messages; 29 knowledge items. No message or memory content was copied and no records were modified.
- Served public production HTML reported commit `d0c3c2c4c321cb775929c837b1b50b9660419801`; the latest release ledger entry reported `8dd7081b5907fac617aeefbf7699b216b8abd0bf`. This is a release-record discrepancy, not proof that this candidate is deployed. Main and production can change independently during work.
- Deployed `jarvis-worker` version 7 is active but its retrieved source lacks `ReleaseOperator` and release modules present in this repository. Automatic release capability is not live-verified. Updating production is outside this stabilization's authorization.
- This browser displayed the production sign-in page, with no authenticated session. Authenticated Settings/Core browser checks and real iPhone/WebRTC audio were not run. The candidate itself is deliberately not deployed, so source/runtime tests cannot certify its live production UX.

Astra should continue from this candidate, preserve the existing identity/thread/memory and release safeguards, and finish only the separately authorized feature phases. Do not describe the source-validated foundation as fully production-verified.
