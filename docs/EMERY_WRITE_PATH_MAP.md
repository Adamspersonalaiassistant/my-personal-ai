# Emery current write-path map

Snapshot: 2026-09-27. Verified against GitHub main and the live Supabase schema before the first canonical execution-kernel vertical slice.

## Task writes

| Channel | Entry point | Current write path before kernel migration | Drift |
| --- | --- | --- | --- |
| Main text Emery | `sendEmeryMessage` in `src/lib/emery.functions.ts` | `processCalendarAction` → task RPCs | Uses Calendar controller + execution ledger |
| Realtime Voice | `EmeryVoiceControl` → `executeVoiceCalendarAction` | `processCalendarAction` → same task RPCs | Shared parser, but Voice did not pass a stable server idempotency key/source message |
| Capture route | `/capture` | calls the same `sendEmeryMessage` path | Already shares Text path |
| Direct iPhone Shortcut edge function | `supabase/functions/emery-shortcut/index.ts` | independent LLM parser → `emery_action_create_task_v2` and other RPCs | Duplicate orchestration path |
| Calendar UI | `/calendar` → `createLinkedTask` | direct `tasks.insert` | Bypasses execution ledger |
| Legacy server helper | `createTask` in `src/lib/emery.functions.ts` | direct `tasks.insert` | Bypasses execution ledger |

Existing task mutation paths after create include:
- `calendar-agent.ts` → `emery_action_complete_task`
- `calendar-agent.ts` → `emery_action_schedule_task_v2`
- `calendar-agent.ts` → `emery_action_unschedule_task`
- `calendar-agent.ts` → `emery_action_set_task_deadline`
- `os.functions.ts` direct task scheduling/unscheduling updates from UI
- direct task completion helpers in app code

These remain migration targets after the task.create vertical slice is proven.

## Calendar writes

Text/Voice:
- `processCalendarAction` → `emery_action_create_event`
- `processCalendarAction` → `emery_action_reschedule_event`
- event reminder upserts into `app_notifications`

UI:
- `createLinkedMeeting` directly inserts `meetings`
- `rescheduleMeeting` directly updates `meetings`

HPO Route Planner:
- route creation can directly insert a Calendar `meetings` row
- `syncHpoRouteToCalendar` directly creates/updates the route Calendar event

Shortcut:
- independent action parser calls Calendar RPCs directly

## Notification writes

- Calendar controller can insert/upsert `app_notifications`
- task reminder trigger creates/cancels task reminder notifications from `tasks.reminder_at`
- Calendar UI can mark notification rows delivered/read/dismissed
- push subscription UI directly upserts/deletes `push_subscriptions`
- background push dispatch is separate from notification creation

Important semantic distinction: provider acceptance / a `delivered` application state is not proof that a physical iPhone displayed a notification.

## HPO relationship writes

Text Emery:
- `processHpoAction` → canonical HPO relationship RPC/controller path with execution ledger

Realtime Voice:
- `executeVoiceHpoAction` → `processHpoAction`

Direct HPO UI:
- `createHpoAccount` directly inserts `hpo_accounts`
- `logHpoInteraction` directly inserts `hpo_interactions` and updates `hpo_accounts`
- import staging directly writes `hpo_data_imports`

Agents:
- current specialist agents write their own agent/thread/message records but do not have general external/task/calendar write authority.

## HPO route writes

Direct Route Planner functions currently own:
- route creation → `hpo_route_plans` + `hpo_route_stops`
- office/prospect geocode updates
- route optimization → stop order/distance/duration + route optimization metadata
- stop status and note updates
- route plan status updates
- route Calendar synchronization

Route-note chain:
`captureHpoRouteNoteCore`
→ update `hpo_route_stops`
→ `upsertInteractionForStop`
→ insert/update `hpo_interactions`
→ update `hpo_accounts.last_touch_at/next_action/next_action_due_at`
→ update route status
→ execution receipt

This chain must remain intact when it later moves behind the full kernel.

## Current duplication conclusion

The most important confirmed duplication for the first slice is task creation:
1. Text/Voice Calendar controller
2. Shortcut Edge Function
3. Calendar UI direct insert
4. legacy server direct insert

The first kernel migration therefore standardizes **task.create** only. No other working behavior is being redesigned in this slice.


## Phase 1 task.create vertical-slice result

Implemented on 2026-09-27:

- Canonical database function: `public.emery_kernel_task_create`
- Shared TypeScript adapter: `src/lib/execution-kernel.ts`
- Main Text Emery task.create uses the shared adapter.
- `/capture` inherits the same main Text Emery path.
- Realtime Voice passes a stable `session + tool call_id` idempotency key into the same Calendar controller and task.create kernel.
- Calendar UI task creation uses the shared adapter and preserves one client request id across retry.
- Direct iPhone Shortcut task creation calls the same canonical database function and carries an execution-run receipt.
- Legacy server-side `createTask` no longer directly inserts into `tasks`.

Live database acceptance proof:
1. A temporary task-create request created exactly one task and one completed execution run.
2. Repeating the same request with the same idempotency key returned the same task/run with `reused=true`.
3. The completed run's `target_id` matched the persisted task id.
4. Temporary acceptance records were deleted after verification.

Current maturity statement:
**task.create kernel proven at the database layer; production channel/user acceptance is still pending.**
The broader execution architecture remains **built · proving** until migrated actions accumulate real retained production receipts.
