# JARVIS Knowledge Source Index

JARVIS should preserve current truth in the canonical documents in this folder and use historical sources only when deeper context is needed.

## Canonical JARVIS knowledge

Read in this order:

1. `00-JARVIS-MISSION.md`
2. `01-ADAM-ENGINEERING-PROFILE.md`
3. `02-EMERY-PRODUCT-CONTRACT.md`
4. `03-CURRENT-ARCHITECTURE.md`
5. `04-HPO-CONTRACT.md`
6. `05-HISTORY-AND-LESSONS.md`
7. `06-TASK-QUEUE-AND-SESSION-CONTRACT.md`
8. `07-RELEASE-AND-SELF-AWARENESS.md`
9. `08-ADAM-REQUEST-PATTERNS.md`
10. `09-ACCEPTANCE-TESTS.md`

## Historical engineering material already available to the project

Useful existing sources include:

- Emery Engineering Handoff & 100× Execution Roadmap
- prior Jarvis/Emery architecture prompts
- Phase 1–9 implementation/verification history
- current GitHub repository history
- Supabase runtime telemetry/evaluations/improvement backlog
- Lovable production/deployment state

JARVIS should not repeatedly inject all historical text into every model call. Retrieve only the relevant slice for the active engineering problem.

## Chat-history ingestion rule

The long-term goal is to maintain a searchable engineering-history archive from Adam's Emery project conversations while keeping the canonical product contract compact.

Historical chat content should be transformed into structured knowledge such as:

- product decision;
- user preference;
- frustration/failure signal;
- architecture constraint;
- workflow requirement;
- acceptance test;
- superseded decision;
- lesson learned.

Do not blindly promote every historical statement into current truth.

## Latest decision wins

When historical chats conflict:

1. use Adam's newest explicit correction;
2. update the canonical JARVIS docs/decision ledger;
3. mark older guidance as superseded when practical;
4. avoid loading obsolete instructions into active engineering context.

## Sensitive-data exclusions

Never place these into general JARVIS engineering knowledge:

- passwords;
- API keys/tokens;
- authentication secrets;
- patient names or PHI;
- unrelated sensitive personal information.

JARVIS may know that a secure integration exists without ever storing secret values in this knowledge layer.

## Future continuous-ingestion target

New Emery project conversations should eventually feed a summarization/decision-extraction pipeline that proposes updates to this knowledge base or a searchable engineering-history store.

That pipeline should preserve provenance and timestamps so JARVIS can distinguish current decisions from old plans.
