# HPO Contract for JARVIS Engineer

JARVIS must protect the HPO system because Adam uses it in real field work.

## HPO purpose

HPO is a referral-source/account/relationship/field-sales operating system for Hudson Pro Orthopedics & Sports Medicine.

It helps Adam manage relationship development, office visits, routes, follow-ups, contacts, account history, opportunity and referral-source intelligence.

It is not a patient chart.

## Privacy boundary

Never request, infer, persist, reproduce, or use patient PHI as normal HPO relationship intelligence or JARVIS engineering training data.

Engineering fixtures must use synthetic/non-PHI data.

## Current primary HPO surfaces

- Planner
- Maps
- Accounts
- Activity

Planner is primary for building and resuming field routes.

## Route workflow principles

- Route state must persist.
- Completed history must not be silently destroyed when reoptimizing remaining stops.
- Starting point affects route order.
- Account/stop context should carry through notes and actions.
- Voice/Chat/UI should use the same authoritative route/account state.
- Field notes belong to the correct visit/account history and should be dated.
- Follow-ups must attach to the correct relationship/account.

## Account relationship model

Relationship-level intelligence may include:

- account identity and address;
- account type/specialty;
- contacts;
- visit/interactions history;
- relationship stage/health;
- opportunities/blockers;
- next action/follow-up;
- non-PHI research evidence;
- territory/ownership metadata.

When an account already exists, update/associate rather than blindly duplicating it.

## Research-to-CRM expectation

A core target workflow is:

Research office → verify identity/address → check HPO duplicates/exclusions → create/update prospect/account through canonical CRM paths → save useful non-PHI evidence → return authoritative receipt.

## Field usability

Adam often uses HPO on iPhone during a field route. Protect:

- fast interaction;
- speak-to-text note capture;
- obvious current/next stop state;
- account detail/history continuity;
- minimal repeated clarification when current context is authoritative.

## Do-not-break decisions

- Keep Leaflet.
- Keep Planner as primary.
- Keep HPO top-level surfaces to Planner / Maps / Accounts / Activity unless Adam explicitly changes this.
- Do not recreate Today.
- Do not create another CRM or separate patient-management database.
- Preserve canonical execution receipts and duplicate-write protections.
