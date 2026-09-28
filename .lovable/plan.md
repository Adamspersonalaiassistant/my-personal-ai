# HPO Field-Sales Rebuild

## Goal
Replace the dashboard-centric HPO workspace with a focused, iPhone-first field-sales operating system inside Emery. Existing HPO records, route history, account/contact data, visit logs, offline queue, maps, optimization, and Emery command capabilities remain intact.

## Experience
- Make HPO open to **Today** when a current route exists; otherwise open to **Map**.
- Replace Dashboard, Relationships, Performance, Events, Tasks, and “More HPO tools” with four persistent HPO destinations: **Today, Map, Accounts, Activity**.
- Keep the global Emery shell and bottom navigation unchanged.
- Use compact professional rows, restrained surfaces, 44px touch targets, safe-area-aware sheets, readable addresses, and deliberate loading/error/offline states.

## Build
1. **HPO workspace shell**
   - Rebuild the HPO route as a thin field-workspace controller with four tabs and shared actions.
   - Preserve view state during the session and route account/visit actions into focused sheets.
   - Remove the old dashboard and secondary-tool architecture from the HPO experience.

2. **Today**
   - Reuse the existing active-route, next-stop, navigation, arrival, outcome, visit-note, follow-up, nearby-backup, reoptimization, offline-draft, offline-sync, and route-wrap logic.
   - Recompose it into a faster field sequence: route status → next stop → primary actions → account brief → route queue.

3. **Map and route planning**
   - Reuse the existing MapLibre/fallback map, account/prospect pins, location, filters, multi-select, route creation, optimization, route reopening, stop addition/removal, and manual reorder.
   - Reorganize the current oversized route planner into map-first controls with route details shown only when selected.

4. **Accounts**
   - Build a compact searchable/filterable list for account type, relationship stage/health, city/territory, and priority using existing fields.
   - Expand the account sheet to show contacts, relationship signals, opportunity/blockers, next action, interaction history, and route history.
   - Keep add-account and quick-log-touch workflows; add editing only through existing owned-account fields and policies.

5. **Activity**
   - Build a chronological stream from existing HPO interactions and upcoming HPO meetings, with compact filtering and quick logging.
   - Surface due follow-ups and relationship actions without creating another task system or dashboard.

6. **Architecture and validation**
   - Split HPO-only UI into focused components while keeping server functions authenticated and user-scoped.
   - Record the new HPO module architecture in `AGENTS.md`; update `roadmap.md` for this multi-part rebuild.
   - Run focused HPO tests/lint, TypeScript validation, and inspect mobile and desktop rendering with Playwright.
   - Verify the old dashboard is gone and exercise map selection, route opening/reorder surfaces, Today visit actions, account detail, and activity logging where the available authenticated preview permits.

## Technical boundaries
- No schema migration, data reset, or new backend service is planned.
- Existing Supabase HPO tables and RLS remain authoritative.
- Shared Emery chat, Calendar, More, authentication, branding, and global navigation remain unchanged.
- Physical iPhone/Safari checks will be reported separately when unavailable in the preview environment.
