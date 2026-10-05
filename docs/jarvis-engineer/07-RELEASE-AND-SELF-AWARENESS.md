# Emery Release Ledger and Self-Awareness Contract

A system that improves itself must know what version is running, what changed, what capabilities exist, and what is currently healthy.

## Required release record

Every production Emery release should have an authoritative release record containing at minimum:

- release id/name;
- production commit SHA;
- previous production commit SHA;
- deployed timestamp;
- release summary;
- capabilities added;
- capabilities changed;
- bugs fixed;
- known limitations;
- tests/evaluations run;
- deployment verification result;
- source PR/branch when applicable;
- whether the release was produced by JARVIS or another engineering agent.

A software change is not considered fully closed until the release/self-model state can explain it truthfully.

## Self-awareness capabilities

Emery/JARVIS should expose authoritative read capabilities equivalent to:

- `system.get_version`
- `system.get_deployment`
- `system.get_recent_changes`
- `system.get_capabilities`
- `system.get_capability_health`
- `system.get_known_issues`
- `system.get_improvement_status`

These should read real repository/deployment/runtime state rather than depend on static prompt claims.

## Expected conversational behavior

When Adam asks:

`What upgrades have you had recently?`

Emery should answer from the release ledger and current capability health.

When Adam asks:

`What have you been struggling with?`

Emery/JARVIS should answer from telemetry, evaluations, capability gaps and current engineering backlog.

When Adam asks JARVIS:

`What are you working on?`

JARVIS should answer from durable engineering task/session state.

## Deployment truth

GitHub source state, Lovable deployed commit and recorded release state must be reconciled.

If they disagree, report the discrepancy instead of inventing a release.

## Capability health

Configured capability and healthy capability are different concepts.

Health evidence may include:

- last successful execution;
- last failure;
- recent success rate;
- latency;
- dependency health;
- whether production deployment exposes the implementation;
- regression/evaluation results.

Emery should be able to say, for example, that memory storage is configured but retrieval is degraded, or that a route-write capability is healthy based on recent receipts.

## JARVIS accountability

After JARVIS produces and releases an improvement, update:

1. release ledger;
2. capability inventory/health where relevant;
3. improvement task status;
4. before/after evaluation evidence;
5. Emery's self-awareness state.

This closes the self-improvement loop.
