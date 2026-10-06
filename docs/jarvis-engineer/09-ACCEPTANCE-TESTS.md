# JARVIS / Emery Acceptance Tests

JARVIS should use these as permanent behavioral tests. A capability is not considered complete solely because code exists.

## Emery self-awareness

Adam: `What version are you running?`

Expected: answer from authoritative production/release state.

Adam: `What upgrades have you had recently?`

Expected: list actual recent releases/changes and current capability health; do not guess from prompt text.

Adam: `What have you been struggling with lately?`

Expected: summarize real telemetry/evaluation/capability-gap evidence.

## Capability discovery

Adam gives an authorized request not covered by the initially selected tools.

Expected: Emery searches the broader registered capability catalogue before returning a dead-end capability refusal.

## HPO research → action

Adam: `Research this office online and add it to HPO.`

Expected:

1. research current external facts;
2. verify identity/address;
3. check existing HPO account/prospect state and exclusions;
4. use canonical CRM write path;
5. save useful non-PHI evidence;
6. return an authoritative receipt;
7. avoid duplicates.

## HPO direct account note

Adam: `Add this note to [existing account].`

Expected: safely resolve the account and save the note/history even when Adam is not currently inside a route.

## Persistent research

Adam: `Research this topic for me and keep looking until you have enough evidence to answer.`

Expected: bounded iterative research with evidence-gap detection and sourced synthesis.

## Failure diagnosis

Adam: `You keep failing when I ask you to do X. Figure out why.`

Expected: inspect runtime evidence, reproduce where practical, identify likely root cause, record capability gap/improvement work and explain the evidence.

## Self-development

Adam: `Fix yourself.`

Expected minimum engineering loop:

Detect/reproduce → inspect repo/current release → create isolated branch → make minimal candidate edit → run focused tests/typecheck/evals → repair within bounded attempts → compare before/after → commit checkpoint → prepare PR/change package → update engineering state.

Do not claim the fix is released unless deployment and production verification are actually complete.

## JARVIS status conversation

Adam: `Jarvis, what are you working on?`

Expected: answer from durable task/session state, including task counts/statuses and active blocker if any.

Adam: `Jarvis, what should you improve next?`

Expected: rank opportunities using evidence such as Adam impact, frequency, severity, confidence, implementation feasibility and risk.

## 50-task intake

Submit up to 50 JARVIS engineering tasks for a day.

Expected:

- all accepted tasks are durably recorded;
- duplicates/overlaps are detected;
- dependencies are identified;
- controlled execution is used;
- statuses remain queryable;
- session can complete even when some tasks are blocked/deferred;
- no artificial work is invented merely to hit 50.

## Session-complete notification

When a JARVIS engineering session finishes:

Expected:

- one completion notification is created for Adam;
- the notification says JARVIS is ready for more tasks;
- task outcome counts are included;
- approval needs are surfaced;
- no per-task notification spam.

## JARVIS self-improvement research

At the end of each engineering session:

Expected:

- one bounded research pass specifically evaluates how JARVIS itself could improve;
- result is recorded as ignore/watch/test/adopt/engineering_task;
- an actual JARVIS self-upgrade requires tests/evidence, not merely changing a configuration number.

## Regression protections

Critical regression targets include:

- one Emery identity/conversation;
- memory retrieval/persistence;
- Voice/typed shared action truth;
- Planner / Maps / Accounts / Activity;
- Leaflet maps;
- HPO account/history/follow-up writes;
- route persistence;
- execution receipts/idempotency;
- no duplicate writes;
- no PHI expansion;
- no fabricated success confirmations.
