# JARVIS Engineer — Run 1 Status

Date: 2026-10-05 · Branch: `jarvis-engineer-foundation` · PR #10

State vocabulary: **code-complete** (on the branch) → **tested** (validators/harness) → **deployed** (merged + Lovable publish) → **verified-live** (acceptance tests pass in production).

## Where things live

| Area | Source |
| --- | --- |
| Tool registry + risk classes | `src/lib/jarvis/tool-registry.ts` |
| Policy (risk, free-first credit gate, protected GitHub ops, secret/RLS guards) | `src/lib/jarvis/policy.ts` |
| GitHub workshop | `src/lib/jarvis/github.ts` |
| Gateway (policy → execute → `jarvis_tool` receipt in `emery_runtime_events`) | `src/lib/jarvis/tool-gateway.ts` |
| Live state, diagnostics, deployment reconciliation, `system.*` | `src/lib/jarvis/state.ts` |
| Knowledge retrieval + ingestion | `src/lib/jarvis/knowledge.ts` |
| Capability catalogue (Emery registry + JARVIS tools) | `src/lib/jarvis/capability-catalog.ts` |
| Research + license checks | `src/lib/jarvis/research.ts` |
| Runtime (credit gate → knowledge/status → evidence prefetch → bounded tool loop) | `src/lib/jarvis/runtime.ts` |
| Room (Adam ↔ JARVIS, no commander) | `src/lib/jarvis/room.ts`, `src/lib/jarvis.functions.ts`, `src/components/JarvisRoom.tsx` |
| Build commit stamp | `vite.config.ts`, `src/lib/jarvis/build-info.ts`, `<meta name="emery-commit">` |
| Migrations | `supabase/migrations/20261005210000_*`, `20261005211000_*` |
| Validation | `bun run validate:jarvis` (16 checks incl. end-to-end harness) |

## Status

- Code-complete + tested: room, knowledge retrieval, gateway, GitHub/Supabase/Lovable/research/evaluation tools, capability discovery, `system.*` self-awareness, Emery version/upgrade answers, knowledge ingestion.
- Applied live: reconcile migration (no-op on existing tables), security hardening (trigger functions not RPC-callable, pinned search_path), `jarvis_database_diagnostics()`.
- Not deployed: the application code. Production still serves `c00ddc5` until PR #10 is merged and published.
- Verified against real systems from the engineering session: GitHub read/search/history on the private repo; diagnostics RPC as owner; Lovable production commit `c00ddc5` = GitHub main = `emery_releases` baseline.

## Deliberately unchanged

- `pg_net` in `public`: not relocatable; used by the push-dispatch cron job.
- `hpo_import_payload_staging`: RLS enabled with no policies by design (service-only staging).
- Leaked-password protection: Auth dashboard setting; Adam's call.
- `.env`: stays tracked because Lovable manages it and it holds only publishable client config. All other `.env.*` files are ignored.

## Run 2 prerequisites

1. Adam adds the `JARVIS_GITHUB_TOKEN` server secret: a fine-grained PAT for this repository only, with Contents RW, Pull requests RW, Checks R, Commit statuses R and Metadata R. Also enable branch protection on `main`. The repo is private, so every GitHub tool reports `not_configured` in production until this is done.
2. Adam approves merging PR #10 and publishing in Lovable. After that, verify acceptance tests 1–11 live and record a release in `emery_releases` (served `emery-commit` must match).
3. Optional: `JARVIS_SUPABASE_ACCESS_TOKEN` for the advisors/logs management API. The in-database lint already works without it.
4. Voice self-awareness: Realtime Voice context doesn't load the self-awareness block yet. Only typed Emery has it.
5. Background worker for the 50-task queue (pgmq test per bootstrap research), branch → edit → test → repair → PR loop running unattended, and a sandbox/CI to execute candidate code.
6. The existing `validate:hpo-field-os` script has 7 static checks that also fail on `main`. They need refreshing.
