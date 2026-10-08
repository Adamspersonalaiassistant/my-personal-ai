import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ONE_EMERY_DEVICE_CONTRACT,
  detectEmeryDeviceContext,
  deviceContinuityPrompt,
  deviceSourceMetadata,
} from "../src/lib/emery/device-continuity.ts";

const iphone = detectEmeryDeviceContext({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
  innerWidth: 393,
  standalone: true,
  coarsePointer: true,
});
assert.equal(iphone.platform, "ios");
assert.equal(iphone.deviceClass, "phone");
assert.equal(iphone.displayMode, "standalone");
assert.equal(iphone.touchCapable, true);

const ipadDesktopUa = detectEmeryDeviceContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 5,
  innerWidth: 1024,
  displayModeStandalone: true,
  coarsePointer: true,
});
assert.equal(ipadDesktopUa.platform, "ios");
assert.equal(ipadDesktopUa.deviceClass, "tablet");

const desktop = detectEmeryDeviceContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 Safari/537.36",
  platform: "Win32",
  maxTouchPoints: 0,
  innerWidth: 1440,
});
assert.equal(desktop.platform, "windows");
assert.equal(desktop.deviceClass, "desktop");
assert.equal(desktop.displayMode, "browser");

const metadata = deviceSourceMetadata(iphone);
assert.deepEqual(Object.keys(metadata).sort(), [
  "deviceClass",
  "devicePlatform",
  "displayMode",
  "touchCapable",
]);
assert(!("deviceId" in metadata));
assert(!("userAgent" in metadata));

const prompt = deviceContinuityPrompt(metadata);
assert(prompt.includes("presentation context only"));
assert(prompt.includes("never create a separate Emery identity"));
assert(prompt.includes("same server-side conversation"));
assert(prompt.includes("controllers, execution receipts"));
assert(ONE_EMERY_DEVICE_CONTRACT.includes("canonical controllers"));
assert(ONE_EMERY_DEVICE_CONTRACT.includes("one assistant across iPhone PWA"));
assert(ONE_EMERY_DEVICE_CONTRACT.includes("never forks memory"));

const manifest = JSON.parse(
  fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
);
assert.equal(manifest.id, "/");
assert.equal(manifest.display, "standalone");
assert(!("orientation" in manifest), "Phase 8 must not lock the shared app to portrait-only");
assert(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 4);
assert(manifest.start_url.startsWith("/chat"));
assert(manifest.shortcuts.some((item) => item.url.startsWith("/conversation")));
assert(manifest.shortcuts.some((item) => item.url.startsWith("/hpo")));
assert(manifest.shortcuts.some((item) => item.url.startsWith("/calendar")));
assert(manifest.shortcuts.some((item) => item.url.startsWith("/capture")));

const captureSource = fs.readFileSync(
  new URL("../src/routes/_authenticated/capture.tsx", import.meta.url),
  "utf8",
);
const chatSource = fs.readFileSync(
  new URL("../src/routes/_authenticated/chat.tsx", import.meta.url),
  "utf8",
);
const rootSource = fs.readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const bootstrapSource = fs.readFileSync(
  new URL("../src/components/EmeryDeviceContinuityBootstrap.tsx", import.meta.url),
  "utf8",
);
const appShellSource = fs.readFileSync(
  new URL("../src/components/AppShell.tsx", import.meta.url),
  "utf8",
);
const centralSource = fs.readFileSync(
  new URL("../src/lib/emery.functions.ts", import.meta.url),
  "utf8",
);
const deviceHookSource = fs.readFileSync(
  new URL("../src/lib/emery/use-device-continuity.ts", import.meta.url),
  "utf8",
);
const iphoneSource = fs.readFileSync(
  new URL("../src/routes/_authenticated/iphone.tsx", import.meta.url),
  "utf8",
);

// iPhone/Shortcut entry remains a thin bridge into the same server-backed Emery.
assert(captureSource.includes("deviceSourceMetadata"));
assert(captureSource.includes("sendEmeryMessage"));
assert(captureSource.includes("Same Emery · same conversation"));

// Device detection is initialized once for the whole app, not as a second assistant.
assert(deviceHookSource.includes('register("/emery-sw.js"'));
assert(deviceHookSource.includes("deviceSourceMetadata"));
assert(deviceHookSource.includes("emeryDeviceClass"));
assert(deviceHookSource.includes("emeryPlatform"));
assert(deviceHookSource.includes("emeryDisplayMode"));
assert(!deviceHookSource.includes("deviceId"));
assert(bootstrapSource.includes("useEmeryDeviceContinuity"));
assert(rootSource.includes("EmeryDeviceContinuityBootstrap"));

// Voice home and typed conversation remain two surfaces of the same assistant.
const conversationSource = fs.readFileSync(new URL("../src/routes/_authenticated/conversation.tsx", import.meta.url), "utf8");
assert(chatSource.includes("EmeryVoiceControl"));
assert(conversationSource.includes("sendEmeryMessage"));
assert(conversationSource.includes("getMainConversationPage"));
assert(appShellSource.includes("md:hidden"));
assert(appShellSource.includes("md:flex"));
assert(appShellSource.includes('to="/chat"'));
assert(appShellSource.includes('to: "/hpo"'));
assert(appShellSource.includes('to: "/calendar"'));

// Central Emery already guarantees one identity/conversation/action stack across entry points.
assert(
  centralSource.includes(
    "There is one Emery across chat, capture, Shortcut, Voice, Calendar, HPO, memory, and future integrations.",
  ),
);
assert(centralSource.includes('channel", "main"'));
assert(centralSource.includes("mainConversation"));
assert(centralSource.includes("buildEmeryContext"));
assert(centralSource.includes("prepareEmeryRequestRouting"));
assert(centralSource.includes("executionCapabilityPrompt"));
assert(!centralSource.includes("deviceId"));

assert(iphoneSource.includes("same Emery"));
assert(iphoneSource.includes("same memory"));
assert(iphoneSource.includes("same main conversation"));
assert(iphoneSource.includes("server-backed Emery"));

console.log("Emery Phase 8 device continuity validation passed.");
