# JARVIS release autonomy

JARVIS has no generic merge tool. The model only records intent; the **release operator** (`supabase/functions/jarvis-worker/release.ts`, run by the durable worker every 2 minutes) is the only code that can merge, and the GitHub gateway re-verifies every merge.

## Tiers (`release-gate.ts`)

| Tier | What | Who merges |
| --- | --- | --- |
| Auto | docs, validation scripts, honest "not connected" notes in `execution-capabilities.ts` (≤8 files, ≤200 lines, never claims a new executable ability) | JARVIS, after CI + pinned-SHA + gate; ≤3/day |
| Needs Adam | normal Emery/JARVIS source, UI, HPO, edge functions, config | JARVIS, only after "Approve it" |
| Manual only | JARVIS's own guardrails (gate, operator, gateway proxy/guards, policy), CI workflows, database migrations, `supabase/config.toml` | a person; JARVIS never merges these |
| Never | `.env*`, key files, credential files | nobody through JARVIS |

## Approval

"Approve it" / "Approve PR 24" / "Ship that" calls `jarvis.approve_release`, which stores an approval bound to **PR number + exact head SHA + task + current production commit**, valid for one hour. If the PR head, production, or the clock moves, the approval is void and JARVIS asks again. A candidate behind `main` is refreshed and re-tested first.

## Release pipeline

check (open, `jarvis/*` head, base `main`, head = tested SHA, CI green, up to date, gate, daily limit, production reachable, approval) → compare-and-set `merging` → merge (pinned SHA, merge commit, one-shot gateway authorization) → deploy → verify production → ledger row (only after verification) → one notification → 15-minute regression watch.

- Edge functions: `.github/workflows/deploy-jarvis-functions.yml` runs on `main` only, deploys only the changed JARVIS functions with the Supabase CLI, verifies they answer. The operator waits for that workflow before it records anything.
- Frontend (free route): Lovable publishing is not available server-to-server on the Pro plan. JARVIS merges, then notifies once "tap Publish"; after Adam publishes it verifies the served commit and closes the release. If `JARVIS_LOVABLE_API_KEY` is ever set (Business plan), JARVIS publishes itself.
- Rollback: a failed deploy or a runtime-error spike creates a NEW revert candidate PR (no history rewrite) that needs Adam's approval.
- Kill switch: set `JARVIS_RELEASE_OPERATOR=off` in Edge Function secrets.
