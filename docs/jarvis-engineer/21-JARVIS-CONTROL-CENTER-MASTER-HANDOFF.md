# JARVIS Engineering Control Center — Astra Medium Master Handoff

**Owner goal:** Operate the Emery app from within Emery. Emery remains Adam's personal assistant; JARVIS is the dedicated engineering intelligence under Settings, capable of showing live app state, diagnosing problems, proposing and previewing improvements, implementing fixes in isolation, testing and releasing under safeguards.

**Execution model:** GPT-6 Astra / Medium effort in ChatGPT Work, using the existing connected GitHub, Supabase and Lovable tools. Do not invoke Lovable AI generation. Do not ask for passwords. Use existing authenticated sessions when available. Before choosing an API model for Emery/JARVIS runtime, verify that the exact model ID, requested reasoning parameter, cost and tools are supported in the current API; otherwise keep existing working model and report the configuration step.

Repository: `Adamspersonalaiassistant/my-personal-ai`

## Current foundation branch to finish

`jarvis/control-center-foundation-20261007`

This branch is not production. It intentionally leaves existing backend data, workers, release policy, model selection, Supabase schema and HPO features untouched.

Implemented in the candidate:

1. New authenticated `/jarvis` Control Center route, linked as a dedicated section from `/settings`.
2. JARVIS's featured card removed from `/agents` UI; **do not delete his agent row, ID, thread or stored knowledge**.
3. JARVIS Core built using CSS rings and existing realtime `JarvisVoiceControl`, with direct tap-to-start, pause/end affordance, error states, reduced-motion fallback and no WebGL dependency.
4. Existing typed engineering room retained and accessible from the Control Center; its back control supports a return callback.
5. Live dashboard using `getJarvisStatusPanel`: production vs main, discrepancies, actual engineering tasks, proposed improvements, self-research, approvals and release candidates.
6. Authenticated, PHI-minimized `getJarvisControlCenterIssues` returns bounded 7-day runtime/execution *signals*. It strips arbitrary free-text metadata and does not pretend every failure is a confirmed bug.
7. Selected improvement idea displays a source-grounded *pathway*, distinctly labelled **not a built design preview**.
8. Registered the route in `src/routeTree.gen.ts`; regenerate via TanStack tooling and ensure generated output matches the new route.

### Mandatory first step — safety and integration

- Read current main and candidate heads, inspect candidate diff and check for concurrent changes. Rebase/cherry-pick as needed; do not overwrite unrelated main work.
- Run the project's typecheck, lint on changed files, build and relevant JARVIS validations. Fix all candidate regressions. Treat existing baseline failures separately and prove non-regression.
- Inspect the route registration strategy and regenerate `src/routeTree.gen.ts` with the supported TanStack router process rather than trusting a hand-adjusted generated file.
- Verify the new Settings link actually opens `/jarvis`; JARVIS does not appear in the Agents listing, but old deep links preserve conversation history.
- Verify voice join/leave, streaming errors, audio interruption, microphone permission on a real iPhone-sized browser session. Do not call simulated audio full device verification.
- Review any UI access to `status` and `issues` for null-safety and claims of status freshness.
- Keep all changes on a review branch. Do not merge, deploy or publish without Adam's explicit approval under the existing release policy.

## Phase 1 — Control Center completion

Turn the candidate into a polished, responsive, accessible engineering command center inside Settings:

- Top: premium, original JARVIS identity + one tappable interactive Core.
- Dashboard: accurate served production commit, GitHub main commit, deployment reconciliation, service readiness, active worker, queue, verified releases, protected approvals.
- Sections: Engineering Operations, Diagnostics and Bugs, Improvement Lab, Visual Proposals, Release Control, Cost/Model Status.
- Make freshness obvious and add manual refresh. Explicitly label **unknown**, **not configured**, **observed**, **proposed**, **tested**, **released** and **verified live**.
- Preserve JARVIS's actual persistent engineering thread. Do not build a second chat, task system or duplicate engineer.
- Use canonical Supabase/JARVIS functions, not local counters or demo arrays.
- Separate true failures from routine clarifications and exclude validation fixtures from real work.
- Add owner-only authorization on server operations; never trust client-only gates.

## Phase 2 — JARVIS Core + immersive live voice

- Retain existing `JarvisVoiceControl` and `sendJarvisMessage` / `jarvis_turn` flow for voice and typed continuity.
- A single tap must request/establish the real realtime voice session, and another tap must end it.
- The Core should display truthful state: idle, connecting, listening, thinking, speaking, interrupted/error. Do not claim speaking/listening from animation alone; use provider connection/media events.
- Let users see transcripts and evidence in the Control Center, synchronized with the existing engineering conversation.
- Allow voice interruptions and handle auth/session expiry/reconnection safely without duplicate engineering task creation.
- Use original British-English technical voice direction, not a film voice clone or copied Marvel character assets.
- Smooth and striking iPhone-first visuals without GPU/WebGL requirements; respect reduced-motion and keep accessible text/buttons when effects fail.

## Phase 3 — Safe visual intelligence

Create a **structured, allowlisted visualization system**, not arbitrary AI-provided HTML/JS execution in the authenticated app.

- Ground visual cards in JARVIS records: candidate PRs, task outcomes, severity, observed telemetry, source-backed proposals, release verification.
- Design preview types can include: structured wireframe, component mockup, diff screenshot, architecture flow, before/after, dependency map, change timeline.
- Explicitly distinguish **concept proposal** vs **rendered mockup** vs **real candidate preview** vs **production UI**.
- Use a visual proposal schema with provenance/creation timestamp/associated task and approval state. If persisting requires a schema migration, request Adam's approval and run privacy/security review before implementation.
- For real visual previews, use isolated previews/screenshots without exposing secrets or PHI; only code from trusted pipelines.
- Selecting a proposed idea should open contextual evidence, tangible screen/workflow impact, feasible alternatives, risks and an action to discuss it with JARVIS.
- A successful live JARVIS tool turn should update the relevant visualization, not produce fake charts or status.

## Phase 4 — Autonomy, model policy and release truth

**Existing backend already includes** JARVIS research, GitHub candidate editing, worker/queue, CI checks, repair loop, Opportunity Radar, guarded approval, release gate and release operator in main. Extend these; never fork a parallel pipeline.

Known deployment gap at handoff (verify current state before acting): main contains the release operator merged via PR #24, but Supabase's live `jarvis-worker` was still version 7 without the release-operator integration during the October 7 inspection. There is a proposed task for deploying updated worker and proving live release behavior. Check whether it has since changed. **Do not treat code present on GitHub as deployed.**

- Prove the chain: request → evidence → research → plan → isolated branch → bounded edits → CI/repair → PR → protected approval → deployed version → production verification → receipt.
- Demonstrate on **real** non-fixture engineering tasks, not only synthetic fixtures.
- Keep model/CI tools and secrets server-side. No model may directly merge, deploy protected changes, edit secrets or weaken authentication/RLS.
- Confirm `gpt-6-astra` and `reasoning.effort: medium` are actually available in Emery's OpenAI API account/config before updating the worker. Prefer economical models for low-complexity tasks. Propose cost limits with Adam approval before activating additional paid usage.
- Retain free-first approach; no Lovable AI-generation credits.
- Keep the four release tiers (auto low-risk / Adam-approved application code / human-reviewed infrastructure & protections / never secrets). Preserve SHA-bound approvals, expiring approval tokens, idempotency, tests and rollback proposals.
- Resolve Lovable manual Publish as a **separate proposed deployment architecture**, not an unapproved hosting migration. Validate any alternative hosting, server-side TanStack Start behavior, PWA, auth and Supabase first.

## User experience (expected)

1. Open Emery → Settings → JARVIS Engineering Control Center.
2. Review live production health, active tasks, suggested improvements, failures and approvals.
3. Tap the animated Core; real JARVIS Voice starts. Ask: “How is Emery doing?” JARVIS retrieves evidence, speaks and shows truthful panels.
4. Ask: “Show me the HPO improvement you're considering.” JARVIS opens a source-linked visual proposal and identifies its stage.
5. Ask: “Fix the verified bug.” JARVIS uses the current engineering queue and permissioned worker, reports the PR/test status, requests approval when required, and only calls it shipped after served-production verification.

## Required testing and acceptance gates

- Settings links correctly; deep linking/refresh works on iPhone + desktop.
- Existing four main tabs and all HPO/Planner/Leaflet/Accounts/Calendar flows are unaffected.
- Agent list hides JARVIS without deleting any row or historical records; older JARVIS deep links still resolve.
- JARVIS Core starts/stops actual realtime voice, prevents parallel Emery Voice, surfaces provider errors, and requires a real user gesture.
- Typed and voice messages use the same authoritative JARVIS conversation/thread, with idempotent turn handling.
- Telemetry display never exposes raw sensitive metadata, patient names or secrets; errors clearly distinguish signal from diagnosis.
- Proposed ideas/visualizations show provenance and do not masquerade as rendered or deployed previews.
- Release approvals still enforce existing risk policy; failed CI, moving SHA, unverified deployment and missing configuration block release.
- Validations: project typecheck, build, JARVIS validators, control-center focused regression tests, authenticated browser smoke checks, iPhone viewport, fresh navigation, no WebGL blank.
- Verify against actual current GitHub main, deployed Supabase function version, Lovable published commit and release ledger. Record discrepancies, do not conceal them.
- Report exact tested commit, evidence, changed paths, unfinished limitations and next owner approval.

## Working method

Finish from the current candidate; do not restart it. You may add focused tests, visual components and bounded gateway enhancements. Preserve functioning systems. Work autonomously on candidate code but stop at approvals and live-data-sensitive changes. Avoid sweeping architecture audits or cosmetic redesign outside JARVIS. If one long run cannot finish safely, leave an executable next step and exact checkpoint, rather than pretending all phases are done.

**Definition of done:** Adam can converse with JARVIS inside Settings, see live production evidence, inspect real visual proposals, request repairs, review code/test outcomes and approve permitted releases. No fake autonomy, no fabricated preview, no production changes without required authorization.
