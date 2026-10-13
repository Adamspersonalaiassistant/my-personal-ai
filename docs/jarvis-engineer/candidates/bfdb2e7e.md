# JARVIS candidate bfdb2e7e: Close capability gap: apple_notes

- Task: `bfdb2e7e-484c-4922-b39d-e7d995a8c0a3`
- Source: opportunity_radar (radar:capability_gap:apple_notes)
- Base: main @ `d0c3c2c`
- Risk: medium

## Objective

Emery repeatedly hit a capability gap for "apple_notes" (e.g. Adam asked: "Add a note to my Apple Notes"). Make Emery's capability registry truthful about it so she states clearly what is and is not connected instead of implying success. Smallest safe change; preserve existing capability behaviour.

## Evidence

```json
[
  {
    "at": "2026-10-06T13:36:38.191296+00:00",
    "action": "emery_turn",
    "source": "emery_runtime_events",
    "request": "Add a note to my Apple Notes",
    "observed": "Emery implied the note was saved although Apple Notes is not connected",
    "event_type": "capability_gap"
  },
  {
    "at": "2026-10-06T13:36:38.191296+00:00",
    "action": "emery_turn",
    "source": "emery_runtime_events",
    "request": "Add a note to my Apple Notes",
    "observed": "Emery implied the note was saved although Apple Notes is not connected",
    "event_type": "capability_gap"
  },
  {
    "at": "2026-10-06T13:36:38.191296+00:00",
    "action": "emery_turn",
    "source": "emery_runtime_events",
    "request": "Add a note to my Apple Notes",
    "observed": "Emery implied the note was saved although Apple Notes is not connected",
    "event_type": "capability_gap"
  }
]
```

## Verification

Isolated GitHub Actions job `jarvis-candidate` (no production secrets): typecheck, validate:jarvis, validate:phase0, validate:behavior, build.
