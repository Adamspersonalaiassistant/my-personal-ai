# HPO Data Intake Contract

This file defines how Emery should accept Adam's real Hudson Pro work history without redesigning the HPO OS each time a new source arrives.

## Core rule

HPO is a referral-source / relationship / field-sales operating system. It is **not** a patient chart or case-management database. Do not ingest patient names, dates of birth, diagnoses, claim numbers, medical records, attorney-client case details, or other PHI/sensitive case data. Patient-management visibility should be aggregate/non-identifying signals only: Entered Care, Progressing, Blocked/Exception, Relationship Impact.

## Import order

1. Current account master list
2. Contacts and account ownership
3. Existing marketing / visit notes
4. Follow-ups, lunches, dinners and events
5. Route history and current route targets
6. Aggregate referral / sales metrics
7. Useful historical ChatGPT marketing-project notes after review/deduplication

## Account record

Required: account/office name.

Useful fields: account type, specialty/category, territory, city, full address, priority, owner/marketer, relationship stage, active status, source/origin, durable relationship notes, last touch, next relationship action, next-action due date.

Do not automatically merge similarly named accounts without evidence. Preserve source provenance so a bad import can be corrected later.

## Contacts

Contacts belong to an account. Store only business contact details Adam intentionally provides: name, business role/title, phone/email, preferred contact method, relationship notes. Avoid personal/sensitive information that is not needed for the professional relationship.

## Relationship interactions

One record per meaningful touch: office visit, call, text, email, lunch, dinner, event or other interaction.

Capture: account, optional contact, occurred time, concise factual summary, outcome/opportunity, relationship signal, next action, next-action due date, source type/reference.

Emery should infer as little as possible. If the correct account is ambiguous, ask one concise clarification rather than attaching history to the wrong account.

## Global task integration

HPO does not create a second task system. Global Emery tasks remain the source of truth. HPO-linked tasks should carry metadata such as:

```json
{
  "domain": "hpo",
  "hpo": true,
  "hpo_account_id": "<uuid when applicable>"
}
```

The HPO dashboard can then surface those tasks while the Tasks tab remains Adam's global task list.

## Meetings / lunches / dinners / events

Keep them in Emery's existing Meetings system and add HPO metadata when work-related. They appear contextually in HPO even though Meetings is not a primary bottom-nav tab.

## Aggregate performance data

Metrics may be global or account-linked and should be tied to a period. Supported signals include referral count, Entered Care, Progressing, Blocked/Exception and Relationship Impact. Do not attach identifiable patient details to these metrics.

## Routes

Route plans contain route date, area, status, optional time windows and notes. Route stops link to verified HPO accounts whenever possible and preserve order, priority, planned/visited status and field notes. Route Agent should use verified addresses; it should never invent an address to complete a route.

## Supported source provenance

Use `source_type`, `source_ref`, `source_origin`, or import-batch metadata to distinguish manual entry, spreadsheet/CSV, ChatGPT marketing history, route history, marketing notes and future connected sources.

## Chat-to-HPO routing target

The desired interaction is natural language. Example:

> I just left Rubino. The office manager was interested in a lunch next week. Follow up Tuesday.

When the account match is unambiguous, Emery should be able to log a relationship touch, update last-touch state, capture the opportunity and create/propose the appropriate global HPO task under existing permission rules. If the account match is uncertain, Emery asks one question before writing.

## Apple Shortcut / Voice readiness

The final voice/shortcut layer must call the same Emery main conversation and the same action-routing layer. No separate 'voice Emery' identity or duplicate HPO database should be created. Quick Capture should be able to pass a short natural-language payload and optional context (`hpo`) into Emery, then let Emery route the information.
