import { useCallback, useEffect, useState } from "react";
import {
  currentEmeryDeviceContext,
  deviceSourceMetadata,
  type EmeryDeviceContext,
} from "./device-continuity.ts";

export function useEmeryDeviceContinuity() {
  const [device, setDevice] = useState<EmeryDeviceContext>(() => currentEmeryDeviceContext());
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false);

  const refresh = useCallback(() => setDevice(currentEmeryDeviceContext()), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const displayMode = window.matchMedia?.("(display-mode: standalone)");
    const coarse = window.matchMedia?.("(pointer: coarse)");
    window.addEventListener("resize", refresh, { passive: true });
    displayMode?.addEventListener?.("change", refresh);
    coarse?.addEventListener?.("change", refresh);
    refresh();
    return () => {
      window.removeEventListener("resize", refresh);
      displayMode?.removeEventListener?.("change", refresh);
      coarse?.removeEventListener?.("change", refresh);
    };
  }, [refresh]);

  // Device continuity is presentation-only. Expose only coarse, non-identifying
  // attributes on the root element so responsive UI can adapt without forking
  // Emery's identity, memory, conversation, routing, or execution state.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset["emeryDeviceClass"] = device.deviceClass;
    root.dataset["emeryPlatform"] = device.platform;
    root.dataset["emeryDisplayMode"] = device.displayMode;
    root.dataset["emeryTouch"] = device.touchCapable ? "true" : "false";
    return () => {
      delete root.dataset["emeryDeviceClass"];
      delete root.dataset["emeryPlatform"];
      delete root.dataset["emeryDisplayMode"];
      delete root.dataset["emeryTouch"];
    };
  }, [device]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/emery-sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (!cancelled) setServiceWorkerReady(true);
      })
      .catch(() => {
        if (!cancelled) setServiceWorkerReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    device,
    sourceMetadata: deviceSourceMetadata(device),
    serviceWorkerReady,
    refresh,
  };
}
