import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import {
  addHpoRouteStops,
  arriveHpoRouteStop,
  completeHpoRoute,
  getHpoFieldToday,
  getHpoNearbyBackups,
  reoptimizeHpoRouteRemaining,
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
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
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
  const [note, setNote] = useState("");
  const [visitStatus, setVisitStatus] = useState("completed");
  const [followup, setFollowup] = useState("");
  const [followupDue, setFollowupDue] = useState("");
  const [nearbyOptions, setNearbyOptions] = useState<any[]>([]);

  const nextStop = data?.nextStop ?? null;
  const route = data?.route ?? null;

  const progressPercent = Math.round(Number(data?.progress ?? 0) * 100);
  const accountContext = data?.accountContext ?? null;
  const latestInteraction = accountContext?.interactions?.[0] ?? null;
  const primaryContact =
    accountContext?.contacts?.find((contact: any) => contact.is_primary) ??
    accountContext?.contacts?.[0] ??
    null;

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
        },
      });
    } else if (mutation.action === "hpo.route_stop.set_outcome") {
      await outcome({
        data: {
          stopId: mutation.targetId,
          status: payload.status,
          idempotencyKey: mutation.idempotencyKey,
          sourceChannel: "offline_sync",
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
          await updateHpoOutboxMutation(mutation, {
            status: "failed",
            attempts: mutation.attempts + 1,
            lastError: caught instanceof Error ? caught.message : String(caught),
          });
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
        stop.id === nextStop.id ? { ...stop, status, visited_at: stop.visited_at ?? new Date().toISOString() } : stop,
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
    const key = `field:${crypto.randomUUID()}:hpo.route_stop.set_outcome`;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueMutation("hpo.route_stop.set_outcome", nextStop.id, { status }, key);
      optimisticFinalStatus(status);
      setWorking(false);
      return;
    }
    try {
      await outcome({
        data: {
          stopId: nextStop.id,
          status,
          idempotencyKey: key,
          sourceChannel: "field_ui",
        },
      });
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
      await load();
    } catch (caught) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueMutation("hpo.route_stop.set_outcome", nextStop.id, { status }, key);
        optimisticFinalStatus(status);
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
      await arrive({ data: { stopId: nextStop.id, idempotencyKey: key, sourceChannel: "field_ui" } });
      setMessage("Arrival recorded.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't record arrival.");
    } finally {
      setWorking(false);
    }
  }

  async function submitVisit() {
    if (!nextStop?.id || !note.trim() || working) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    const dueIso = followupDue ? new Date(`${followupDue}T12:00:00`).toISOString() : null;
    const key = `field:${crypto.randomUUID()}:hpo.route_stop.log_visit`;
    const payload = {
      status: visitStatus,
      notes: note.trim(),
      visitOutcome: visitStatus === "closed" ? "Office closed" : visitStatus === "bad_address" ? "Bad / unusable address" : visitStatus === "skipped" ? "Skipped" : "Visit completed",
      nextAction: followup.trim() || null,
      nextActionDueAt: dueIso,
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueMutation("hpo.route_stop.log_visit", nextStop.id, payload, key);
      optimisticFinalStatus(visitStatus);
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
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueMutation("hpo.route_stop.log_visit", nextStop.id, payload, key);
        optimisticFinalStatus(visitStatus);
        setShowNote(false);
      } else {
        setError(caught instanceof Error ? caught.message : "Couldn't save this visit.");
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
      if (!(result.options ?? []).length) setMessage("No eligible backup office was found within ten minutes.");
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
      setError(caught instanceof Error ? caught.message : "Couldn't reoptimize the remaining route.");
    } finally {
      setWorking(false);
    }
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
      <section className="emery-glass flex min-h-64 items-center justify-center rounded-[1.6rem] text-sm text-muted-foreground">
        Opening today's field route…
      </section>
    );
  }

  if (!route) {
    return (
      <section className="emery-glass rounded-[1.6rem] p-6 text-center">
        <RouteIcon className="mx-auto size-7 text-primary" />
        <h2 className="mt-3 text-base font-semibold">No active field route yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
          Build a route from the Map. Today will automatically become your field execution screen.
        </p>
        <button
          type="button"
          onClick={onOpenMap}
          className="emery-press mt-4 min-h-11 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
        >
          Open Map
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-[1.6rem] border border-primary/18 bg-[linear-gradient(145deg,rgba(29,103,232,0.12),rgba(7,14,28,0.78))] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="emery-kicker">Today · Field Mode</p>
            <h2 className="mt-1.5 text-lg font-semibold">{route.area || "HPO Marketing Route"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.completed}/{data.total} stops complete · {data.remaining} remaining
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-semibold ${
                offline
                  ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                  : "border-primary/20 bg-primary/[0.06] text-primary"
              }`}
            >
              {offline ? <WifiOff className="size-3" /> : <Wifi className="size-3" />}
              {offline ? "Offline" : syncing ? "Syncing" : "Online"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="emery-press flex size-9 items-center justify-center rounded-xl border border-border/45 text-muted-foreground"
              aria-label="Refresh today's route"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {pendingCount ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2">
            <p className="text-[10px] text-amber-200">
              {pendingCount} field update{pendingCount === 1 ? "" : "s"} saved on this phone · Pending sync
            </p>
            {!offline ? (
              <button
                type="button"
                onClick={() => void syncOutbox()}
                disabled={syncing}
                className="text-[10px] font-semibold text-amber-200"
              >
                Sync now
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {nextStop ? (
        <>
          <section className="emery-glass rounded-[1.6rem] p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
                {nextStop.stop_order}
              </span>
              <div className="min-w-0 flex-1">
                <p className="emery-kicker">Next Stop</p>
                <h3 className="mt-1 truncate text-lg font-semibold">{nextStop.office_name || "Route stop"}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {[nextStop.address, nextStop.city].filter(Boolean).join(", ") || "Address not saved"}
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
                <button disabled className="min-h-12 rounded-xl border border-border/45 text-xs text-muted-foreground opacity-40">
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

            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => void setOutcome("completed")}
                disabled={working}
                className="emery-press min-h-14 rounded-xl border border-primary/20 bg-primary/[0.06] px-1.5 text-[10px] font-semibold text-primary"
              >
                <CheckCircle2 className="mx-auto mb-1 size-4" /> Done
              </button>
              <button
                type="button"
                onClick={() => void setOutcome("closed")}
                disabled={working}
                className="emery-press min-h-14 rounded-xl border border-border/45 px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                <Clock3 className="mx-auto mb-1 size-4" /> Closed
              </button>
              <button
                type="button"
                onClick={() => void setOutcome("bad_address")}
                disabled={working}
                className="emery-press min-h-14 rounded-xl border border-border/45 px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                <AlertTriangle className="mx-auto mb-1 size-4" /> Bad address
              </button>
              <button
                type="button"
                onClick={() => void setOutcome("skipped")}
                disabled={working}
                className="emery-press min-h-14 rounded-xl border border-border/45 px-1.5 text-[10px] font-semibold text-muted-foreground"
              >
                Skip
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowNote((value) => !value)}
              className="emery-press mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.035] px-3 text-xs font-semibold text-primary"
            >
              <Sparkles className="size-4" /> {showNote ? "Close Visit Note" : "Add Visit Note"}
            </button>
          </section>

          {accountContext ? (
            <section className="emery-glass rounded-[1.55rem] p-4">
              <p className="emery-kicker">Account Brief</p>
              <h3 className="mt-1.5 text-sm font-semibold">{accountContext.account?.name}</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                <div className="emery-surface rounded-xl p-2.5">
                  <p className="font-semibold text-foreground">Last touch</p>
                  <p className="mt-1">{dateOnly(accountContext.account?.last_touch_at)}</p>
                </div>
                <div className="emery-surface rounded-xl p-2.5">
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
                <p className="mt-3 text-xs text-muted-foreground">No prior interaction is recorded for this account.</p>
              )}
            </section>
          ) : null}

          {showNote ? (
            <section className="emery-glass rounded-[1.55rem] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Visit note</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    The note is saved locally while you type.
                  </p>
                </div>
                <EmeryVoiceControl hpoRouteId={route.id} onConversationChanged={() => void load()} />
              </div>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What happened at this office?"
                className="mt-3 min-h-28 w-full resize-none rounded-xl border border-border/50 bg-card/50 px-3 py-3 text-[16px] leading-6 outline-none focus:border-primary/30"
              />
              <div className="mt-2 flex gap-1 overflow-x-auto [scrollbar-width:none]">
                {[
                  ["completed", "Completed"],
                  ["closed", "Closed"],
                  ["bad_address", "Bad address"],
                  ["skipped", "Skip"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setVisitStatus(value)}
                    className={`min-h-9 shrink-0 rounded-xl border px-2.5 text-[10px] font-semibold ${
                      visitStatus === value
                        ? "border-primary/25 bg-primary/[0.08] text-primary"
                        : "border-border/45 text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={followup}
                onChange={(event) => setFollowup(event.target.value)}
                placeholder="Optional next action"
                className="mt-2 h-11 w-full rounded-xl border border-border/50 bg-card/50 px-3 text-sm outline-none focus:border-primary/30"
              />
              <input
                type="date"
                value={followupDue}
                onChange={(event) => setFollowupDue(event.target.value)}
                aria-label="Follow-up due date"
                className="mt-2 h-11 w-full rounded-xl border border-border/50 bg-card/50 px-3 text-sm outline-none focus:border-primary/30"
              />
              <button
                type="button"
                onClick={() => void submitVisit()}
                disabled={!note.trim() || working}
                className="emery-press mt-3 min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {offline ? "Save on Phone" : "Save Visit"}
              </button>
            </section>
          ) : null}
        </>
      ) : (
        <section className="emery-glass rounded-[1.6rem] p-5 text-center">
          <CheckCircle2 className="mx-auto size-7 text-primary" />
          <h3 className="mt-3 text-base font-semibold">Every stop has an outcome</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Review the day, copy your tracker rows from Map, or wrap the route when you're ready.
          </p>
        </section>
      )}

      {nearbyOptions.length ? (
        <section className="emery-glass rounded-[1.55rem] p-4">
          <p className="emery-kicker">Nearby Backup</p>
          <div className="mt-2 space-y-2">
            {nearbyOptions.slice(0, 3).map((option, index) => (
              <div key={option.key} className="emery-surface rounded-xl p-3">
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
          onClick={onOpenMap}
          className="emery-press flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border/45 px-3 text-xs font-semibold text-muted-foreground"
        >
          <RouteIcon className="size-4" /> Open Map
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
