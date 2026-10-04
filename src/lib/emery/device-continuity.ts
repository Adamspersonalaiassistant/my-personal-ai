export type EmeryDeviceClass = "phone" | "tablet" | "desktop";
export type EmeryDevicePlatform = "ios" | "android" | "macos" | "windows" | "linux" | "other";
export type EmeryDisplayMode = "standalone" | "browser";

export type EmeryDeviceContext = {
  version: 1;
  deviceClass: EmeryDeviceClass;
  platform: EmeryDevicePlatform;
  displayMode: EmeryDisplayMode;
  touchCapable: boolean;
  coarsePointer: boolean;
};

export type DeviceDetectionInput = {
  userAgent?: string | null;
  platform?: string | null;
  maxTouchPoints?: number | null;
  innerWidth?: number | null;
  standalone?: boolean | null;
  displayModeStandalone?: boolean | null;
  coarsePointer?: boolean | null;
};

function normalized(value: string | null | undefined) {
  return String(value ?? "").toLowerCase();
}

export function detectEmeryDeviceContext(input: DeviceDetectionInput = {}): EmeryDeviceContext {
  const ua = normalized(input.userAgent);
  const platformText = normalized(input.platform);
  const maxTouchPoints = Number.isFinite(Number(input.maxTouchPoints))
    ? Math.max(0, Number(input.maxTouchPoints))
    : 0;
  const touchCapable = maxTouchPoints > 0;
  const ipadDesktopUa = platformText.includes("mac") && touchCapable;

  let platform: EmeryDevicePlatform = "other";
  if (/iphone|ipad|ipod/.test(ua) || ipadDesktopUa) platform = "ios";
  else if (/android/.test(ua)) platform = "android";
  else if (/macintosh|mac os/.test(ua) || platformText.includes("mac")) platform = "macos";
  else if (/windows/.test(ua) || platformText.includes("win")) platform = "windows";
  else if (/linux/.test(ua) || platformText.includes("linux")) platform = "linux";

  const width = Number.isFinite(Number(input.innerWidth)) ? Number(input.innerWidth) : 1280;
  let deviceClass: EmeryDeviceClass;
  if (/iphone|ipod|android.+mobile/.test(ua) || width <= 767) deviceClass = "phone";
  else if (/ipad/.test(ua) || ipadDesktopUa || (touchCapable && width <= 1180)) deviceClass = "tablet";
  else deviceClass = "desktop";

  return {
    version: 1,
    deviceClass,
    platform,
    displayMode:
      input.standalone === true || input.displayModeStandalone === true ? "standalone" : "browser",
    touchCapable,
    coarsePointer: input.coarsePointer === true,
  };
}

export function currentEmeryDeviceContext(): EmeryDeviceContext {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return detectEmeryDeviceContext();
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return detectEmeryDeviceContext({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    innerWidth: window.innerWidth,
    standalone: nav.standalone === true,
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches === true,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches === true,
  });
}

export function deviceSourceMetadata(context: EmeryDeviceContext = currentEmeryDeviceContext()) {
  return {
    deviceClass: context.deviceClass,
    devicePlatform: context.platform,
    displayMode: context.displayMode,
    touchCapable: context.touchCapable,
  } as const;
}

export function normalizeDeviceSourceMetadata(raw: Record<string, unknown> | null | undefined) {
  const deviceClass = ["phone", "tablet", "desktop"].includes(String(raw?.deviceClass))
    ? (raw?.deviceClass as EmeryDeviceClass)
    : undefined;
  const devicePlatform = ["ios", "android", "macos", "windows", "linux", "other"].includes(
    String(raw?.devicePlatform),
  )
    ? (raw?.devicePlatform as EmeryDevicePlatform)
    : undefined;
  const displayMode = ["standalone", "browser"].includes(String(raw?.displayMode))
    ? (raw?.displayMode as EmeryDisplayMode)
    : undefined;
  const touchCapable = typeof raw?.touchCapable === "boolean" ? raw.touchCapable : undefined;
  return { deviceClass, devicePlatform, displayMode, touchCapable };
}

export function deviceContinuityPrompt(input: {
  deviceClass?: EmeryDeviceClass | null;
  devicePlatform?: EmeryDevicePlatform | null;
  displayMode?: EmeryDisplayMode | null;
  touchCapable?: boolean | null;
}) {
  const deviceClass = input.deviceClass ?? "unknown";
  const platform = input.devicePlatform ?? "unknown";
  const displayMode = input.displayMode ?? "unknown";
  return `DEVICE CONTINUITY:\n- Current presentation surface: ${deviceClass}; platform=${platform}; display=${displayMode}; touch=${input.touchCapable === true ? "yes" : input.touchCapable === false ? "no" : "unknown"}.\n- This is presentation context only. It must never create a separate Emery identity, memory, planner, conversation, CRM, or execution state.\n- The same server-side conversation, durable memory, Current Context, Capability Router, planner, controllers, execution receipts, HPO state, and Calendar state remain authoritative across iPhone and computer.\n- On phone, keep interaction concise and touch-friendly when brevity helps. On desktop, richer formatting is acceptable when useful. Do not change factual content merely because the device changed.\n- Never claim native iOS, Siri, Action Button, Contacts, Photos, Files, Calendar, or Reminders access unless the connected app/Shortcut/tool actually confirms it.`;
}

export const ONE_EMERY_DEVICE_CONTRACT = `ONE EMERY DEVICE CONTRACT:
- Emery is one assistant across iPhone PWA, mobile browser, desktop browser, and future native entry points.
- Device metadata changes presentation only; it never forks memory, identity, conversation, routing, or action state.
- All durable state remains server-backed and user-scoped.
- Shortcut/capture/Voice are entry points into the same Emery brain, not separate assistants.
- No device-specific write may bypass canonical controllers or execution receipts.`;
