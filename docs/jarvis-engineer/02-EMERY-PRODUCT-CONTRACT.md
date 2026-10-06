# Emery Product Contract

These are binding product constraints for JARVIS Engineer unless Adam explicitly changes them later.

## One Emery

There is one Emery identity and one persistent relationship across typed Chat, Voice, Shortcuts/capture, Calendar, HPO, memory, and future integrations.

Do not create competing assistant identities or duplicate brains.

## Simple surface, powerful backend

The backend may become substantially more capable, but Adam should not have to manage that complexity.

Current permanent top-level product destinations are:

- Emery
- HPO
- Calendar
- More

Inside HPO, preserve the working four-surface model:

- Planner
- Maps
- Accounts
- Activity

Planner is the primary HPO route workflow.

Do not recreate the removed Today tab unless Adam explicitly reverses that decision.

## HPO map

Leaflet is intentional and is the current map implementation. Do not casually replace it with MapLibre or another map engine.

## Canonical execution

Use existing canonical controllers, execution kernel, receipts, idempotency, current-context authority, ownership rules, and CRM history paths.

Never claim a structured write succeeded until the authoritative controller/receipt confirms it.

Direct commands authorize the requested action when policy allows it. Casual discussion is not permission to mutate data.

## Tasks and Calendar

Tasks and Calendar are distinct concepts.

- A task deadline is not automatically a Calendar block.
- Unscheduled tasks may remain in the Task List.
- A missed Calendar block can be rescheduled without silently redefining the task deadline.

Do not create competing sources of truth for scheduling.

## Memory

Preserve the existing durable memory system and smart-memory architecture.

Do not create a second memory database or shadow memory system.

Memory should remain selective, source-aware, correctable, and bounded.

## Voice

Voice and typed Chat are two interfaces to the same Emery brain and action layer.

Preserve shared conversation/context/action truth.

Do not create a separate Voice assistant.

## HPO privacy boundary

HPO is a referral-source, relationship, field-sales, route, and account operating system. It is not a patient chart.

Never request, infer, store, or repeat patient PHI inside HPO relationship records or JARVIS engineering training data.

## Truthful UI and system state

Only expose system states that are backed by real runtime evidence.

Do not fake "searching," "remembering," "syncing," "executing," or "done" states merely for visual effect.

## No duplicate platforms

Do not build:

- a second CRM;
- a second planner;
- a second memory system;
- a second conversation system;
- a second Voice system;
- a parallel HPO database;
- a separate agent framework when the existing architecture can be extended.

## No unnecessary redesign

JARVIS engineering tasks are not permission to redesign unrelated Emery surfaces.

Preserve working professional UX unless the task is explicitly visual/product-design work.

## Cost discipline

Do not use Lovable AI-generation credits for backend/code work when direct code/GitHub work is practical.

Research only what is needed to solve the active problem.

## Production approval boundary

JARVIS may autonomously prepare candidate changes and low-risk reversible allowlisted tuning.

Explicit Adam approval is required before:

- merging self-written software to production when policy marks it high impact;
- production deployment of high-impact software changes;
- destructive database/schema operations;
- authentication/security model changes;
- credential changes;
- protected HPO workflow changes;
- irreversible deletion or corruption risk.

The goal is to remove engineering labor from Adam, not remove Adam's ownership authority.
