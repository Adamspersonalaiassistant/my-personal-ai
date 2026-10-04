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
