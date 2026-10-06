# Adam Engineering Profile

This file captures the product-relevant information JARVIS needs in order to improve Emery for Adam. It deliberately excludes secrets, credentials, patient PHI, and unrelated sensitive personal information.

## Adam's role in the product

Adam is Emery's owner, primary user, product decision-maker, and the person whose real daily work defines whether Emery is useful.

He uses Emery as a personal operating system and as a work operating system for Hudson Pro Orthopedics & Sports Medicine. His field workflow is mobile-first and often happens between offices, while driving, or during fast transitions.

## Product reality

Adam does not want another piece of software he has to manage. He wants Emery to reduce the number of decisions and manual steps required to get work done.

High-level product requirement:

> Adam should rarely be lost on what to do next.

JARVIS should optimize for:

- fewer repeated explanations;
- lower cognitive load;
- one clear highest-value next action when Adam is overloaded;
- strong voice-first/mobile behavior;
- durable context across sessions and devices;
- execution rather than advice-only behavior;
- proof of completed actions;
- recovery when tools fail;
- proactive discovery of improvements without constant supervision.

## How Adam communicates engineering requests

Adam often describes the desired experience in natural language rather than software specifications. JARVIS must translate product intent into architecture and acceptance tests without forcing Adam to become the engineer.

Patterns to preserve:

- When Adam says a workflow should "just work," identify the hidden technical steps and make them dependable.
- When Adam says he does not want Emery to say "I can't do that," interpret this as a requirement to exhaust safe capabilities, discover tools, research, replan, or record a capability gap before returning a dead end.
- When Adam reports frustration, treat it as a high-value product signal rather than merely a tone issue.
- When Adam corrects a product decision, the latest correction wins over older plans.
- Adam values finished execution more than architecture commentary.
- Adam strongly dislikes spending premium AI usage on broad audits or research that produces no committed implementation.

## Cost and usage philosophy

Spend expensive reasoning/model usage when it creates leverage that reduces future manual work.

Prefer:

1. deterministic checks;
2. existing code/knowledge/research reuse;
3. focused inexpensive reasoning;
4. premium coding/reasoning only when the engineering problem justifies it.

Do not repeatedly rediscover product history. Preserve it in this repository and the JARVIS knowledge layer.

## Quality bar

A feature is not finished because code was generated. It is finished when:

- it is integrated with the existing architecture;
- authoritative state confirms the expected result;
- relevant tests/evaluations pass;
- existing critical workflows do not regress;
- production state is observable;
- Emery/JARVIS can truthfully explain what changed.

## What Adam wants to stop doing

JARVIS should continuously reduce Adam's need to:

- write long prompts explaining Emery's architecture;
- repeat product decisions to new coding agents;
- manually diagnose routine software failures;
- search GitHub for implementation ideas;
- supervise every branch and test cycle;
- repeatedly tell Emery what capabilities she is supposed to have;
- spend hours acting as Emery's technical project manager.

## Desired owner experience

Normal day:

Adam works → uses Emery → Emery handles work → runtime evidence accumulates → JARVIS detects worthwhile improvements → JARVIS builds/test candidates → Adam later receives one concise engineering update and only the approvals that truly require ownership judgment.
