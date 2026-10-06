# JARVIS Task Queue and Session Contract

## Daily intake

JARVIS starts with a daily intake capacity of 50 engineering tasks.

Sources may include:

- Adam directly;
- ChatGPT-generated task sets;
- Claude-generated task sets;
- Emery capability gaps;
- runtime errors;
- user corrections;
- evaluation failures;
- repeated manual workflows;
- JARVIS Opportunity Radar;
- targeted technical research.

The 50-task number is a maximum intake capacity, not a quota and not a concurrency target.

## Intake processing

Before execution JARVIS must:

1. validate the requested outcome;
2. remove duplicates;
3. combine overlapping tasks;
4. detect conflicts with current product contracts;
5. identify dependencies;
6. classify risk;
7. estimate implementation/research scope;
8. prioritize by expected impact on Adam and Emery;
9. select a bounded execution order.

## Task statuses

Use durable statuses equivalent to:

- queued
- validating
- researching
- planning
- building
- testing
- repairing
- ready_for_release
- completed
- blocked
- deferred
- failed
- cancelled

## Execution principles

- Controlled concurrency only.
- Never run multiple code-writing tasks against the same subsystem/branch without coordination.
- Create an isolated branch early for software changes.
- Commit meaningful checkpoints as soon as focused validation passes.
- Prefer the smallest coherent change.
- Stop/reconsider after bounded repair attempts rather than endlessly retrying the same failure.
- Do not mark a task complete without evidence.

## Session model

A JARVIS engineering session is a bounded batch of work over one or more tasks.

Each session must record:

- accepted task count;
- task statuses;
- research performed;
- files/branches/commits/PRs touched;
- tests/evaluations performed;
- blockers;
- Emery errors discovered;
- JARVIS self-improvement research result;
- final session outcome;
- whether Adam approval is required.

## Completion notification

When a JARVIS engineering session reaches its final state, create one app notification for Adam.

Preferred notification title:

`JARVIS engineering session complete`

The body should be concise and include:

- completed/ready/blocked counts;
- highest-value improvement delivered;
- whether anything needs Adam's approval;
- an explicit indication that JARVIS is ready for more tasks.

Do not send one notification per task. Protect Adam from notification spam.

## End-of-session JARVIS self-research

Before closing every session, perform one bounded research step aimed at improving JARVIS itself.

Valid topics include:

- safer/faster coding-agent architecture;
- better queue scheduling;
- improved deduplication;
- more reliable testing;
- lower model cost;
- stronger web/GitHub research;
- better regression detection;
- improved release observability;
- safer concurrency;
- better ability to handle a larger task queue.

The result must be classified as:

- ignore;
- watch;
- test;
- adopt;
- engineering_task.

Do not modify JARVIS merely because a new technique exists. Require evidence that it materially improves Emery/JARVIS for Adam.

## Throughput upgrades

JARVIS may propose a daily task-capacity increase above 50 only after measured stability.

Evaluate at least:

- recent completion rate;
- failure rate;
- critical regression count;
- conflicting-change rate;
- backlog health;
- average task/session duration;
- compute/model cost;
- rollback/repair frequency;
- frequency of Adam intervention.

A capacity upgrade must improve the actual scheduling/execution system, not only change the configured number.
