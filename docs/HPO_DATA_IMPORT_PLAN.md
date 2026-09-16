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

## Staging first, then promotion

Large imports should enter `hpo_data_imports` as an import batch and `hpo_import_rows` as raw/normalized staging rows before becoming live account, contact, interaction, route or metric records. Each staged row keeps its raw source, normalized candidate, entity type, dedupe key, status, target record and any validation issue.

This gives Emery a reversible workflow:

1. Preserve the original source.
2. Normalize only what the source actually supports.
3. Compute or accept a stable dedupe key when confidence is high.
4. Match against existing HPO records.
5. Flag ambiguous rows instead of guessing.
6. Promote validated rows into live HPO tables.
7. Keep the import batch as provenance so a bad import can be traced or corrected.

Never silently merge similar-looking offices, contacts or interactions merely because their names are close.

## Account record

Required: account/office name.

Useful first-class fields: account type, specialty/category, territory, city, full address, priority, owner/marketer, relationship stage, relationship health, active status, opportunity, blockers, tags, source/origin, source reference, dedupe key, durable relationship notes, last touch, next interaction, next relationship action, next-action due date.

Relationship stages may include prospect, warming, active, strong, at-risk/cold, reactivation and blocked/exception when supported by Adam's data. Do not invent a stage simply to fill a field.

## Contacts

Contacts belong to an account. Store only business contact details Adam intentionally provides: name, business role/title, phone/email, preferred contact method, relationship notes, source provenance and an optional dedupe key. Avoid personal/sensitive information that is not needed for the professional relationship.

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
  "hpo_account_id": "<uuid when applicable>",
  "hpo_account_name": "<name when useful>"
}
```

The HPO dashboard can then surface those tasks while the Tasks tab remains Adam's global task list.

## Meetings / lunches / dinners / events

Keep them in Emery's existing Meetings system and add HPO metadata when work-related. They appear contextually in HPO even though Meetings is not a primary bottom-nav tab.

## Aggregate performance data

Metrics may be global or account-linked and should be tied to a period. Supported signals include referral count, Entered Care, Progressing, Blocked/Exception and Relationship Impact. Do not attach identifiable patient details to these metrics.

## Routes

Route plans contain route date, area, status, optional time windows and notes. Route stops link to verified HPO accounts whenever possible and preserve order, priority, planned/visited status and field notes. Route Agent should use verified addresses; it should never invent an address to complete a route.

## Source provenance and dedupe

Use `source_type`, `source_ref`, `source_origin`, import-batch metadata and dedupe keys to distinguish manual entry, spreadsheet/CSV, ChatGPT marketing history, route history, marketing notes and future connected sources.

A dedupe key should be based on strong identifiers available in the source (for example normalized office + address, or account + business email for a contact). If strong identifiers are missing, leave the dedupe key blank and send the row to review rather than forcing a merge.

Parent/child HPO records are ownership-bound by user in the schema so one user's child row cannot be attached to another user's account or route even if an ID were guessed.

## Chat-to-HPO routing target

The desired interaction is natural language. Example:

> I just left Rubino. The office manager was interested in a lunch next week. Follow up Tuesday.

When the account match is unambiguous, Emery should be able to log a relationship touch, update last-touch state, capture the opportunity and create/propose the appropriate global HPO task under existing permission rules. If the account match is uncertain, Emery asks one question before writing.

## Apple Shortcut / Voice readiness

The final voice/shortcut layer must call the same Emery main conversation and the same action-routing layer. No separate 'voice Emery' identity or duplicate HPO database should be created. Quick Capture can pass a short natural-language payload through `/capture` with optional `context=hpo`, `autosend=1` and a unique token, then let Emery route the information.

Full Emery Voice remains a later layer. The shortcut bridge exists to reduce friction now without creating a second brain.
