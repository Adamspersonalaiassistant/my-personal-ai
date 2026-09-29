# ChatGPT Work Resume — Emery Professionalization

Updated 2026-09-29 for the next sustained Work run.

## Mission
Finish the existing 270-gap Emery professionalization job. Do not restart it, do not return a plan, and do not stop after one milestone. Emery is Adam's ONE private personal AI assistant; HPO CRM, Calendar, Tasks, memory, Voice, files, routes, research and integrations are capabilities of the same assistant.

## Source of truth
1. Current branch: `codex/emery-professionalization`
2. Draft PR: #7
3. Baseline production/main at start: `5f7af39e677e225cf4b56d87cc2ff164de61db14`
4. Current branch head when this handoff was prepared: `f6e2d8adf2f617c0a6328a5738be90cac74eb432`
5. Read `docs/EMERY-PROFESSIONALIZATION-STATE.md` first.
6. Read `docs/EMERY-PROFESSIONALIZATION-COVERAGE.md` second. It is the mandatory 1–270 ledger.
7. Inspect commits on this branch after the last state-file checkpoint before editing anything. The state file may lag code.
8. Current repo/schema/runtime/telemetry beats stale prose.

## Work already on this branch
Do not redo it blindly. Verify it, reconcile the ledger, and build on it:
- typed orchestration context/action plan/capability registry/risk policy/receipt aggregation;
- executable Jason regression fixtures;
- atomic HPO set-remaining-stops/Field Session RPC migration;
- safe “only remaining stop” route command;
- HPO contact-assisted entity resolution;
- multi-intent HPO orchestration wiring so Calendar recognition no longer automatically suppresses HPO;
- improved HPO nearby scoring/relationship reasoning;
- explicit preferred-stop support for route note capture;
- accessibility viewport/theme improvements;
- HPO map route-eligibility/filter metadata;
- orchestration type/lint fixes.
Verify exact current implementation from Git history because more branch commits may exist.

## Non-negotiable execution protocol
- Stay on this branch until the final gate is green.
- Keep PR #7 as the review/deployment vehicle unless repository state requires otherwise.
- Use direct GitHub/code edits. Lovable AI-generation credits = 0 unless there is no reasonable direct-code path; if one is truly required, explain why before using it.
- Lovable preview/deploy/project inspection that does not consume AI-generation credits is allowed.
- Preserve Leaflet as the primary HPO map.
- Preserve production CRM/history, account ownership/exclusions, current dark HPO design, realtime Voice foundation, and safe prospect-write layer.
- Never create fake production CRM records for tests.
- Use fixtures/test data outside production for destructive/action tests.
- Before risky DB/data changes: inspect schema/RLS/ownership, make migration reversible or safely forward-fixable, protect current records, and verify postconditions.
- Small rollback-friendly commits after meaningful milestones.
- After each milestone: implement -> focused tests -> diff review -> update STATE/COVERAGE -> commit -> continue automatically.
- Full suite only at meaningful gates; focused tests while iterating.
- Do not repeatedly reread unchanged files or redo broad research.
- Do not ask Adam routine engineering questions. Use sound defaults. Ask only for an external credential, irreversible production-data decision, or genuinely ambiguous product decision.
- Missing external OAuth/native credentials must NOT stop unrelated work. Finish code and mark external activation clearly.
- If context compacts, recover from Git + STATE + COVERAGE and continue; never restart the audit.

## Mandatory completion semantics
Every one of the 270 rows must end as exactly one of:
- FIXED + VERIFIED
- VALIDATED NOT A DEFECT (with concrete evidence)
- PLATFORM LIMIT + BEST AVAILABLE UX VERIFIED
- EXTERNAL ACTIVATION REQUIRED + CODE COMPLETE

No OPEN rows may remain at final completion.
Do not mark a row fixed because adjacent architecture exists. Verify the actual user-visible/runtime requirement.
Critical/high issues may not be deferred merely for time.

## Required dependency order
A. Reconcile current branch and ledger.
B. Finish planner -> resolver -> executor -> receipt runtime composition shared by Chat and Voice.
C. Today's Plan + persistent Field Session + safe set-stops + meeting/contact/account resolution.
D. Voice/hands-free context, Talk to Emery, note binding, audition/change workflow.
E. Route reliability/errors/reorder/optimization/scoring.
F. CRM normalization, structured exclusions, duplicates, provenance, research-safe write bridge.
G. Map filters/category normalization/geocoding/multi-location.
H. CRM intelligence/contacts/timeline/follow-up source of truth.
I. Navigation/deep links/update strategy/PWA/offline/mobile/accessibility/theme.
J. Calendar/integration adapters/notifications/performance/streaming.
K. Semantic/entity memory + centralized source hierarchy.
L. Emery Health/capability truth/self-improvement recommendations from real telemetry.
M. Unit/integration/E2E/visual/accessibility/performance/network/idempotency QA.
N. Reconcile every 1–270 row.
O. Final production gate -> merge main -> publish -> production smoke test -> final report.

## Binding Jason acceptance test
Exact input:
“I have my lunch today with Jason so can you put that as the only stop for today and get ready to take the note because I will let you know how it went afterwards”

Required:
- planner detects multiple intents;
- Calendar may contribute but may not suppress HPO;
- resolve today’s meeting/person;
- resolve via HPO contacts/account/prospect/entity aliases if possible;
- if the office is still genuinely unresolved, ask ONE narrow question such as which firm/office;
- preserve completed route history;
- safely make the resolved office the only remaining stop;
- persist Field Session / expected-next-note target;
- response states exactly what succeeded;
- repeat/retry is idempotent.

Also test morning plan, “I’m here”, “Just left…”, follow-up, “undo that”, offline/retry, duplicate write prevention across surfaces, selected-account context, exclusions/ownership, research conflict protection, voice interruption/correction, and end-of-day wrap.

## Professional acceptance gate
Do NOT claim done from TypeScript/build/static scripts alone.
Final gate requires, to the extent technically automatable:
- TypeScript/build/lint/custom validators;
- unit/integration tests;
- browser E2E;
- accessibility automation;
- visual/mobile regression;
- offline/network retry/idempotency tests;
- performance/latency budget;
- data-integrity/migration verification;
- runtime/tool execution smoke tests;
- Leaflet regression checks;
- production deploy smoke check.

For real iPhone behaviors automation cannot truthfully verify, provide a short final checklist. Do not claim those were personally verified.

## Publishing rule
Do not merge/publish partial work.
When all 270 rows have final allowed statuses and all critical/high items are resolved:
1. run final suite;
2. inspect complete diff against main;
3. verify no production-data/destructive surprises;
4. update STATE and COVERAGE with exact evidence/commits;
5. make PR #7 ready;
6. merge the professionalization branch to main using the safest supported repo method;
7. publish/deploy through the existing Lovable production path WITHOUT Lovable AI generation;
8. verify production status and perform non-destructive smoke checks;
9. report exact merged commit, deployment, tests, external activation items, and the minimum real-iPhone checklist.

## Usage/context conservation
Prioritize completion over narration:
- keep chat updates minimal;
- store progress in repo files;
- batch independent reads;
- inspect by targeted search before opening giant files;
- do not rerun full suites after every tiny edit;
- update ledger once per meaningful checkpoint rather than after every line;
- checkpoint before risky or context-heavy phases;
- if a hard Work/runtime limit is reached, leave the branch BUILDABLE, commit current safe work, update STATE with the exact next action, and continue from that checkpoint when execution resumes. Never reconstruct from scratch.

## Immediate next action
Read the latest branch commit history after `f6e2d8ad...`, reconcile STATE/COVERAGE against actual code, run the focused orchestration/TypeScript/lint gate, then continue from the first genuinely incomplete dependency milestone. Do not return a progress-only response.
