# JARVIS Engineer — Run 2 Status

Date: 2026-10-06 · Branch: `jarvis-engineer-run2` · Production: `04b42b1` (Run 1)

State vocabulary: **code-complete** → **tested** → **deployed** → **verified-live**. Supabase pieces (Edge Functions, migrations, cron) deploy independently of the Lovable app, so they can be live while app changes still wait for release.

## Where things live

| Area                                                                                                                                                                  | Source                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Worker engine (accept → validate → dedupe/merge → dependencies → risk/free-first → execute → CI → bounded repair → PR → candidate → session finalize + self-research) | `supabase/functions/jarvis-worker/engine.ts`                                                                                     |
| Worker GitHub ops (via the same allowlist proxy as `jarvis-github`; idempotent branch/commit-marker/PR)                                                               | `supabase/functions/jarvis-worker/github-ops.ts`                                                                                 |
| Opportunity Radar (existing telemetry → ranked, de-duplicated tasks)                                                                                                  | `supabase/functions/jarvis-worker/radar.ts`                                                                                      |
| Code planner / repair / research (OpenAI, JSON edits validated by the engine)                                                                                         | `supabase/functions/jarvis-worker/llm.ts`                                                                                        |
| Store (service role, lease-fenced writes)                                                                                                                             | `supabase/functions/jarvis-worker/store-supabase.ts`                                                                             |
| Queue schema, leased claims, atomic intake, cron, kick                                                                                                                | `supabase/migrations/20261006030000_jarvis_worker_queue.sql`, `20261006140000_jarvis_claim_terminal_dependencies.sql`            |
| Isolated candidate CI (no secrets; code-free job publishes commit statuses)                                                                                           | `.github/workflows/jarvis-candidate.yml`, `scripts/jarvis-candidate-check.mjs` (on main via PR #11, #12)                         |
| Room task intake (`jarvis.create_task`, batch `jarvis.create_tasks`)                                                                                                  | `src/lib/jarvis/tool-gateway.ts`, `tool-registry.ts`                                                                             |
| JARVIS Voice (separate identity, same thread via `jarvis_turn`)                                                                                                       | `src/lib/jarvis/voice.ts`, `src/lib/jarvis.functions.ts` (`createJarvisRealtimeSecret`), `src/components/JarvisVoiceControl.tsx` |
| Self-awareness (deployed vs candidate, session self-improvement, readiness)                                                                                           | `src/lib/jarvis/state.ts`, `runtime.ts`                                                                                          |
| Validation                                                                                                                                                            | `validate:jarvis-worker` (18 checks), `validate:jarvis` (24 checks)                                                              |

## Live (Supabase, verified 2026-10-06)

- `jarvis-worker` v5, one cron (`jarvis-worker-tick`, every 2 min), internal-key auth (401 without it). ≤4 leases, ≤1 code writer.
- `jarvis-github` v3, owner-JWT auth (401 without it), redeployed so it matches the repo.
- CI results are read through commit statuses. The runtime token has no Checks: read (403 on check-runs), so the workflow's `report` job publishes `jarvis-candidate` statuses and the worker falls back to them automatically.

Live evidence:

| Test                        | Result                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harmless task               | A1 diagnostic completed (3 checks).                                                                                                                                                                             |
| Controlled code change      | B2: branch created early, checkpoint `0310264`, edit `b677b80`, CI pass, draft PR #13, candidate row.                                                                                                           |
| Controlled failure + repair | B3: injected TS2322, failure parsed from statuses (`repair-fixture.ts:2`), LLM repair `498ecd9`, CI pass, PR #15.                                                                                               |
| Closed loop                 | 3 Emery `capability_gap` events (apple_notes) → radar task → branch → LLM edit of `execution-capabilities.ts` → CI pass → PR #14 → candidate row.                                                               |
| Paid-credit fixture         | A9 blocked before any GitHub call (free-first).                                                                                                                                                                 |
| 50-task load                | 50/day ceiling held exactly (42 + 8 earlier). 5 duplicates merged one way. Dependents ran after parents. 0 duplicate stage transitions under two concurrent kicks. Over-capacity fixtures cancelled afterwards. |
| Session completion          | 3 sessions, each exactly 1 notification + 1 web-sourced self-research finding + `ready_for_more_tasks`.                                                                                                         |

## Bugs found by the live run and fixed

1. Runtime token cannot read the Checks API → commit-status CI path (PR #12 + worker fallback).
2. A re-run of a failed task was merged into the failure → failed tasks are never dedupe targets.
3. Duplicates with identical timestamps cancelled each other → id tiebreak.
4. Tasks depending on failed/merged tasks were never claimed → claim waits only on in-progress dependencies.
5. Room `jarvis.create_task` produced tasks the worker could not execute → executable specs + batch intake.
6. Capacity eligibility counted fixtures → real tasks only.
7. A literal fake key in a test tripped `check:env-safety` → built at runtime.
8. Readiness counted every task created today (including ledger notes) and could report "ready" with no capacity left → counts accepted tasks only, and a full day reports not ready.

## Not yet live (needs the Run 2 app release)

The app changes in `src/` are code-complete and tested but are not in production until this branch is merged and published: room batch intake, JARVIS Voice, candidate-aware self-awareness, and readiness answers. JARVIS Voice can only be voice-tested by Adam after release.

## Known baseline

`validate:hpo-field-os`: 7 failures, the same as on main (tracked debt, not a Run 2 regression).
