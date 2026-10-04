# Emery command-center visual redesign

## Direction
One Emery product, one dark navy command-center language. Keep the blue neural-brain identity and make Voice feel central while the ongoing conversation remains the primary workspace. HPO uses that same language as a focused field-sales surface, not a second app. This is a presentation plan only; no code, data, or migrations are changed by this plan.

## 1. Visual system
- Deep near-black/navy canvas, restrained cobalt as the primary action/status color, cyan reserved for live Voice and precise highlights; neutral ink and high-contrast text prevent an all-blue screen. Use a faint architectural grid/HUD line treatment only at the edges, never behind dense reading areas.
- Define semantic canvas, raised surface, glass, border, text, muted text, accent, focus, destructive, and Voice-state tokens; keep the existing theme-variable approach instead of scattering literal colors through screens. Use the existing neural-brain artwork as the focal presence rather than replacing the brand with a new orb.
- Restrained metal/glass depth, thin borders, compact radii, crisp type, ample reading line-height, and a consistent spacing scale. Motion should communicate listening/thinking/speaking without theatrical effects; static alternatives and reduced-motion support are required.

## 2. Desktop Chat
- A stable command-center frame: existing Emery navigation at left; dominant, comfortably narrow conversation in the center; optional compact context/next-action rail at right when width allows. Context is glanceable and subordinate, never a competing dashboard.
- An integrated neural presence near the conversation header shows Emery’s available/active Voice state using only actual existing status, not invented activity. Preserve message history, attachments, older-message paging, scroll position, send flow, and route handoff.
- Anchor a premium composer to the conversation column, with file, Voice, and send controls and clear error/approval states. Avoid introducing another chat or memory store.

## 3. iPhone Chat
- One primary surface: conversation first, a compact neural/Voice presence, context collapsed on demand, and a fixed composer above the existing bottom navigation and safe area. Keep Voice within thumb reach rather than shrinking a desktop rail onto the phone.
- Preserve 16px input text, IME behavior, scroll restoration, usable keyboard clearance, 44px+ controls, accessible labels and state announcements. Listening/thinking/speaking transitions should be visible but not obscure messages.

## 4. HPO field workspace
- Retain the current four areas and their exact labels: **Planner, Maps, Accounts, Activity**. The single persistent HPO navigation stays above all four views; the global app navigation remains separate.
- **Planner:** emphasize selected day, saved-route progress, next actionable stop, compact ordered office rows, and existing visit/note/follow-up and Emery actions. Never recast a completed route as active or hide its history.
- **Maps:** visually frame the current Leaflet surface with coordinated search, controls, selection, and route tray; reserve the map’s remaining height and avoid overlay collisions. No engine, pin, gesture, route-state, or routing change.
- **Accounts:** dense but readable relationship intelligence: attention/status, last touch, next action, contacts, histories, and existing Quick Note/detail-sheet actions; keep search and filters immediately available.
- **Activity:** chronological, legible mission-log styling for existing office visits, lunches, dinners/events, recaps, and follow-ups, preserving filters and pagination. On iPhone, show one field surface at a time; desktop may use restrained supporting panels without duplicating actions.

## 5. Likely presentation files
- Shared tokens and surfaces: `src/styles.css`, `src/blue-theme.css`, `src/components/hpo-accounts.css`. Check the current stylesheet load order before changing tokens.
- Chat and shared frame: `src/routes/_authenticated/chat.tsx`, `src/components/OperatingContextCard.tsx`, `src/components/AppShell.tsx` (visual framing only; preserve links, handoff, viewport ownership, and bottom navigation), `src/components/EmeryVoiceControl.tsx` (visible state styling only).
- HPO presentation: `src/routes/_authenticated/hpo.tsx`, `src/components/HpoFieldNav.tsx`, `src/components/HpoWeeklyPlanner.tsx`, `src/components/HpoRoutePlanner.tsx` (presentation JSX only), `src/components/HpoAccountFieldDetail.tsx`, `src/components/HpoActivityView.tsx`, and `src/components/HpoEmerySheet.tsx` only where its visible sheet needs to match. Keep Leaflet implementation untouched.

## 6. Protected boundaries
- No Supabase schema, migrations, production record writes, new CRM/memory/chat system, or MapLibre. Leave canonical HPO reads/writes, route optimization/persistence, completed history, Field Session, receipts/idempotency/undo, offline behavior, and action controllers unchanged.
- Preserve Voice connection/transcription/action behavior, Chat send/history and Smart Memory/Ambient Context, account notes and contacts, existing auth, navigation destinations, and non-HPO workflows. Do not replace `src/components/hpo-map/HpoLeafletMap.tsx` or change Leaflet behavior. Keep the HPO map height/tray contract intact.

## 7. Safe implementation order
1. Reconcile the Lovable checkout with the intended Phase 1–8 GitHub snapshot before implementing. The inspected checkout currently exposes Planner/Maps/Accounts/Activity, and its latest preview diagnostics report TypeScript errors in `emery.functions.ts` and `hpo-route-command-controller.ts`; do not attribute those to the redesign or claim a working authenticated preview. Re-audit presentation files after the branch lands.
2. Capture authenticated desktop/iPhone baselines if access is available; inventory Voice states, chat scroll/composer, HPO route states, map overlays, and account sheets. Confirm token cascade and contrast before styling.
3. Establish shared tokens and restrained visual primitives, then adapt the Chat shell/conversation/Voice/composer while preserving behavior.
4. Apply the same system to the HPO frame/nav, then Planner, Maps framing, Accounts/detail, and Activity in small reviewable slices. Avoid edits to service/controller code.
5. Validate each slice at desktop and 320/375/390/430px, including keyboard/safe areas, map resize and tray clearance, navigation, completed-route history, Voice states, accessibility/reduced motion, typecheck, HPO validator, focused lint, and newest preview diagnostics. Report authentication/device limitations rather than marking inaccessible flows verified.

## Technical scope note
This plan assumes visual-only changes. If the incoming GitHub work changes UI boundaries or Voice-state exposure, revise the file list before coding rather than porting old markup blindly. Existing baseline build errors are separate work; do not silently broaden the visual redesign into a functionality rewrite.
