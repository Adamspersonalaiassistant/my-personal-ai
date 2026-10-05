# Current Emery Architecture — JARVIS Reference

This document is a durable orientation map. JARVIS must inspect live source before modifying implementation details, but should use this file to avoid rediscovering the product from scratch.

## Application shape

- Mobile-first PWA.
- React/TanStack application with Tailwind-based UI.
- Supabase/Postgres is the durable operating-data layer with authentication/RLS.
- Emery has one persistent main conversation.
- Typed Chat, Voice and capture/Shortcut entry points are intended to share one Emery identity, context, memory and action architecture.
- HPO is a professional relationship/field-sales operating system inside Emery.
- Leaflet is the current HPO map implementation.

## Core intelligence/runtime concepts already present

JARVIS should extend these rather than replace them:

- assistant identity contract;
- durable/smart memory;
- context engine and bounded context-load policy;
- capability registry and capability routing;
- entity resolution;
- action/execution planning;
- canonical execution kernel/controllers;
- execution ledger/receipts;
- runtime telemetry;
- evaluation corpus/runner/observer;
- self-improvement backlog and reversible improvement-change ledger;
- device continuity;
- Voice runtime and Voice action bridge;
- HPO account/route/activity controllers.

## Important source areas

Inspect live paths before edits. Known core areas include:

- `src/lib/emery/`
- `src/lib/emery.functions.ts`
- HPO action/route/account controllers under `src/lib/`
- execution kernel/ledger/capability files under `src/lib/`
- authenticated routes/components for Emery, HPO, Calendar and More
- Supabase migrations and generated database types
- validation scripts under `scripts/`

## Existing strengths

Emery is already more than a chatbot. Existing architecture has supported real structured actions including task/event creation, HPO route optimization, HPO route notes, account/relationship writes, receipts, telemetry and self-review.

Do not erase these strengths by introducing a generic agent framework that bypasses canonical Emery systems.

## Current strategic gap

Understanding, memory and domain-specific actions have advanced faster than generalized autonomous execution.

The next architecture must connect:

Goal → plan → capability discovery → execution → verification → replan when incomplete → capability-gap evidence → engineering improvement.

JARVIS is responsible for the engineering/improvement half of that loop.

## Source-of-truth hierarchy

When sources conflict, use this order unless Adam explicitly overrides it:

1. Adam's latest explicit product decision.
2. Current production behavior and authoritative database state.
3. Current `main` source code.
4. Current JARVIS/Emery product-contract documents.
5. Recent accepted architecture decisions.
6. Older plans, roadmaps and historical chats.

Historical material is context, not automatically current truth.

## Engineering rule

Before changing a subsystem:

1. identify the canonical existing implementation;
2. identify the authoritative data source;
3. reproduce the real problem;
4. confirm the proposed change does not create a parallel system;
5. change the smallest coherent surface;
6. validate focused behavior;
7. run relevant regressions;
8. record the result in JARVIS engineering state/release history.
