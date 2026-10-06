# JARVIS production capacity accounting and task approval

## The rule

`accepted_today` / the `X / 50` counter means: **real production engineering tasks that Adam approved and the worker accepted into today's (Eastern) session.**

It excludes proposed tasks, research ideas, Radar candidates, validation fixtures, load-test and CI tasks, cancelled or superseded tasks, deferred placeholders, merged duplicates and ledger-only rows. A task counts only if it has a `session_id` for today **and** `is_fixture = false`, `approval_state = 'approved'`, `status not in (cancelled, deferred)` and `merged_into is null` (`countsTowardCapacity` in `src/lib/jarvis/state.ts`, mirrored in the worker engine and in `jarvis_accept_task`).

## Model (smallest durable change)

| Concept | Representation |
| --- | --- |
| Test / fixture task | `is_fixture = true` (existing column). Never counts. Capped separately by `jarvis_accept_task`, so the worker's capacity mechanics stay testable without touching Adam's slots. |
| Proposed task | `approval_state = 'proposed'`. Never claimed by the worker, never counted. |
| Approved / scheduled | `approval_state = 'approved'` (+ `approved_at`). The only state the worker claims. Counts once accepted. |
| Superseded | `approval_state = 'superseded'`, `status = 'cancelled'`, `metadata.superseded_by`. History kept. |
| Batch | `batch_id` groups the tasks of one plan. |

Existing rows default to `approved`, so no history is rewritten.

## Approval is code-enforced

`assessTaskApproval` (policy.ts) reads Adam's own message: "give me ideas / what should the first 20 be" proposes. "I approve those, execute them / schedule these / proceed" approves. `jarvis.create_tasks` creates **proposed** tasks unless the message approved execution, and `jarvis.approve_tasks` refuses without that approval. The model cannot approve on its own.

## Replacing a plan

"I have a new prompt instead of the previous plan" (`assessBatchReplacement`) enables `jarvis.supersede_batch`: the previous proposed batch is superseded (nothing was approved, no slots used). Approved tasks are superseded only while untouched (queued/validating, no lease, branch, PR or commit). Anything already in progress is returned as `needs_decision` and is never cancelled silently. Old and new batches are never both counted.

## Opportunity Radar

Radar discoveries are inserted as **proposed** unless they are fixtures or high-confidence read-only diagnostics (confidence ≥ 0.8) that safe-autonomy policy already lets run. Low-confidence findings cannot consume production slots.

## Day boundary

Capacity is per Eastern `session_date`. At midnight Eastern a new session starts at 0 / 50; older tasks stay in their old sessions.

## Run 2 validation history

The Run 2 50-task load test, repair-loop and capability-gap fixtures remain in the ledger (`is_fixture = true`, `metadata.classified_as = 'validation_fixture'`). The three 2026-10-06 validation sessions keep `metadata.validation_accepted_count` (42 / 3 / 5) and show `accepted_count = 0` production tasks. The status panel reports them as "Validation fixtures: historical only".
