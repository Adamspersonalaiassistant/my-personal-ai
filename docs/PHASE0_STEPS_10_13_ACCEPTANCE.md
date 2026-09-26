# Emery Phase 0 — Steps 10–13 Acceptance Contract

This contract is intentionally zero-Lovable-credit work. It defines the certification bar before paid UI work.

## Step 10 — Voice uses the canonical action brain
Acceptance:
- Live Voice remains the same Emery identity and main conversation.
- Explicit Voice requests for create task, schedule task, complete task, create event/lunch, and reschedule event use the same canonical Calendar action semantics as text.
- Explicit time ranges preserve duration; moving an event without a new end preserves existing duration.
- Casual discussion does not write.
- Ambiguity produces one clarification question.
- Voice never claims a write unless the backend confirms it.
- Existing web search, context refresh, voice-profile refinement, transcript persistence, and interruption behavior remain intact.

Current audit: Voice is already one identity and has strong Realtime/session persistence, but its Realtime tool list currently lacks Calendar write tools. Therefore Step 10 is NOT COMPLETE until the canonical controller is exposed to Voice and regression-tested.

## Step 11 — Real HPO intelligence, provenance first
Acceptance:
- Use existing hpo_accounts, hpo_contacts, hpo_interactions, hpo_sales_metrics, hpo_route_plans/stops, hpo_data_imports/import_rows.
- Never ingest PHI, patient names, DOBs, diagnoses, claim numbers, medical records, or attorney-client case details.
- Stage bulk data before promotion; preserve source_type/source_ref/source_origin and dedupe evidence.
- Never invent or silently merge addresses/accounts.
- Prioritize 50–100 meaningful accounts once a clean source is available.
- Global tasks/meetings remain the only action/calendar systems.

Current audit: live HPO operating tables contain zero accounts, contacts, interactions and routes. Import architecture exists. Step 11 is NOT COMPLETE because no authoritative bulk source was available to this run; inventing records would violate the contract.

## Step 12 — Permanent Emery certification suite
Minimum suites:
1. Calendar authorization and no-write casual mention.
2. Missing-detail clarification.
3. Explicit event duration preservation.
4. Reschedule preserves duration.
5. Task completion/scheduling exact-target behavior.
6. Lunch event + day-before confirmation.
7. Memory correction/supersession and duplicate avoidance.
8. Same-Emery continuity across chat, Shortcut, Voice.
9. Voice transcript de-dupe and one-session ownership.
10. Voice canonical Calendar writes.
11. HPO no-PHI/provenance/address rules.
12. Push notification idempotency/recovery.
13. Failure handling: no false success claim.

Every fixed production regression becomes a permanent assertion.

## Step 13 — Server-side proactivity
Acceptance:
- Morning brief, field-day prep, post-meeting/lunch recap prompt, evening closeout, nightly evaluation, and weekly pattern summary are server-side jobs, not UI-dependent.
- Jobs are idempotent and duplicate-suppressed.
- No proactive job performs high-impact external actions without Adam's authorization.
- Notifications are sparse and useful; no notification is sent merely because a job ran.
- Each job records run/success/failure/suppression evidence.
- Background routines use bounded context and avoid PHI.

Current audit: push dispatch/cron exists, but the broader proactive routines above are not yet implemented. Step 13 is NOT COMPLETE.

## Phase 0 release gate
Do not spend Lovable credits merely to satisfy these backend requirements. Paid UI work begins only after the zero-credit backend changes are merged, CI/regressions pass, real HPO source data is staged/validated, and any required manual iPhone push/Voice checks are performed.
