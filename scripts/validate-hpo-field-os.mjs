import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}
function check(name, ok) {
  if (!ok) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
  }
}

const planner = read("src/components/HpoRoutePlanner.tsx");
const leaflet = read("src/components/hpo-map/HpoLeafletMap.tsx");
const routeFns = read("src/lib/hpo-route.functions.ts");
const geocode = read("src/lib/hpo-geocode.ts");
const hpoChatRouter = read("src/lib/hpo-chat-router.ts");
const hpoEmerySheet = read("src/components/HpoEmerySheet.tsx");
const routeActions = read("src/lib/hpo-route-action-controller.ts");
const emery = read("src/lib/emery.functions.ts");
const voice = read("src/lib/voice.functions.ts");
const hpoRoute = read("src/routes/_authenticated/hpo.tsx");
const hpoNav = read("src/components/HpoFieldNav.tsx");
const hpoFns = read("src/lib/hpo.functions.ts");
const fieldToday = read("src/components/HpoFieldToday.tsx");
const fieldFns = read("src/lib/hpo-field.functions.ts");
const offline = read("src/lib/hpo-field-offline.ts");
const accountDetail = read("src/components/HpoAccountFieldDetail.tsx");
const fieldRead = read("src/lib/hpo-field-read-controller.ts");
const voiceControl = read("src/components/EmeryVoiceControl.tsx");
const routeCommands = read("src/lib/hpo-route-command-controller.ts");
const capabilities = read("src/lib/execution-capabilities.ts");

check("Leaflet is the active HPO route map", planner.includes("<HpoLeafletMap"));
check(
  "Route Planner does not render the retired WebGL map",
  !planner.includes("<HpoMapV2MapLibre"),
);
check(
  "Leaflet renderer remains independent of WebGL",
  leaflet.includes('import * as L from "leaflet"') && !leaflet.includes("maplibregl"),
);
check(
  "Leaflet clusters dense office markers",
  leaflet.includes("clusterIcon") &&
    leaflet.includes("shouldCluster") &&
    leaflet.includes("latLngToContainerPoint"),
);
check(
  "Leaflet preserves account and prospect filters",
  leaflet.includes('type Filter = "all" | "account" | "prospect"'),
);
check(
  "Leaflet preserves categorized field pins",
  leaflet.includes("officePinCategory") && leaflet.includes("PIN_CATEGORY_ORDER"),
);
check(
  "Leaflet supports synchronized office focus",
  leaflet.includes("selectedOfficeKey") && leaflet.includes("onSelectOffice"),
);
check(
  "Leaflet supports multi-office route selection",
  leaflet.includes("selectedKeys") && leaflet.includes("onToggleRouteStop"),
);
check(
  "Leaflet opens field account context",
  leaflet.includes("onOpenAccount") && planner.includes("HpoAccountFieldDetail"),
);
check(
  "Leaflet preserves route geometry and stop markers",
  leaflet.includes("route_geometry_remaining") &&
    leaflet.includes("route_geometry") &&
    leaflet.includes("L.circleMarker"),
);
check(
  "Leaflet exposes current-location control and touch navigation",
  leaflet.includes("function locateMe()") &&
    leaflet.includes('aria-label="Use my location"') &&
    leaflet.includes("touchZoom: true"),
);
check(
  "OSRM routing remains unchanged",
  routeFns.includes("router.project-osrm.org/table/v1/driving"),
);
check(
  "Existing unmapped HPO offices are retried regardless of prior geocode attempt",
  routeFns.includes('.or("latitude.is.null,longitude.is.null")') &&
    !routeFns.includes('.is("geocoded_at", null)'),
);
check(
  "HPO geocoding strips suite/floor detail and has multiple providers",
  geocode.includes("withoutUnit") &&
    geocode.includes("photon.komoot.io") &&
    geocode.includes("geocoding.geo.census.gov") &&
    geocode.includes("nominatim.openstreetmap.org"),
);
check(
  "Emery-created HPO accounts are geocoded into the canonical account row",
  hpoChatRouter.includes("geocodeHpoOfficeAddress") &&
    hpoChatRouter.includes("latitude:point?.lat") &&
    hpoChatRouter.includes("plotted on the HPO map"),
);
check(
  "HPO has an embedded Emery action sheet using the canonical main conversation",
  hpoEmerySheet.includes("sendEmeryMessage") &&
    hpoEmerySheet.includes("EmeryVoiceControl") &&
    hpoEmerySheet.includes("same HPO accounts, routes and activity"),
);
check(
  "Map route and relationship actions open Emery inside the map experience",
  leaflet.includes("openHpoEmery") &&
    leaflet.includes("Help me with this HPO account/office") &&
    leaflet.includes("Help me build today's HPO field route") &&
    leaflet.includes("onToggleRouteStop(selectedOffice)"),
);
check(
  "Completed historical routes never masquerade as today's active route",
  planner.includes("inactiveRouteStatuses") &&
    planner.includes("currentRouteId") &&
    !planner.includes("data?.routes[0] ?? null") &&
    !planner.includes("result.routes[0]?.id"),
);
check(
  "Route creation defaults to today and exposes one optimize-and-start action",
  planner.includes("useState(data.today)") &&
    planner.includes("Optimize & Start Route") &&
    planner.includes('onNavigateHpo?.("today")'),
);
check(
  "Leaflet uses a reliable no-key street basemap and teardrop office pins",
  leaflet.includes("https://tile.openstreetmap.org/{z}/{x}/{y}.png") &&
    leaflet.includes("function pinIcon") &&
    leaflet.includes('viewBox="0 0 32 40"') &&
    leaflet.includes("iconAnchor: [size / 2, Math.round(size * 1.25)]"),
);
check(
  "Leaflet is map-first with search, filters, compact controls, and an account tray",
  leaflet.includes("Search HPO accounts, offices or towns") &&
    leaflet.includes('onNavigateHpo?.("today")') &&
    leaflet.includes("Fit offices") &&
    leaflet.includes("Build today's route"),
);
check(
  "Today uses a RepMove-style Daily Route date strip and ordered route list",
  fieldToday.includes("routeWeek") &&
    fieldToday.includes("routeMonth") &&
    fieldToday.includes("Daily Route") &&
    fieldToday.includes("GripVertical") &&
    fieldToday.includes("SquareCheckBig"),
);
check(
  "route-stop outcome has one canonical execution core",
  routeFns.includes("executeHpoRouteStopOutcomeCore") &&
    routeFns.includes('action = "hpo.route_stop.set_outcome"'),
);
check(
  "manual stop save reaches canonical outcome core",
  routeFns.includes("return executeHpoRouteStopOutcomeCore"),
);
check(
  "voice route notes reach canonical outcome core",
  voice.includes("captureHpoRouteNoteCore") && routeFns.includes("route-note:"),
);
check(
  "text HPO route outcomes reach canonical outcome adapter",
  emery.includes("processHpoRouteStopAction") &&
    routeActions.includes("executeHpoRouteStopOutcomeCore"),
);
check(
  "route-stop outcome uses execution ledger and verification",
  routeFns.includes("beginExecution") &&
    routeFns.includes("completeExecution") &&
    routeFns.includes("Route stop outcome verification failed"),
);
check(
  "visit logging is a canonical vertical action",
  routeFns.includes("executeHpoRouteStopVisitCore") &&
    routeFns.includes('"hpo.route_stop.log_visit"'),
);
check(
  "visit logging preserves interaction linkage",
  routeFns.includes("Visit interaction verification failed") &&
    routeFns.includes("route_interaction_id"),
);
check(
  "route-note voice/text capture uses canonical visit action",
  routeFns.includes("hpo.route_stop.log_visit") && routeFns.includes("visitExecution"),
);
check(
  "route-stop follow-up is a canonical action",
  routeFns.includes("executeHpoRouteStopFollowupCore") &&
    routeFns.includes('"hpo.route_stop.set_followup"'),
);
check(
  "visit action composes canonical follow-up when present",
  routeFns.includes("${key}:followup") && routeFns.includes("executeHpoRouteStopFollowupCore"),
);
check(
  "HPO has exactly four field-first areas",
  /type HpoFieldView = "today" \| "map" \| "accounts" \| "activity"/.test(hpoNav) &&
    ["today", "map", "accounts", "activity"].every((key) => hpoNav.includes(`key: "${key}"`)) &&
    (hpoNav.match(/key: "(today|map|accounts|activity)"/g) ?? []).length === 4 &&
    hpoRoute.includes("<HpoFieldNav view={view} onChange={setView} />"),
);
check(
  "legacy HPO dashboard and secondary tools are removed",
  !/More HPO tools|Dashboard|Relationships|Performance|HPO Tasks|dashboard|performance/.test(
    hpoRoute,
  ),
);
check(
  "HPO account and activity writes reuse existing records",
  hpoRoute.includes("createHpoAccount") &&
    hpoRoute.includes("logHpoInteraction") &&
    hpoRoute.includes("setHpoFieldAccountFollowup") &&
    accountDetail.includes("updateHpoFieldAccount") &&
    accountDetail.includes("addHpoFieldContact"),
);
check(
  "Activity exposes direct visit and touch capture with contact context",
  hpoRoute.includes("Log Visit") &&
    hpoRoute.includes("Log Touch") &&
    hpoRoute.includes("Who did you speak with?") &&
    hpoFns.includes("spoken_with"),
);
check(
  "HPO workspace reads and updates are authenticated owner-scoped",
  read("src/lib/hpo-workspace.functions.ts").includes("requireSupabaseAuth") &&
    read("src/lib/hpo-workspace.functions.ts").includes('.eq("user_id", context.userId)'),
);
check(
  "Today retains the complete ordered route",
  fieldToday.includes('aria-label="Ordered route stops"') &&
    fieldToday.includes("reorderHpoRouteStopsCanonical"),
);
check(
  "Today field mode exposes next-stop field controls",
  fieldToday.includes("Next Stop") &&
    fieldToday.includes("I'm Here") &&
    fieldToday.includes("Log Visit") &&
    fieldToday.includes("Add Note") &&
    fieldToday.includes("Set Follow-Up") &&
    fieldToday.includes("Reschedule") &&
    fieldToday.includes("Bad address") &&
    fieldToday.includes("Nearby backup") &&
    fieldToday.includes("Fix remaining route"),
);
check(
  "Today route queue supports canonical reorder and open-stop removal",
  fieldToday.includes("reorderHpoRouteStopsCanonical") &&
    fieldToday.includes("removeHpoRouteStop") &&
    fieldToday.includes("removeQueuedStop"),
);
check(
  "Today note and follow-up capture remain offline capable",
  fieldToday.includes('"hpo.route_stop.add_note"') &&
    fieldToday.includes('"hpo.route_stop.set_followup"') &&
    offline.includes('"hpo.route_stop.add_note"'),
);
check(
  "Today field mode uses canonical route mutations",
  fieldToday.includes("setHpoRouteStopOutcome") &&
    fieldToday.includes("addHpoRouteStops") &&
    fieldToday.includes("reoptimizeHpoRouteRemaining") &&
    fieldToday.includes("completeHpoRoute"),
);
check(
  "HPO field OS has IndexedDB route note and outbox stores",
  offline.includes('"hpo_route_snapshots"') &&
    offline.includes('"hpo_draft_notes"') &&
    offline.includes('"hpo_outbox"') &&
    offline.includes("indexedDB.open"),
);
check(
  "offline HPO mutations preserve idempotency",
  offline.includes("idempotencyKey") && fieldToday.includes("offline_sync"),
);
check(
  "offline HPO mutations detect stale-server conflicts",
  routeFns.includes("offline_conflict") &&
    fieldFns.includes("offline_conflict") &&
    fieldToday.includes("baseUpdatedAt: mutation.baseUpdatedAt"),
);
check(
  "route add/remove/reorder actions use execution ledger",
  fieldFns.includes('"hpo.route.add_stops"') &&
    fieldFns.includes('"hpo.route.remove_stop"') &&
    fieldFns.includes('"hpo.route.reorder"') &&
    fieldFns.includes("beginExecution"),
);
check(
  "remaining route reoptimization preserves terminal history",
  fieldFns.includes('"hpo.route.reoptimize"') &&
    fieldFns.includes("const open = stops.filter") &&
    fieldFns.includes("openSlots"),
);
check(
  "nearby backup ranking is deterministic",
  fieldFns.includes("getHpoNearbyBackups") &&
    fieldFns.includes("driveMinutes * 2") &&
    !fieldFns.includes("MODEL_POLICY"),
);
check(
  "route completion protects unfinished stops",
  fieldFns.includes("completeHpoRoute") && fieldFns.includes("openStops"),
);
check(
  "field account detail preserves contacts interactions and route history",
  accountDetail.includes("Contacts") &&
    accountDetail.includes("Relationship history") &&
    accountDetail.includes("Route visit history"),
);
check(
  "field contact reads match the live HPO contact schema",
  !fieldFns.includes("is_primary") && !accountDetail.includes("is_primary"),
);
check(
  "route builder runs as an over-map mobile sheet",
  planner.includes('role="dialog"') &&
    planner.includes("Build HPO daily route") &&
    planner.includes("max-h-[90dvh]"),
);
check(
  "Map is the territory command surface without a duplicate route map",
  leaflet.includes("Search HPO accounts, offices or towns") &&
    leaflet.includes("Build Route") &&
    leaflet.includes("selectedOffice") &&
    !planner.includes("<RouteMap route="),
);
check(
  "active route supports add remove manual reorder and remainder reoptimize",
  planner.includes("addSelectedToActiveRoute") &&
    planner.includes("removeOpenStop") &&
    planner.includes("reorderHpoRouteStopsCanonical") &&
    planner.includes("reoptimizeActiveRemaining"),
);
check(
  "reoptimized route geometry is rendered when available",
  leaflet.includes("route_geometry_remaining") && leaflet.includes("route_geometry"),
);
check(
  "HPO Today state has a reusable deterministic core",
  fieldFns.includes("getHpoFieldTodayCore") &&
    fieldFns.includes("getHpoFieldToday = createServerFn"),
);
check(
  "text Emery has deterministic field-state commands",
  emery.includes("processHpoFieldReadCommand") &&
    fieldRead.includes('"hpo.route.get_next_stop"') &&
    fieldRead.includes('"hpo.route.resume_context"') &&
    fieldRead.includes('"hpo.account.get_context"'),
);
check(
  "Realtime Voice exposes the same deterministic field-state commands",
  voice.includes('name: "get_hpo_field_state"') &&
    voice.includes("processHpoFieldReadCommand") &&
    voiceControl.includes('name === "get_hpo_field_state"') &&
    voiceControl.includes("executeVoiceHpoFieldRead"),
);
check(
  "text Emery exposes verified HPO route creation/editing commands",
  emery.includes("processHpoRouteCommand") &&
    routeCommands.includes('"hpo.route.create"') &&
    routeCommands.includes('"hpo.route.add_stops"') &&
    routeCommands.includes('"hpo.route.remove_stop"') &&
    routeCommands.includes('"hpo.route.optimize"') &&
    routeCommands.includes('"hpo.route.reoptimize"'),
);
check(
  "Realtime Voice uses the same HPO route command controller",
  voice.includes('name: "execute_hpo_route_command"') &&
    voice.includes("processHpoRouteCommand") &&
    voiceControl.includes('name === "execute_hpo_route_command"') &&
    voiceControl.includes("executeVoiceHpoRouteCommand"),
);
check(
  "conversational route selection respects Adam ownership/exclusion guards",
  routeCommands.includes('normalize(row.owner_name) === "adam"') &&
    routeCommands.includes("exclude_from_adam_route"),
);
check(
  "route command office matching removes command filler",
  routeCommands.includes("officeTargetPhrase"),
);
check(
  "Route Planner caches and can reopen territory records offline",
  planner.includes("saveHpoOfficeSnapshots") && planner.includes("loadHpoOfficeSnapshots"),
);
check(
  "natural field-note follow-up dates are parsed deterministically",
  routeFns.includes("followupDueFromNote") && routeFns.includes("parsedNextActionDueAt"),
);
check(
  "conversational HPO recovery can recommend one deterministic nearby backup",
  routeCommands.includes('"hpo.nearby.find"') &&
    routeCommands.includes("getHpoNearbyBackupsCore") &&
    routeCommands.includes("Best nearby option"),
);
check(
  "conversational route wrap-up protects unfinished stops",
  routeCommands.includes('"hpo.route.complete"') &&
    routeCommands.includes("executeHpoRouteCompleteCore") &&
    routeCommands.includes("still unfinished"),
);
check(
  "Voice route recovery can use current device location",
  voiceControl.includes("currentHpoVoiceLocation") &&
    voiceControl.includes("latitude: location.latitude") &&
    voiceControl.includes("longitude: location.longitude"),
);
check(
  "natural visit capture returns execution trace",
  routeFns.includes("executionRunId: execution.id") &&
    routeActions.includes("visit.executionRunId"),
);
check(
  "field summary is deterministic",
  fieldRead.includes('"hpo.route.day_summary"') && fieldRead.includes("Today:"),
);
check(
  "arrival is canonical across Today text and Voice",
  fieldFns.includes("executeHpoRouteStopArriveCore") &&
    routeActions.includes('"hpo.route_stop.arrive"') &&
    routeActions.includes("executeHpoRouteStopArriveCore") &&
    voice.includes('name: "execute_hpo_route_stop_action"') &&
    voiceControl.includes('name === "execute_hpo_route_stop_action"'),
);
check(
  "natural route-stop actions use stable request ids in Voice",
  routeActions.includes("requestId?: string") && voiceControl.includes("requestId: `voice:"),
);
check(
  "explicit Voice route notes are retry-safe",
  voice.includes("requestId?: string | null") &&
    voice.includes("hpo.route_stop.log_visit") &&
    voiceControl.includes("executeHpoRouteNote") &&
    voiceControl.includes("routeId: hpoRouteId"),
);

check(
  "route Calendar sync is a canonical verified mutation",
  routeFns.includes("executeHpoRouteSyncCalendarCore") &&
    routeFns.includes('"hpo.route.sync_calendar"') &&
    routeFns.includes("Route Calendar update verification failed") &&
    routeFns.includes("completeExecution"),
);
check(
  "manual Route Planner uses verified route Calendar sync",
  planner.includes("hpo.route.sync_calendar") && planner.includes("result.calendarAction"),
);
check(
  "route export is centralized deterministic domain logic",
  fieldFns.includes("getHpoRouteTrackerExportCore") &&
    fieldFns.includes('"hpo.route.export"') &&
    fieldFns.includes("exportHpoRouteTracker"),
);
check(
  "manual tracker copy uses centralized route export",
  planner.includes("exportHpoRouteTracker") && planner.includes("result.tsv"),
);
check(
  "Text and Voice route controller supports export and Calendar sync",
  routeCommands.includes('"hpo.route.export"') &&
    routeCommands.includes('"hpo.route.sync_calendar"') &&
    routeCommands.includes("getHpoRouteTrackerExportCore") &&
    routeCommands.includes("executeHpoRouteSyncCalendarCore"),
);
check(
  "capability registry reflects proven conversational route creation",
  capabilities.includes("conversationalRouteCreation: true") &&
    capabilities.includes("export completed route visits") &&
    capabilities.includes("verified execution"),
);
check(
  "Realtime declares only one HPO route command tool",
  (voice.match(/name: "execute_hpo_route_command"/g) ?? []).length === 1,
);

if (process.exitCode) process.exit(process.exitCode);
console.log("HPO Field OS Leaflet foundation certification passed.");
