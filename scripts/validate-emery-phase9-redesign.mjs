import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const styles = read("src/styles.css");
const blueTheme = read("src/blue-theme.css");
const chat = read("src/routes/_authenticated/chat.tsx");
const conversation = read("src/routes/_authenticated/conversation.tsx");
const shell = read("src/components/AppShell.tsx");
const voice = read("src/components/EmeryVoiceControl.tsx");
const hpo = read("src/routes/_authenticated/hpo.tsx");
const hpoNav = read("src/components/HpoFieldNav.tsx");
const hpoActivity = read("src/components/HpoActivityView.tsx");
const hpoCss = read("src/components/hpo-accounts.css");
const presence = read("src/components/emery-visual/EmeryPresence.tsx");
const brainCore = read("src/components/emery-visual/EmeryBrainCore.tsx");
const brainCanvas = read("src/components/emery-visual/EmeryBrainCanvas.tsx");
const brainRings = read("src/components/emery-visual/EmeryBrainRings.tsx");
const visualTypes = read("src/components/emery-visual/emery-visual.types.ts");
const visualRuntime = read("src/lib/emery/visual-runtime.ts");
const britishVoice = read("docs/EMERY_BRITISH_VOICE_REFERENCE.md");

for (const token of [
  "--background: #04070d",
  "--surface: #08111d",
  "--elevated: #0c1726",
  "--primary: #3b82f6",
  "--live: #22d3ee",
  "--success: #34d399",
  "--warning: #fbbf24",
]) {
  assert(styles.includes(token) || blueTheme.includes(token), `missing Phase 9 design token: ${token}`);
}

assert(styles.includes("prefers-reduced-motion: reduce"), "Phase 9 must preserve reduced-motion support");
assert(styles.includes("prefers-reduced-transparency: reduce"), "Phase 9 must preserve reduced-transparency support");
assert(styles.includes("emery-panel-glass"), "shared Emery panel treatment must exist");
assert(styles.includes("emery-live-glow"), "live intelligence glow utility must exist");

assert(chat.includes('variant="core"'), "Emery home must render the Voice-connected Core presence");
assert(chat.includes("onVisualStateChange={setVoiceState}"), "Emery home must consume real Voice visual state");
assert(conversation.includes("<EmeryPresence"), "Conversation must retain the Emery Core presence");
assert(conversation.includes("onVisualStateChange={setVoiceVisualState}"), "Conversation must consume real Voice visual state");
assert(conversation.includes('setChatVisualState("syncing")') || conversation.includes('selectedFiles.length ? "syncing" : "thinking"'), "Conversation attachment sync must drive truthful Core state");
assert(conversation.includes('setChatVisualState("success")'), "Conversation completion must expose a bounded success state");
assert(conversation.includes("deviceSourceMetadata()"), "Phase 8 device continuity must remain in Conversation");
assert(conversation.includes("sendEmeryMessage"), "Conversation must preserve the canonical Emery send path");
assert(conversation.includes("getMainConversationPage"), "Conversation must preserve the one main conversation history");

assert(voice.includes("visualStateForVoiceStatus"), "Voice must map real Realtime state into the Emery Core");
assert(voice.includes("visualStateForTool"), "Voice tool activity must drive truthful visual states");
assert(voice.includes('name === "search_web"'), "Searching state must be based on real web tool use");
assert(voice.includes('name === "execute_hpo_route_command"'), "Planning state must be based on the real route command path");
assert(voice.includes("executeVoiceHpoRouteStopAction"), "Voice must preserve canonical HPO route-stop actions");
assert(voice.includes("useAmbientContext"), "Ambient context must remain connected");
assert(voice.includes("VOICE_FOLLOW_UP_WINDOW_MS"), "natural Voice follow-up behavior must remain connected");

for (const state of [
  "idle",
  "listening",
  "thinking",
  "remembering",
  "searching",
  "planning",
  "using_tool",
  "executing",
  "syncing",
  "speaking",
  "waiting",
  "success",
  "error",
]) {
  assert(visualTypes.includes(`"${state}"`), `visual state missing: ${state}`);
}
assert(brainCore.includes("EmeryBrainCanvas"), "Emery Core must keep the Canvas neural layer");
assert(brainCore.includes("EmeryBrainRings"), "Emery Core must keep the SVG ring layer");
assert(brainCanvas.includes("requestAnimationFrame"), "Canvas visualization should animate without a second renderer");
assert(brainRings.includes("<svg"), "precise HUD geometry should use SVG");
assert(presence.includes("Connected"), "desktop presence should show a restrained connectivity signal");
assert(visualRuntime.includes('"emery:visual-state"'), "shared visual runtime event channel must remain bounded and presentation-only");
assert(!visualRuntime.toLowerCase().includes("supabase"), "visual runtime must not become a second persistence system");

for (const label of ["Planner", "Maps", "Accounts", "Activity"]) {
  assert(hpoNav.includes(`label: "${label}"`), `HPO nav must preserve ${label}`);
}
assert(!hpoNav.includes("Today"), "HPO nav must not reintroduce the removed Today tab");
assert(hpo.includes("HpoWeeklyPlanner"), "Planner must remain the primary HPO workflow");
assert(hpo.includes("HpoRoutePlanner"), "existing HPO route builder/map workflow must remain");
assert(hpoCss.includes(".leaflet-container"), "HPO visual polish must keep Leaflet");
assert(!hpo.includes("MapLibre"), "Phase 9 must not reintroduce MapLibre");
assert(hpoActivity.includes("CommandPanel"), "HPO Activity should use the shared professional Emery panel language");
assert(hpoActivity.includes("SectionHeading"), "HPO Activity should use the shared information hierarchy");
assert(hpoActivity.includes("Tell Emery what happened"), "HPO Activity recap workflow must remain intact");

assert(shell.includes('to="/chat"') || shell.includes('to: "/chat"'), "App shell must keep Emery as the primary destination");
assert(shell.includes('to="/hpo"') || shell.includes('to: "/hpo"'), "App shell must keep HPO");
assert(shell.includes('to="/calendar"') || shell.includes('to: "/calendar"'), "App shell must keep Calendar");
assert(shell.includes("max-w-[1680px]"), "desktop command center must use available large-screen space");
assert(shell.includes("md:hidden"), "mobile navigation must remain distinct from desktop layout");
assert(shell.includes("md:flex"), "desktop navigation must remain responsive");

assert(britishVoice.includes("original feminine British English voice"), "British Emery voice reference must remain documented");
assert(britishVoice.includes("not an imitation"), "voice target must remain original rather than impersonating a character/actor");

for (const path of [
  "src/lib/emery/context-engine.ts",
  "src/lib/emery/capability-router.ts",
  "src/lib/emery/smart-memory.ts",
  "src/lib/emery/unified-voice-context.ts",
  "src/lib/emery/device-continuity.ts",
  "src/lib/emery/self-improvement.ts",
  "src/components/hpo-map/HpoLeafletMap.tsx",
]) {
  assert(fs.existsSync(new URL(`../${path}`, import.meta.url)), `protected architecture missing: ${path}`);
}

console.log("Emery Phase 9 professional redesign validation passed.");
