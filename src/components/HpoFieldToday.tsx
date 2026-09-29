import { useEffect, useMemo, useState } from "react";
/* eslint-disable @typescript-eslint/no-explicit-any -- Canonical HPO server payloads and offline snapshots are legacy dynamically shaped records. */
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Route as RouteIcon,
  Wifi,
  WifiOff,
  ArrowUp,
  ArrowDown,
  CalendarPlus,
  FilePenLine,
  GripVertical,
  SquareCheckBig,
  Trash2,
} from "lucide-react";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import { Button } from "@/components/ui/button";
import {
  addHpoRouteStops,
  arriveHpoRouteStop,
  completeHpoRoute,
  getHpoFieldToday,
  getHpoNearbyBackups,
  reoptimizeHpoRouteRemaining,
  removeHpoRouteStop,
  reorderHpoRouteStopsCanonical,
} from "@/lib/hpo-field.functions";
import {
  setHpoRouteStopFollowup,
  setHpoRouteStopOutcome,
  updateHpoRouteStop,
} from "@/lib/hpo-route.functions";
import {
  clearHpoDraftNote,
  enqueueHpoMutation,
  listHpoOutbox,
  loadActiveHpoRouteSnapshot,
  loadHpoDraftNote,
  pendingHpoMutationCount,
  removeHpoOutboxMutation,
  saveHpoDraftNote,
  saveHpoRouteSnapshot,
  updateHpoOutboxMutation,
  type HpoOfflineMutation,
} from "@/lib/hpo-field-offline";

const TERMINAL = new Set(["completed", "visited", "closed", "bad_address", "skipped"]);
type CaptureMode = "visit" | "note" | "followup" | "reschedule";

function distanceLabel(meters: number | null | undefined) {
  if (!meters) return null;
  return `${(Number(meters) / 1609.344).toFixed(1)} mi`;
}

function durationLabel(seconds: number | null | undefined) {
  if (!seconds) return null;
  const minutes = Math.max(1, Math.round(Number(seconds) / 60));
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim()
    : `${minutes} min`;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function routeWeek(value: string | null | undefined) {
  if (!value) return [];
  const base = new Date(`${value}T12:00:00`);
  if (Number.isNaN(base.getTime())) return [];
  const start = new Date(base);
  start.setDate(base.getDate() - base.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function routeMonth(value: string | null | undefined) {
  if (!value) return "Daily Route";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Daily Route";
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function isNetworkFailure(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    error instanceof TypeError ||
    /network|failed to fetch|load failed|offline|connection/i.test(message)
  );
}

async function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 5000 },
    );
  });
}

export function HpoFieldToday({ onOpenMap }: { onOpenMap?: () => void }) {
  const loadToday = useServerFn(getHpoFieldToday);
  const arrive = useServerFn(arriveHpoRouteStop);
  const outcome = useServerFn(setHpoRouteStopOutcome);
  const saveVisit = useServerFn(updateHpoRouteStop);
  const saveFollowup = useServerFn(setHpoRouteStopFollowup);
  const nearby = useServerFn(getHpoNearbyBackups);
  const addStops = useServerFn(addHpoRouteStops);
  const reoptimize = useServerFn(reoptimizeHpoRouteRemaining);
  const finishRoute = useServerFn(completeHpoRoute);
  const removeStop = useServerFn(removeHpoRouteStop);
  const reorder = useServerFn(reorderHpoRouteStopsCanonical);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("visit");
  const [note, setNote] = useState("");
  const [visitStatus, setVisitStatus] = useState("completed");
  const [followup, setFollowup] = useState("");
  const [followupDue, setFollowupDue] = useState("");
  const [nearbyOptions, setNearbyOptions] = useState<any[]>([]);

  const nextStop = data?.nextStop ?? null;
  const route = data?.route ?? null;
  const routeDays = routeWeek(route?.route_date);
  const activeRouteDay = route?.route_date
    ? new Date(`${route.route_date}T12:00:00`).getDate()
    : null;

  const progressPercent = Math.round(Number(data?.progress ?? 0) * 100);
  const accountContext = data?.accountContext ?? null;
  const latestInteraction = accountContext?.interactions?.[0] ?? null;
  const primaryContact = accountContext?.contacts?.[0] ?? null;

  async function load(preferCache = false) {
    setError(null);
    if (preferCache) {
      const cached = await loadActiveHpoRouteSnapshot<any>().catch(() => null);
      if (cached) {
        setData(cached);
        return cached;
      }
    }
    try {
      const fresh = await loadToday({});
      setData(fresh);
      setOffline(false);
      if (fresh?.route?.id) await saveHpoRouteSnapshot(fresh).catch(() => undefined);
      return fresh;
    } catch (caught) {
      const cached = await loadActiveHpoRouteSnapshot<any>().catch(() => null);
      if (cached) {
        setData(cached);
        setOffline(true);
        setMessage("Offline snapshot loaded. Field notes will stay on this phone until sync.");
        return cached;
      }
      setError(caught instanceof Error ? caught.message : "Couldn't open today's field route.");
      return null;
    }
  }

  async function refreshPendingCount() {
    setPendingCount(await pendingHpoMutationCount().catch(() => 0));
  }

  async function syncOne(mutation: HpoOfflineMutation) {
    await updateHpoOutboxMutation(mutation, {
      status: "syncing",
      attempts: mutation.attempts + 1,
      lastError: null,
    });
    const payload = mutation.payload as any;
    if (mutation.action === "hpo.route_stop.arrive") {
      await arrive({
        data: {
          stopId: mutation.targetId,
          idempotencyKey: mutation.idempotencyKey,
          sourceChannel: "offline_sync",
          baseUpdatedAt: mutation.baseUpdatedAt ?? null,
        },
      });
    } else if (mutation.action === "hpo.route_stop.set_outcome") {
      await outcome({
        data: {
          stopId: mutation.targetId,
          status: payload.status,
          idempotencyKey: mutation.idempotencyKey,
          sourceChannel: "offline_sync",
          baseUpdatedAt: mutation.baseUpdatedAt ?? null,
        },
      });
    } else if (mutation.action === "hpo.route_stop.log_visit") {
      await saveVisit({
        data: {
          stopId: mutation.targetId,
          status: payload.status,
          notes: payload.notes ?? "",
          visitOutcome: payload.visitOutcome ?? null,
          nextAction: payload.nextAction ?? null,
          nextActionDueAt: payload.nextActionDueAt ?? null,
          idempotencyKey: mutation.idempotencyKey,
          sourceChannel: "offline_sync",
          baseUpdatedAt: mutation.baseUpdatedAt ?? null,
        },
      });
    } else if (mutation.action === "hpo.route_stop.add_note") {
      await saveVisit({
        data: {
          stopId: mutation.targetId,
          notes: payload.notes ?? "",
          idempotencyKey: mutation.idempotencyKey,
          sourceChannel: "offline_sync",
          baseUpdatedAt: mutation.baseUpdatedAt ?? null,
        },
      });
    } else if (mutation.action === "hpo.route_stop.set_followup") {
      await saveFollowup({
        data: {
          stopId: mutation.targetId,
          nextAction: payload.nextAction,
          nextActionDueAt: payload.nextActionDueAt ?? null,
          idempotencyKey: mutation.idempotencyKey,
          sourceChannel: "offline_sync",
          baseUpdatedAt: mutation.baseUpdatedAt ?? null,
        },
      });
    }
    await removeHpoOutboxMutation(mutation.mutationId);
  }

  async function syncOutbox() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const rows = await listHpoOutbox().catch(() => []);
    if (!rows.length) {
      await refreshPendingCount();
      return;
    }
    setSyncing(true);
    try {
      for (const mutation of rows) {
        try {
          await syncOne(mutation);
        } catch (caught) {
          const detail = caught instanceof Error ? caught.message : String(caught);
          await updateHpoOutboxMutation(mutation, {
            status: "failed",
            attempts: mutation.attempts + 1,
            lastError: detail,
          });
          if (detail.includes("offline_conflict")) {
            setError(
              "An offline field update needs review because this stop changed on the server. Your local mutation is still saved and was not overwritten.",
            );
          } else {
            setError(
              "A pending field update could not sync yet. It is still saved on this phone and can retry safely.",
            );
          }
          break;
        }
      }
      await load();
    } finally {
      setSyncing(false);
      await refreshPendingCount();
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await load();
      if (!cancelled && loaded?.nextStop?.id) {
        setNote(await loadHpoDraftNote(loaded.nextStop.id).catch(() => ""));
      }
      if (!cancelled) {
        await refreshPendingCount();
        if (typeof navigator !== "undefined" && navigator.onLine) {
          void syncOutbox();
        }
        setLoading(false);
      }
    })();
    const onOnline = () => {
      setOffline(false);
      void syncOutbox();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!nextStop?.id) {
      setNote("");
      setShowNote(false);
      setCaptureMode("visit");
      return;
    }
    void loadHpoDraftNote(nextStop.id)
      .then((draft) => setNote(draft))
      .catch(() => undefined);
  }, [nextStop?.id]);

  useEffect(() => {
    if (!nextStop?.id) return;
    const timer = window.setTimeout(() => {
      void saveHpoDraftNote(nextStop.id, note).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [nextStop?.id, note]);

  function optimisticFinalStatus(status: string) {
    setData((current: any) => {
      if (!current?.stops || !nextStop?.id) return current;
      const stops = current.stops.map((stop: any) =>
        stop.id === nextStop.id
          ? { ...stop, status, visited_at: stop.visited_at ?? new Date().toISOString() }
          : stop,
      );
      const completed = stops.filter((stop: any) => TERMINAL.has(String(stop.status))).length;
      const following = stops.find((stop: any) => !TERMINAL.has(String(stop.status))) ?? null;
      const next = {
        ...current,
        stops,
        nextStop: following,
        completed,
        remaining: Math.max(0, stops.length - completed),
        progress: stops.length ? completed / stops.length : 0,
      };
      void saveHpoRouteSnapshot(next).catch(() => undefined);
      return next;
    });
  }

  async function queueMutation(
    action: HpoOfflineMutation["action"],
    targetId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    await enqueueHpoMutation({
      action,
      targetId,
      payload,
      idempotencyKey,
      baseUpdatedAt: nextStop?.updated_at ?? null,
    });
    setOffline(true);
    await refreshPendingCount();
    setMessage("Saved on phone · Pending sync");
  }

  async function setOutcome(status: "completed" | "closed" | "bad_address" | "skipped") {
    if (!nextStop?.id || working) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    const hasDraft = Boolean(note.trim() || followup.trim());
    const dueIso = followupDue ? new Date(`${followupDue}T12:00:00`).toISOString() : null;
    const payload = {
      status,
      notes: note.trim() || null,
      visitOutcome:
        status === "closed"
          ? "Office closed"
          : status === "bad_address"
            ? "Bad / unusable address"
            : status === "skipped"
              ? "Skipped"
              : "Visit completed",
      nextAction: followup.trim() || null,
      nextActionDueAt: dueIso,
    };
    const action = hasDraft ? "hpo.route_stop.log_visit" : "hpo.route_stop.set_outcome";
    const key = `field:${crypto.randomUUID()}:${action}`;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueMutation(
        hasDraft ? "hpo.route_stop.log_visit" : "hpo.route_stop.set_outcome",
        nextStop.id,
        payload,
        key,
      );
      optimisticFinalStatus(status);
      setNote("");
      setFollowup("");
      setFollowupDue("");
      setShowNote(false);
      setWorking(false);
      return;
    }

    try {
      if (hasDraft) {
        await saveVisit({
          data: {
            stopId: nextStop.id,
            status,
            notes: note.trim(),
            visitOutcome: payload.visitOutcome,
            nextAction: payload.nextAction,
            nextActionDueAt: payload.nextActionDueAt,
            idempotencyKey: key,
            sourceChannel: "field_ui",
          },
        });
      } else {
        await outcome({
          data: {
            stopId: nextStop.id,
            status,
            idempotencyKey: key,
            sourceChannel: "field_ui",
          },
        });
      }
      setMessage(
        status === "closed"
          ? "Office marked closed."
          : status === "bad_address"
            ? "Bad address saved."
            : status === "skipped"
              ? "Stop skipped."
              : "Visit completed.",
      );
      await clearHpoDraftNote(nextStop.id).catch(() => undefined);
      setNote("");
      setFollowup("");
      setFollowupDue("");
      setShowNote(false);
      await load();
    } catch (caught) {
      if (isNetworkFailure(caught)) {
        await queueMutation(
          hasDraft ? "hpo.route_stop.log_visit" : "hpo.route_stop.set_outcome",
          nextStop.id,
          payload,
          key,
        );
        optimisticFinalStatus(status);
        setNote("");
        setFollowup("");
        setFollowupDue("");
        setShowNote(false);
      } else {
        setError(caught instanceof Error ? caught.message : "Couldn't update this stop.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function markArrived() {
    if (!nextStop?.id || working) return;
    setWorking(true);
    setError(null);
    const key = `field:${crypto.randomUUID()}:hpo.route_stop.arrive`;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueMutation("hpo.route_stop.arrive", nextStop.id, {}, key);
      setData((current: any) => ({
        ...current,
        nextStop: current?.nextStop ? { ...current.nextStop, status: "arrived" } : null,
        stops: (current?.stops ?? []).map((stop: any) =>
          stop.id === nextStop.id ? { ...stop, status: "arrived" } : stop,
        ),
      }));
      setWorking(false);
      return;
    }
    try {
      await arrive({
        data: { stopId: nextStop.id, idempotencyKey: key, sourceChannel: "field_ui" },
      });
      setMessage("Arrival recorded.");
      await load();
    } catch (caught) {
      if (isNetworkFailure(caught)) {
        await queueMutation("hpo.route_stop.arrive", nextStop.id, {}, key);
        setData((current: any) => ({
          ...current,
          nextStop: current?.nextStop ? { ...current.nextStop, status: "arrived" } : null,
          stops: (current?.stops ?? []).map((stop: any) =>
            stop.id === nextStop.id ? { ...stop, status: "arrived" } : stop,
          ),
        }));
      } else {
        setError(caught instanceof Error ? caught.message : "Couldn't record arrival.");
      }
    } finally {
      setWorking(false);
    }
  }

  function openCapture(mode: CaptureMode) {
    setCaptureMode(mode);
    if (mode === "visit") setVisitStatus("completed");
    if (mode === "reschedule") setVisitStatus("skipped");
    setShowNote(true);
  }

  async function submitVisit(statusOverride?: string) {
    const status = statusOverride ?? visitStatus;
    const effectiveNote = note.trim() || (captureMode === "reschedule" ? "Visit rescheduled." : "");
    if (!nextStop?.id || !effectiveNote || working) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    const dueIso = followupDue ? new Date(`${followupDue}T12:00:00`).toISOString() : null;
    const key = `field:${crypto.randomUUID()}:hpo.route_stop.log_visit`;
    const payload = {
      status,
      notes: effectiveNote,
      visitOutcome:
        captureMode === "reschedule"
          ? "Rescheduled"
          : status === "closed"
            ? "Office closed"
            : status === "bad_address"
              ? "Bad / unusable address"
              : status === "skipped"
                ? "Skipped"
                : "Visit completed",
      nextAction: followup.trim() || null,
      nextActionDueAt: dueIso,
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueMutation("hpo.route_stop.log_visit", nextStop.id, payload, key);
      optimisticFinalStatus(status);
      setNote("");
      setFollowup("");
      setFollowupDue("");
      setShowNote(false);
      setWorking(false);
      return;
    }
    try {
      await saveVisit({
        data: {
          stopId: nextStop.id,
          ...payload,
          idempotencyKey: key,
          sourceChannel: "field_ui",
        },
      });
      await clearHpoDraftNote(nextStop.id).catch(() => undefined);
      setMessage("Visit saved to route and account history.");
      setNote("");
      setFollowup("");
      setFollowupDue("");
      setShowNote(false);
      await load();
    } catch (caught) {
      if (isNetworkFailure(caught)) {
        await queueMutation("hpo.route_stop.log_visit", nextStop.id, payload, key);
        optimisticFinalStatus(status);
        setShowNote(false);
      } else {
        setError(caught instanceof Error ? caught.message : "Couldn't save this visit.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function submitNoteOnly() {
    if (!nextStop?.id || !note.trim() || working) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    const payload = { notes: note.trim() };
    const key = `field:${crypto.randomUUID()}:hpo.route_stop.add_note`;
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueMutation("hpo.route_stop.add_note", nextStop.id, payload, key);
      } else {
        await saveVisit({
          data: {
            stopId: nextStop.id,
            notes: payload.notes,
            idempotencyKey: key,
            sourceChannel: "field_ui",
          },
        });
        setMessage("Note added without completing the stop.");
        await load();
      }
      await clearHpoDraftNote(nextStop.id).catch(() => undefined);
      setNote("");
      setShowNote(false);
    } catch (caught) {
      if (isNetworkFailure(caught)) {
        await queueMutation("hpo.route_stop.add_note", nextStop.id, payload, key);
        setNote("");
        setShowNote(false);
      } else {
        setError(caught instanceof Error ? caught.message : "Couldn't save this note.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function submitFollowupOnly() {
    if (!nextStop?.id || !followup.trim() || working) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    const payload = {
      nextAction: followup.trim(),
      nextActionDueAt: followupDue ? new Date(`${followupDue}T12:00:00`).toISOString() : null,
    };
    const key = `field:${crypto.randomUUID()}:hpo.route_stop.set_followup`;
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueMutation("hpo.route_stop.set_followup", nextStop.id, payload, key);
      } else {
        await saveFollowup({
          data: {
            stopId: nextStop.id,
            ...payload,
            idempotencyKey: key,
            sourceChannel: "field_ui",
          },
        });
        setMessage("Follow-up saved. The stop remains open.");
        await load();
      }
      setFollowup("");
      setFollowupDue("");
      setShowNote(false);
    } catch (caught) {
      if (isNetworkFailure(caught)) {
        await queueMutation("hpo.route_stop.set_followup", nextStop.id, payload, key);
        setFollowup("");
        setFollowupDue("");
        setShowNote(false);
      } else {
        setError(caught instanceof Error ? caught.message : "Couldn't save this follow-up.");
      }
    } finally {
      setWorking(false);
    }
  }

  async function findNearby() {
    if (!route?.id || working) return;
    setWorking(true);
    setError(null);
    try {
      const position = await currentPosition();
      const result = await nearby({
        data: {
          routeId: route.id,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          maxMinutes: 10,
        },
      });
      setNearbyOptions(result.options ?? []);
      if (!(result.options ?? []).length)
        setMessage("No eligible backup office was found within ten minutes.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't find a nearby backup.");
    } finally {
      setWorking(false);
    }
  }

  async function addNearby(option: any) {
    if (!route?.id || working) return;
    setWorking(true);
    setError(null);
    try {
      await addStops({
        data: {
          routeId: route.id,
          stops: [
            {
              accountId: option.accountId ?? null,
              prospectId: option.prospectId ?? null,
              officeName: option.officeName,
              address: option.address,
              city: option.city,
              latitude: option.latitude,
              longitude: option.longitude,
            },
          ],
          idempotencyKey: `field:${crypto.randomUUID()}:hpo.route.add_stop`,
          sourceChannel: "field_ui",
        },
      });
      setNearbyOptions([]);
      setMessage(`${option.officeName} added to today's route.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't add that office.");
    } finally {
      setWorking(false);
    }
  }

  async function reoptimizeRemaining() {
    if (!route?.id || working) return;
    setWorking(true);
    setError(null);
    try {
      const position = await currentPosition();
      const result: any = await reoptimize({
        data: {
          routeId: route.id,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          idempotencyKey: `field:${crypto.randomUUID()}:hpo.route.reoptimize`,
          sourceChannel: "field_ui",
        },
      });
      setMessage(
        result.remaining
          ? `Remaining route reoptimized · ${result.driveMinutes} min · ${result.distanceMiles} mi.`
          : "No remaining stops need reoptimization.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Couldn't reoptimize the remaining route.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function moveQueuedStop(stopId: string, delta: number) {
    if (!route?.id || working || offline || pendingCount) return;
    const ordered = [...(data?.stops ?? [])].sort((a: any, b: any) => a.stop_order - b.stop_order);
    const from = ordered.findIndex((stop: any) => stop.id === stopId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ordered.length || TERMINAL.has(String(ordered[to]?.status)))
      return;
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    setWorking(true);
    setError(null);
    try {
      await reorder({
        data: {
          routeId: route.id,
          stopIds: ordered.map((stop: any) => stop.id),
          idempotencyKey: `field:${crypto.randomUUID()}:hpo.route.reorder`,
          sourceChannel: "field_ui",
        },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reorder the route.");
    } finally {
      setWorking(false);
    }
  }

  async function removeQueuedStop(stopId: string, officeName: string) {
    if (!route?.id || working || offline || pendingCount) return;
    if (!window.confirm(`Remove ${officeName || "this stop"} from today's route?`)) return;
    setWorking(true);
    setError(null);
    try {
      await removeStop({
        data: {
          routeId: route.id,
          stopId,
          idempotencyKey: `field:${crypto.randomUUID()}:hpo.route.remove_stop`,
          sourceChannel: "field_ui",
        },
      });
      setMessage(`${officeName || "Stop"} removed. Completed-stop history was preserved.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this stop.");
    } finally {
      setWorking(false);
    }
  }

  async function copyTodayVisits() {
    if (!route) return;
    const completed = (data?.stops ?? [])
      .filter((stop: any) => TERMINAL.has(String(stop.status)))
      .sort((a: any, b: any) => Number(a.stop_order) - Number(b.stop_order));
    const rows = [
      [
        "Date",
        "Stop Number",
        "Office",
        "Visit Status",
        "Visit Notes",
        "Follow-Up",
        "Account Status",
      ],
      ...completed.map((stop: any) => [
        route.route_date,
        String(stop.stop_order ?? ""),
        stop.office_name ?? "",
        String(stop.status ?? "").replaceAll("_", " "),
        stop.notes ?? stop.visit_summary ?? "",
        stop.next_action ?? "",
        stop.visit_outcome ?? "",
      ]),
    ];
    const tsv = rows
      .map((row: unknown[]) =>
        row.map((cell: unknown) => String(cell).replace(/[\t\n\r]+/g, " ")).join("\t"),
      )
      .join("\n");
    await navigator.clipboard.writeText(tsv);
    setMessage(
      `${completed.length} completed visit${completed.length === 1 ? "" : "s"} copied for your HPO tracker.`,
    );
  }

  async function wrapUp() {
    if (!route?.id || working) return;
    setWorking(true);
    setError(null);
    try {
      const result: any = await finishRoute({
        data: {
          routeId: route.id,
          idempotencyKey: `field:${crypto.randomUUID()}:hpo.route.complete`,
          sourceChannel: "field_ui",
        },
      });
      if (result.blocked) {
        setMessage(
          `${result.openStops.length} stop${result.openStops.length === 1 ? "" : "s"} still need an outcome before today can be closed.`,
        );
      } else {
        setMessage("Field day wrapped. Every route stop has a final outcome.");
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't wrap up the route.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <section className="flex min-h-64 items-center justify-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">
        Opening today's field route…
      </section>
    );
  }

  if (!route) {
    return (
      <div className="space-y-3">
        <header>
          <h1 className="text-lg font-semibold">Today</h1>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}{" "}
            · No route planned
          </p>
        </header>
        <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <RouteIcon className="mx-auto size-7 text-primary" />
          <h2 className="mt-3 text-base font-semibold">No route yet today</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            Build a route from the Map. Today will automatically become your field execution screen.
          </p>
          <Button
            type="button"
            onClick={onOpenMap}
            className="mt-4 min-h-11 rounded-xl px-4 text-sm font-semibold"
          >
            Build Route
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="hpo-today flex flex-col gap-3">
      <header>
        <h1 className="text-lg font-semibold">Today</h1>
        <p className="text-xs text-muted-foreground">
          {dateOnly(route.route_date)} · {data.remaining} remaining ·{" "}
          {String(route.status).replaceAll("_", " ")}
        </p>
      </header>
      <section className="hpo-today-overview overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-sm">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-muted px-3 py-3">
          <div className="min-w-0">
            <span
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-semibold ${
                offline
                  ? "border-amber-500/25 bg-amber-50 text-amber-700"
                  : "border-primary/20 bg-card text-primary"
              }`}
            >
              {offline ? <WifiOff className="size-3" /> : <Wifi className="size-3" />}
              {offline ? "Offline" : syncing ? "Syncing" : "Online"}
            </span>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase text-primary">HPO Field</p>
            <h2 className="mt-0.5 text-lg font-bold text-foreground">Daily Route</h2>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto flex size-11 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-sm"
            aria-label="Refresh today's route"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        <div className="border-b border-slate-200 px-3 py-3">
          <p className="text-center text-sm font-semibold text-slate-800">
            {routeMonth(route.route_date)}
          </p>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {routeDays.map((day) => {
              const active = day.getDate() === activeRouteDay;
              return (
                <div key={day.toISOString()} className="text-center">
                  <p className="text-[9px] font-semibold uppercase text-slate-400">
                    {day.toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
                  </p>
                  <span
                    className={`mx-auto mt-1 flex size-9 items-center justify-center rounded-full text-xs font-semibold ${
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-3 pb-3 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {route.area || "HPO Marketing Route"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {data.completed}/{data.total} stops complete · {data.remaining} remaining
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold text-primary">
              {progressPercent}%
            </span>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {data.lastCompletedStop || nextStop ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase text-primary">
                Route context
              </p>
              <p className="mt-1 text-[11px] leading-5 text-slate-600">
                {data.lastCompletedStop
                  ? `Last: Stop ${data.lastCompletedStop.stop_order} · ${data.lastCompletedStop.office_name || "completed"}.`
                  : "No completed stops yet."}{" "}
                {nextStop
                  ? `Next: Stop ${nextStop.stop_order} · ${nextStop.office_name || "route stop"}.`
                  : "No unfinished stops remain."}
              </p>
            </div>
          ) : null}

          {pendingCount ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[10px] text-amber-800">
                {pendingCount} field update{pendingCount === 1 ? "" : "s"} saved on this phone ·
                Pending sync
              </p>
              {!offline ? (
                <button
                  type="button"
                  onClick={() => void syncOutbox()}
                  disabled={syncing}
                  className="text-[10px] font-semibold text-amber-800"
                >
                  Sync now
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section
        aria-label="Ordered route stops"
        className="hpo-today-queue overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2.5">
          <div>
            <p className="text-[10px] font-semibold uppercase text-primary">
              Daily Route
            </p>
            <h3 className="text-sm font-semibold">{data.total} scheduled stops</h3>
          </div>
          <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold text-primary">
            {data.remaining} remaining
          </span>
        </div>
        <div className="divide-y divide-slate-200">
          {[...(data.stops ?? [])]
            .sort((a: any, b: any) => a.stop_order - b.stop_order)
            .map((stop: any, index: number, sorted: any[]) => {
              const done = TERMINAL.has(String(stop.status));
              return (
                <div
                  key={stop.id}
                  className={`flex min-h-[72px] items-center gap-2 px-2 py-2 ${done ? "bg-muted/50" : "bg-card"}`}
                >
                  <GripVertical className="size-5 shrink-0 text-slate-300" />
                  <span className="w-7 shrink-0 text-right text-sm font-bold text-primary">
                    {stop.stop_order}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`break-words text-sm font-semibold ${done ? "text-slate-500" : "text-slate-900"}`}
                    >
                      {stop.office_name || "Route stop"}
                    </p>
                    <p className="mt-0.5 break-words text-[11px] text-slate-500">
                      {[stop.address, stop.city].filter(Boolean).join(", ") || "Address not saved"}
                    </p>
                    {done && stop.visit_summary ? (
                      <p className="mt-0.5 break-words text-[10px] text-slate-400">
                        {stop.visit_summary}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center">
                    {done ? (
                      <SquareCheckBig
                        className="mr-1 size-5 text-primary"
                        aria-label="Completed stop"
                      />
                    ) : null}
                    {!done && !offline && !pendingCount ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-11 text-slate-500"
                          disabled={
                            working ||
                            index === 0 ||
                            TERMINAL.has(String(sorted[index - 1]?.status))
                          }
                          onClick={() => void moveQueuedStop(stop.id, -1)}
                          aria-label={`Move ${stop.office_name || "stop"} earlier`}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-11 text-slate-500"
                          disabled={
                            working ||
                            index === sorted.length - 1 ||
                            TERMINAL.has(String(sorted[index + 1]?.status))
                          }
                          onClick={() => void moveQueuedStop(stop.id, 1)}
                          aria-label={`Move ${stop.office_name || "stop"} later`}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-11 text-rose-500"
                          disabled={working}
                          onClick={() =>
                            void removeQueuedStop(stop.id, stop.office_name || "this stop")
                          }
                          aria-label={`Remove ${stop.office_name || "stop"} from route`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {nextStop ? (
        <>
          <section className="hpo-today-next rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
                {nextStop.stop_order}
              </span>
              <div className="min-w-0 flex-1">
                <p className="emery-kicker">Next Stop</p>
                <h3 className="mt-1 break-words text-lg font-semibold">
                  {nextStop.office_name || "Route stop"}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {[nextStop.address, nextStop.city].filter(Boolean).join(", ") ||
                    "Address not saved"}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-primary">
                  {durationLabel(nextStop.drive_seconds_from_previous) ? (
                    <span>{durationLabel(nextStop.drive_seconds_from_previous)}</span>
                  ) : null}
                  {distanceLabel(nextStop.distance_meters_from_previous) ? (
                    <span>{distanceLabel(nextStop.distance_meters_from_previous)}</span>
                  ) : null}
                  <span className="capitalize">{String(nextStop.status).replaceAll("_", " ")}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {nextStop.address ? (
                <a
                  href={`https://maps.apple.com/?daddr=${encodeURIComponent(
                    [nextStop.address, nextStop.city].filter(Boolean).join(", "),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="emery-press flex min-h-12 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.055] text-xs font-semibold text-primary"
                >
                  <Navigation className="size-4" /> Navigate
                </a>
              ) : (
                <button
                  disabled
                  className="min-h-12 rounded-xl border border-border/45 text-xs text-muted-foreground opacity-40"
                >
                  Address needed
                </button>
              )}
              <button
                type="button"
                onClick={() => void markArrived()}
                disabled={working || nextStop.status === "arrived"}
                className="emery-press min-h-12 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-45"
              >
                {nextStop.status === "arrived" ? "Arrived" : "I'm Here"}
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openCapture("visit")}
                disabled={working}
                className="emery-press min-h-12 rounded-xl bg-primary px-2 text-xs font-semibold text-primary-foreground"
              >
                <CheckCircle2 className="mr-1.5 inline size-4" /> Log Visit
              </button>
              <button
                type="button"
                onClick={() => openCapture("note")}
                disabled={working}
                className="emery-press min-h-12 rounded-xl border border-primary/20 bg-primary/[0.045] px-2 text-xs font-semibold text-primary"
              >
                <FilePenLine className="mr-1.5 inline size-4" /> Add Note
              </button>
              <button
                type="button"
                onClick={() => openCapture("followup")}
                disabled={working}
                className="emery-press min-h-12 rounded-xl border border-border/55 px-2 text-xs font-semibold text-muted-foreground"
              >
                <CalendarPlus className="mr-1.5 inline size-4" /> Set Follow-Up
              </button>
              <button
                type="button"
                onClick={() => openCapture("reschedule")}
                disabled={working}
                className="emery-press min-h-12 rounded-xl border border-border/55 px-2 text-xs font-semibold text-muted-foreground"
              >
                <Clock3 className="mr-1.5 inline size-4" /> Reschedule
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => void setOutcome("closed")}
                disabled={working}
                className="emery-press min-h-11 rounded-xl border border-border/45 px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                Office Closed
              </button>
              <button
                type="button"
                onClick={() => void setOutcome("bad_address")}
                disabled={working}
                className="emery-press min-h-11 rounded-xl border border-border/45 px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                Bad Address
              </button>
              <button
                type="button"
                onClick={() => void setOutcome("skipped")}
                disabled={working}
                className="emery-press min-h-11 rounded-xl border border-border/45 px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                Skip
              </button>
            </div>
          </section>

          {accountContext ? (
            <section className="border-b border-border/60 pb-3">
              <p className="emery-kicker">Account Brief</p>
              <h3 className="mt-1.5 text-sm font-semibold">{accountContext.account?.name}</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                <div className="rounded-xl border border-border bg-muted/50 p-2.5">
                  <p className="font-semibold text-foreground">Last touch</p>
                  <p className="mt-1">{dateOnly(accountContext.account?.last_touch_at)}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/50 p-2.5">
                  <p className="font-semibold text-foreground">Follow-up</p>
                  <p className="mt-1">{accountContext.account?.next_action || "None saved"}</p>
                </div>
              </div>
              {primaryContact ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{primaryContact.name}</span>
                  {primaryContact.role_title ? ` · ${primaryContact.role_title}` : ""}
                </p>
              ) : null}
              {latestInteraction ? (
                <div className="mt-3 rounded-xl border border-border/35 bg-card/30 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Last interaction · {dateTime(latestInteraction.occurred_at)}
                  </p>
                  <p className="mt-1.5 text-xs leading-5">{latestInteraction.summary}</p>
                  {latestInteraction.next_action ? (
                    <p className="mt-1.5 text-[10px] font-medium text-primary">
                      Next: {latestInteraction.next_action}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  No prior interaction is recorded for this account.
                </p>
              )}
            </section>
          ) : null}

          {showNote ? (
            <section className="border-b border-border/60 pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {captureMode === "visit"
                      ? "Log visit"
                      : captureMode === "note"
                        ? "Add account note"
                        : captureMode === "followup"
                          ? "Set follow-up"
                          : "Reschedule stop"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {captureMode === "followup"
                      ? "The stop stays open after this follow-up is saved."
                      : "Your note is saved locally while you type."}
                  </p>
                </div>
                <EmeryVoiceControl
                  hpoRouteId={route.id}
                  onConversationChanged={() => void load()}
                />
              </div>
              {captureMode !== "followup" ? (
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={
                    captureMode === "reschedule"
                      ? "Why is this office being rescheduled? (optional)"
                      : "What happened at this office?"
                  }
                  className="mt-3 min-h-28 w-full resize-none rounded-xl border border-border/50 bg-card/50 px-3 py-3 text-[16px] leading-6 outline-none focus:border-primary/30"
                />
              ) : null}
              {captureMode === "visit" ? (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ["completed", "Completed"],
                      ["closed", "Closed"],
                      ["bad_address", "Bad address"],
                      ["skipped", "Skip"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setVisitStatus(value)}
                      className={`min-h-11 rounded-xl border px-2.5 text-[10px] font-semibold ${
                        visitStatus === value
                          ? "border-primary/25 bg-primary/[0.08] text-primary"
                          : "border-border/45 text-muted-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {captureMode === "visit" ||
              captureMode === "followup" ||
              captureMode === "reschedule" ? (
                <>
                  <input
                    value={followup}
                    onChange={(event) => setFollowup(event.target.value)}
                    placeholder={
                      captureMode === "reschedule"
                        ? "Next action (required)"
                        : "Next action / follow-up"
                    }
                    className="mt-2 h-12 w-full rounded-xl border border-border/50 bg-card/50 px-3 text-base outline-none focus:border-primary/30"
                  />
                  <input
                    type="date"
                    value={followupDue}
                    onChange={(event) => setFollowupDue(event.target.value)}
                    aria-label="Follow-up due date"
                    className="mt-2 h-12 w-full rounded-xl border border-border/50 bg-card/50 px-3 text-base outline-none focus:border-primary/30"
                  />
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (captureMode === "note") void submitNoteOnly();
                  else if (captureMode === "followup") void submitFollowupOnly();
                  else if (captureMode === "reschedule") void submitVisit("skipped");
                  else void submitVisit();
                }}
                disabled={
                  working ||
                  (captureMode === "note" && !note.trim()) ||
                  (captureMode === "visit" && !note.trim()) ||
                  ((captureMode === "followup" || captureMode === "reschedule") && !followup.trim())
                }
                className="emery-press mt-3 min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {offline
                  ? "Save on Phone"
                  : captureMode === "visit"
                    ? "Save Visit"
                    : captureMode === "note"
                      ? "Save Note"
                      : captureMode === "followup"
                        ? "Save Follow-Up"
                        : "Reschedule Stop"}
              </button>
            </section>
          ) : null}
        </>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
          <CheckCircle2 className="mx-auto size-7 text-primary" />
          <h3 className="mt-3 text-base font-semibold">Every stop has an outcome</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Review the day, copy your tracker rows from Map, or wrap the route when you're ready.
          </p>
        </section>
      )}

      {nearbyOptions.length ? (
        <section className="border-b border-border/60 pb-3">
          <p className="emery-kicker">Nearby Backup</p>
          <div className="mt-2 space-y-2">
            {nearbyOptions.slice(0, 3).map((option, index) => (
              <div key={option.key} className="rounded-2xl border border-border bg-card p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{option.officeName}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {option.driveMinutes} min · {option.distanceMiles} mi · {option.kind}
                    </p>
                    <p className="mt-1 text-[10px] text-primary">
                      {(option.reasons ?? []).join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void addNearby(option)}
                    className="min-h-9 shrink-0 rounded-lg bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground"
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void findNearby()}
          disabled={working}
          className="emery-press flex min-h-12 items-center justify-center gap-2 rounded-xl border border-primary/18 bg-primary/[0.04] px-3 text-xs font-semibold text-primary disabled:opacity-40"
        >
          <MapPin className="size-4" /> Nearby backup
        </button>
        <button
          type="button"
          onClick={() => void reoptimizeRemaining()}
          disabled={working || !route}
          className="emery-press flex min-h-12 items-center justify-center gap-2 rounded-xl border border-primary/18 bg-primary/[0.04] px-3 text-xs font-semibold text-primary disabled:opacity-40"
        >
          <LocateFixed className="size-4" /> Fix remaining route
        </button>
        <button
          type="button"
          onClick={() => void copyTodayVisits()}
          className="emery-press flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border/45 px-3 text-xs font-semibold text-muted-foreground"
        >
          <CheckCircle2 className="size-4" /> Copy Visits
        </button>
        <button
          type="button"
          onClick={() => void wrapUp()}
          disabled={working}
          className="emery-press min-h-12 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
        >
          Wrap Up Today
        </button>
      </section>

      {message ? (
        <div className="rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2.5 text-xs text-primary">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
