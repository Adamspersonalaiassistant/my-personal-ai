import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MapPinned,
  MessageCircle,
  Navigation,
  Pencil,
  Route as RouteIcon,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { openHpoEmery } from "@/components/HpoEmerySheet";
import { HpoLeafletMap } from "@/components/hpo-map/HpoLeafletMap";
import type { PlannerGamePlan } from "@/lib/hpo-planner-selection";
import {
  addHpoRouteStopNote,
  optimizeHpoRoute,
} from "@/lib/hpo-route.functions";
import {
  removeHpoRouteStop,
  reoptimizeHpoRouteRemaining,
} from "@/lib/hpo-field.functions";
import {
  deleteHpoPlannedRoute,
  getHpoWeeklyPlanner,
} from "@/lib/hpo-weekly-planner.functions";

type Stop = {
  id: string;
  route_id: string;
  stop_order: number;
  status: string;
  visited_at: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_meters_from_previous: number | null;
  drive_seconds_from_previous: number | null;
  metadata:
    | {
        visit_type?: string;
        game_plan?: PlannerGamePlan;
        route_note_saved_at?: string;
        route_note_updated_at?: string;
        route_note_locked?: boolean;
        route_note_version?: number;
      }
    | null;
  updated_at: string | null;
  office_name: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  visit_summary: string | null;
  visit_outcome: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
};

type RoutePlan = {
  id: string;
  route_date: string;
  area: string | null;
  status: string;
  start_window: string | null;
  end_window: string | null;
  start_address: string | null;
  optimized_distance_meters: number | null;
  optimized_duration_seconds: number | null;
  optimized_at: string | null;
  notes: string | null;
  metadata:
    | (Record<string, unknown> & {
        game_plan?: { discussion?: Array<{ role: string; text: string }> };
        starting_point?: { label?: string; address?: string; kind?: string };
      })
    | null;
  start_latitude: number | null;
  start_longitude: number | null;
  end_latitude: number | null;
  end_longitude: number | null;
  stops: Stop[];
};

type PlannerData = {
  today: string;
  timezone: string;
  weekStart: string;
  weekEnd: string;
  routes: RoutePlan[];
};

const finishedStatuses = new Set([
  "completed",
  "visited",
  "closed",
  "skipped",
  "bad_address",
]);

function addDaysKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return date.toISOString().slice(0, 10);
}

function prettyDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(value + "T12:00:00").toLocaleDateString(
    undefined,
    options ?? { month: "short", day: "numeric" },
  );
}

function dayName(value: string) {
  return prettyDate(value, { weekday: "short" });
}

function mondayForKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addDaysKey(value, delta);
}

function weekLabel(start: string, end: string) {
  const startDate = new Date(start + "T12:00:00");
  const endDate = new Date(end + "T12:00:00");
  if (startDate.getFullYear() !== endDate.getFullYear()) {
    return `${prettyDate(start, { month: "short", day: "numeric", year: "numeric" })} – ${prettyDate(
      end,
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      },
    )}`;
  }
  return `${prettyDate(start, { month: "short", day: "numeric" })} – ${prettyDate(
    end,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  )}`;
}

function miles(meters: number | null) {
  if (meters == null) return null;
  return `${(meters / 1609.344).toFixed(meters > 16093 ? 0 : 1)} mi`;
}

function duration(seconds: number | null) {
  if (seconds == null) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function statusLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldNoteTime(stop: Stop, timezone: string) {
  const value =
    stop.metadata?.route_note_saved_at ||
    stop.updated_at ||
    stop.visited_at;
  if (!value) return "Saved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function HpoWeeklyPlanner({
  onOpenMap,
  onRouteContextChange,
  focusDate = null,
  focusRouteId = null,
}: {
  onOpenMap: (input: {
    routeDate: string;
    routeId?: string | null;
    build?: boolean;
  }) => void;
  onRouteContextChange?: (
    routeId: string | null,
    stopId: string | null,
  ) => void;
  focusDate?: string | null;
  focusRouteId?: string | null;
}) {
  const load = useServerFn(getHpoWeeklyPlanner);
  const deleteRoute = useServerFn(deleteHpoPlannedRoute);
  const saveRouteNote = useServerFn(addHpoRouteStopNote);
  const optimizeRoute = useServerFn(optimizeHpoRoute);
  const removeStop = useServerFn(removeHpoRouteStop);
  const reoptimizeRemaining = useServerFn(reoptimizeHpoRouteRemaining);
  const [data, setData] = useState<PlannerData | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removingStopId, setRemovingStopId] = useState<string | null>(null);
  const [routePendingDelete, setRoutePendingDelete] = useState<RoutePlan | null>(null);
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null);
  const [stopNotes, setStopNotes] = useState<Record<string, string>>({});
  const [editingNoteStopId, setEditingNoteStopId] = useState<string | null>(null);
  const [savingNoteStopId, setSavingNoteStopId] = useState<string | null>(null);
  const [optimizingRouteId, setOptimizingRouteId] = useState<string | null>(null);

  const refresh = useCallback(
    async (weekStart?: string | null) => {
      const result = (await load({
        data: { weekStart: weekStart ?? null },
      })) as PlannerData;
      setData(result);
      setSelectedDate((current) => {
        if (current && current >= result.weekStart && current <= result.weekEnd)
          return current;
        if (result.today >= result.weekStart && result.today <= result.weekEnd)
          return result.today;
        const firstPlanned = result.routes[0]?.route_date;
        return firstPlanned ?? result.weekStart;
      });
      setError("");
      return result;
    },
    [load],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const requestedWeek =
      focusDate && /^\d{4}-\d{2}-\d{2}$/.test(focusDate)
        ? mondayForKey(focusDate)
        : null;
    void load({ data: { weekStart: requestedWeek } })
      .then((result) => {
        if (cancelled) return;
        const next = result as PlannerData;
        setData(next);
        setSelectedDate(
          focusDate && focusDate >= next.weekStart && focusDate <= next.weekEnd
            ? focusDate
            : next.today >= next.weekStart && next.today <= next.weekEnd
              ? next.today
              : (next.routes[0]?.route_date ?? next.weekStart),
        );
        setError("");
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn't open weekly planner.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusDate, load]);

  const weekDays = useMemo(
    () =>
      data
        ? Array.from({ length: 7 }, (_, index) =>
            addDaysKey(data.weekStart, index),
          )
        : [],
    [data],
  );
  const routesByDate = useMemo(() => {
    const map = new Map<string, RoutePlan[]>();
    for (const route of data?.routes ?? []) {
      const rows = map.get(route.route_date) ?? [];
      rows.push(route);
      map.set(route.route_date, rows);
    }
    return map;
  }, [data]);
  const selectedRoutes = selectedDate
    ? (routesByDate.get(selectedDate) ?? [])
    : [];
  const selectedRoute =
    selectedRoutes.find((route) => route.id === focusRouteId) ??
    selectedRoutes[0] ??
    null;
  const selectedRouteNextStop = selectedRoute
    ? [...selectedRoute.stops]
        .sort((a, b) => a.stop_order - b.stop_order)
        .find((stop) => !finishedStatuses.has(stop.status)) ?? null
    : null;

  useEffect(() => {
    onRouteContextChange?.(
      selectedRoute?.id ?? null,
      selectedRouteNextStop?.id ?? null,
    );
  }, [onRouteContextChange, selectedRoute?.id, selectedRouteNextStop?.id]);

  useEffect(
    () => () => {
      onRouteContextChange?.(null, null);
    },
    [onRouteContextChange],
  );

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Opening weekly planner…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-destructive/35 bg-card/50 p-4 text-sm text-destructive">
        {error || "Couldn't open weekly planner."}
      </div>
    );
  }

  const totalStops = data.routes.reduce(
    (sum, route) => sum + route.stops.length,
    0,
  );
  const completedStops = data.routes.reduce(
    (sum, route) =>
      sum +
      route.stops.filter((stop) => finishedStatuses.has(stop.status)).length,
    0,
  );

  async function moveWeek(days: number) {
    setLoading(true);
    try {
      await refresh(addDaysKey(data!.weekStart, days));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't load that week.",
      );
    } finally {
      setLoading(false);
    }
  }

  function planWeekWithEmery() {
    openHpoEmery(
      `Help me plan my HPO field routes for the week of ${data!.weekStart} through ${data!.weekEnd}. Review the routes I already have saved for this week. Help me choose the best days and territories for the missing days, one decision at a time. Do not create a route until I tell you which day and area to use.`,
      "Weekly Planner",
    );
  }

  function buildRoute(date: string) {
    openHpoEmery("", `Build Route · ${prettyDate(date)}`, {
      routeDate: date,
      plannerBuild: true,
    });
  }

  function workRouteWithEmery(route: RoutePlan) {
    openHpoEmery(
      `I'm planning my saved HPO route for ${route.route_date}${route.area ? ` in ${route.area}` : ""}. Use route ID ${route.id} as the route I'm working on. Help me add, remove, reorder, optimize, or review stops and notes. Ask only for information you actually need before making a change.`,
      `Route · ${prettyDate(route.route_date)}`,
    );
  }

  async function reoptimizeRoute(route: RoutePlan) {
    if (optimizingRouteId) return;
    setOptimizingRouteId(route.id);
    setError("");
    try {
      await optimizeRoute({
        data: {
          routeId: route.id,
          idempotencyKey: `planner:${crypto.randomUUID()}:hpo.route.optimize`,
          sourceChannel: "planner_ui",
        },
      });
      await refresh(data!.weekStart);
      setSelectedDate(route.route_date);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't re-optimize that route.",
      );
    } finally {
      setOptimizingRouteId(null);
    }
  }

  async function saveStopNote(stop: Stop) {
    onRouteContextChange?.(stop.route_id, stop.id);
    const note = (stopNotes[stop.id] ?? "").trim();
    if (!note || savingNoteStopId) return;
    setSavingNoteStopId(stop.id);
    setError("");
    try {
      const result: any = await saveRouteNote({
        data: {
          stopId: stop.id,
          note,
          idempotencyKey: `planner:${crypto.randomUUID()}:hpo.route_stop.add_note`,
          sourceChannel: "planner_ui",
        },
      });
      const intelligence = result?.intelligence;
      const parts = [
        `Note saved to ${stop.office_name || "the account"}.`,
      ];
      if (intelligence?.nextAction) {
        parts.push(`Next action: ${intelligence.nextAction}.`);
      }
      if (intelligence?.calendarEvent) {
        const eventAt = new Date(
          intelligence.calendarEvent.startAt,
        ).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        parts.push(
          intelligence.calendarEvent.updated
            ? `Updated Calendar: ${intelligence.calendarEvent.title} — ${eventAt}.`
            : intelligence.calendarEvent.duplicate
              ? `Calendar already has ${intelligence.calendarEvent.title} for ${eventAt}.`
              : `Added to Calendar: ${intelligence.calendarEvent.title} — ${eventAt}.`,
        );
      } else if (intelligence?.calendarClarification) {
        parts.push(`Calendar needs one detail: ${intelligence.calendarClarification}`);
      } else if (intelligence?.analyzed === true && !intelligence?.nextAction) {
        parts.push("Emery reviewed it and found no structured follow-up or calendar commitment to add.");
      } else if (intelligence?.analyzed === false) {
        parts.push("The note is saved; Emery’s structured review did not finish this time.");
      }
      setNotice(parts.join(" "));
      setStopNotes((current) => ({ ...current, [stop.id]: "" }));
      setEditingNoteStopId((current) => (current === stop.id ? null : current));
      await refresh(data!.weekStart);
      if (selectedDate) setSelectedDate(selectedDate);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't save that note.",
      );
    } finally {
      setSavingNoteStopId(null);
    }
  }

  async function removePlannerStop(route: RoutePlan, stop: Stop) {
    onRouteContextChange?.(route.id, stop.id);
    if (removingStopId || finishedStatuses.has(stop.status)) return;
    if (
      !window.confirm(
        `Remove ${stop.office_name || "this stop"} from this route? The account, notes, and completed visit history will stay saved.`,
      )
    )
      return;

    setRemovingStopId(stop.id);
    setError("");
    setNotice("");
    try {
      await removeStop({
        data: {
          routeId: route.id,
          stopId: stop.id,
          idempotencyKey: `planner:${crypto.randomUUID()}:hpo.route.remove_stop`,
          sourceChannel: "planner_ui",
        },
      });

      let suffix = "";
      try {
        const optimized: any = await reoptimizeRemaining({
          data: {
            routeId: route.id,
            latitude: null,
            longitude: null,
            idempotencyKey: `planner:${crypto.randomUUID()}:hpo.route.reoptimize_after_remove`,
            sourceChannel: "planner_ui",
          },
        });
        suffix =
          optimized.remaining > 1
            ? ` Remaining route re-optimized · ${optimized.driveMinutes} min · ${optimized.distanceMiles} mi.`
            : optimized.remaining === 1
              ? " One stop remains."
              : " No stops remain.";
      } catch {
        suffix =
          " The stop was removed, but automatic re-optimization could not finish.";
      }

      setNotice(
        `${stop.office_name || "Stop"} removed from the route. Account history was preserved.${suffix}`,
      );
      await refresh(data!.weekStart);
      setSelectedDate(route.route_date);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't remove that stop.",
      );
    } finally {
      setRemovingStopId(null);
    }
  }

  async function confirmDeleteRoute() {
    const route = routePendingDelete;
    if (!route || deletingRouteId) return;
    setDeletingRouteId(route.id);
    setError("");
    try {
      await deleteRoute({ data: { routeId: route.id } });
      setRoutePendingDelete(null);
      await refresh(data!.weekStart);
      setSelectedDate(route.route_date);
      onRouteContextChange?.(null, null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't delete that route.",
      );
    } finally {
      setDeletingRouteId(null);
    }
  }

  return (
    <section className="min-w-0 space-y-4">
      <div className="rounded-lg border border-live/15 bg-surface/90 p-3.5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
               <CalendarDays className="size-5 text-live" />
              <h1 className="text-lg font-semibold">Weekly Planner</h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {weekLabel(data.weekStart, data.weekEnd)} · {data.routes.length}{" "}
              route
              {data.routes.length === 1 ? "" : "s"} · {totalStops} stops
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0 gap-1.5 px-3 text-xs"
            onClick={planWeekWithEmery}
          >
            <MessageCircle className="size-4" />
            Emery
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="size-11 p-0"
            aria-label="Previous week"
            onClick={() => void moveWeek(-7)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-0 px-2 text-xs font-semibold"
            onClick={() => {
              setLoading(true);
              void refresh(null).finally(() => setLoading(false));
            }}
          >
            This week
          </Button>
          <Button
            type="button"
            variant="outline"
            className="size-11 p-0"
            aria-label="Next week"
            onClick={() => void moveWeek(7)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1">
          {weekDays.map((date) => {
            const dayRoutes = routesByDate.get(date) ?? [];
            const dayStops = dayRoutes.reduce(
              (sum, route) => sum + route.stops.length,
              0,
            );
            const selected = date === selectedDate;
            const today = date === data.today;
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={
                  selected
                    ? "min-w-0 rounded-xl border border-primary bg-primary px-0.5 py-2 text-primary-foreground"
                    : today
                      ? "min-w-0 rounded-xl border border-primary/45 bg-primary/10 px-0.5 py-2 text-foreground"
                      : "min-w-0 rounded-xl border border-border/50 bg-background/35 px-0.5 py-2 text-foreground"
                }
                aria-current={selected ? "date" : undefined}
              >
                <span className="block text-[9px] font-semibold uppercase tracking-wide opacity-80">
                  {dayName(date)}
                </span>
                <span className="mt-0.5 block text-sm font-bold">
                  {Number(date.slice(-2))}
                </span>
                <span className="mt-1 block h-2 text-[8px] leading-2 opacity-80">
                  {dayRoutes.length ? (dayStops ? `${dayStops}` : "•") : ""}
                </span>
              </button>
            );
          })}
        </div>

        {completedStops ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-primary" />
            {completedStops} of {totalStops} weekly stops completed
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/35 bg-card/40 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-2 text-xs text-foreground">
          {notice}
        </div>
      ) : null}

      {selectedDate ? (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3 px-0.5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                {selectedDate === data.today ? "Today" : dayName(selectedDate)}
              </p>
              <h2 className="mt-0.5 text-lg font-semibold">
                {prettyDate(selectedDate, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h2>
            </div>
            {selectedRoute ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0 gap-1.5 px-3 text-xs"
                onClick={() =>
                  onOpenMap({
                    routeDate: selectedDate,
                    routeId: selectedRoute.id,
                    build: false,
                  })
                }
              >
                <MapPinned className="size-4" />
                Map
              </Button>
            ) : null}
          </div>

          {!selectedRoutes.length ? (
            <div className="rounded-2xl border border-border/55 bg-card/35 p-5 text-center">
              <RouteIcon className="mx-auto size-7 text-primary" />
              <h3 className="mt-3 text-base font-semibold">No route planned</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                Select the offices for this day, review your game plan with
                Emery, then finalize the driving route.
              </p>
              <div className="mt-4">
                <Button
                  type="button"
                  className="min-h-12 w-full"
                  onClick={() => buildRoute(selectedDate)}
                >
                  <RouteIcon className="size-4" />
                  Build Route
                </Button>
              </div>
            </div>
          ) : (
            selectedRoutes.map((route) => {
              const orderedStops = [...route.stops].sort(
                (a, b) => a.stop_order - b.stop_order,
              );
              const completed = orderedStops.filter((stop) =>
                finishedStatuses.has(stop.status),
              ).length;
              const routeStats = [
                duration(route.optimized_duration_seconds),
                miles(route.optimized_distance_meters),
              ].filter(Boolean);
              const startingPoint =
                route.metadata?.starting_point?.label ||
                route.start_address ||
                "Starting point unavailable";
              return (
                <article
                  key={route.id}
                  className={
                    route.id === focusRouteId
                      ? "overflow-hidden rounded-2xl border border-primary/45 bg-primary/[0.045] shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
                      : "overflow-hidden rounded-2xl border border-border/55 bg-card/35"
                  }
                >
                  <div className="border-b border-border/45 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                          {statusLabel(route.status)}
                        </p>
                        <h3 className="mt-1 truncate text-base font-semibold">
                          {route.area || "HPO Marketing Route"}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {orderedStops.length} stops · {completed} completed
                          {routeStats.length
                            ? ` · ${routeStats.join(" · ")}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 gap-1.5 px-3 text-xs"
                          onClick={() => workRouteWithEmery(route)}
                        >
                          <MessageCircle className="size-4" />
                          Emery
                        </Button>
                        {["planned", "draft"].includes(route.status) &&
                        !orderedStops.some((stop) =>
                          finishedStatuses.has(stop.status),
                        ) ? (
                          <button
                            type="button"
                            onClick={() => setRoutePendingDelete(route)}
                            className="flex size-11 items-center justify-center rounded-xl border border-border/60 bg-background/45 text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/[0.06] hover:text-destructive"
                            aria-label="Delete planned route"
                            title="Delete planned route"
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {route.notes ? (
                      <div className="mt-3 flex items-start gap-2 rounded-xl border border-border/40 bg-background/35 px-3 py-2.5">
                        <StickyNote className="mt-0.5 size-4 shrink-0 text-primary" />
                        <p className="text-xs leading-5 text-muted-foreground">
                          {route.notes}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">
                          {route.optimized_at
                            ? "Optimized Route"
                            : "Saved route"}
                        </p>
                        {route.optimized_at ? (
                          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                            <div className="col-span-2">
                              <dt className="text-[10px] text-muted-foreground">
                                Starting point
                              </dt>
                              <dd className="mt-0.5 font-semibold text-foreground">
                                {startingPoint}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-muted-foreground">
                                Stops
                              </dt>
                              <dd className="mt-0.5 font-semibold text-foreground">
                                {orderedStops.length}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-muted-foreground">
                                Drive time
                              </dt>
                              <dd className="mt-0.5 font-semibold text-foreground">
                                {duration(route.optimized_duration_seconds) ||
                                  "Pending"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-muted-foreground">
                                Mileage
                              </dt>
                              <dd className="mt-0.5 font-semibold text-foreground">
                                {miles(route.optimized_distance_meters) ||
                                  "Pending"}
                              </dd>
                            </div>
                          </dl>
                        ) : (
                          <p className="mt-1 text-xs text-foreground">
                            {orderedStops.length} stops · open Map to optimize
                            driving order
                          </p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Button
                          type="button"
                          className="min-h-12 gap-2"
                          onClick={() =>
                            onOpenMap({
                              routeDate: route.route_date,
                              routeId: route.id,
                              build: false,
                            })
                          }
                        >
                          <MapPinned className="size-4" />
                          View optimized map
                        </Button>
                        {["planned", "draft"].includes(route.status) &&
                        !orderedStops.some((stop) =>
                          finishedStatuses.has(stop.status),
                        ) ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 gap-2 text-xs"
                            disabled={optimizingRouteId === route.id}
                            onClick={() => void reoptimizeRoute(route)}
                          >
                            <RouteIcon className="size-4" />
                            {optimizingRouteId === route.id
                              ? "Re-optimizing…"
                              : "Re-optimize route"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {route.metadata?.game_plan?.discussion?.length ? (
                    <details className="border-b border-border/45 px-4 py-3 text-xs leading-5">
                      <summary className="cursor-pointer font-semibold text-primary">
                        Emery planning discussion
                      </summary>
                      {route.metadata.game_plan.discussion.map(
                        (message, index) => (
                          <p key={index} className="mt-2 whitespace-pre-wrap">
                            <strong>
                              {message.role === "user" ? "Adam" : "Emery"}:
                            </strong>{" "}
                            {message.text}
                          </p>
                        ),
                      )}
                    </details>
                  ) : null}
                  {route.optimized_at ? (
                    <div
                      className="relative h-[410px] overflow-hidden border-b border-border/45"
                      aria-label="Optimized Planner route map"
                    >
                      <HpoLeafletMap
                        routeOnly
                        offices={[]}
                        selectedKeys={[]}
                        selectedOfficeKey={null}
                        route={route}
                        onSelectOffice={() => undefined}
                        onToggleRouteStop={() => undefined}
                        onBuildRoute={() => undefined}
                        preparing={false}
                        onRefreshPins={() => undefined}
                      />
                    </div>
                  ) : null}
                  <div className="divide-y divide-border/40">
                    {orderedStops.map((stop) => {
                      const hasCanonicalFieldNote =
                        stop.metadata?.route_note_locked === true;
                      const fieldNote = hasCanonicalFieldNote
                        ? stop.notes?.trim() || ""
                        : "";
                      const note =
                        stop.visit_summary ||
                        (!hasCanonicalFieldNote ? stop.notes : null) ||
                        stop.visit_outcome;
                      const editingFieldNote = editingNoteStopId === stop.id;
                      return (
                        <div
                          key={stop.id}
                          className="grid grid-cols-[32px_minmax(0,1fr)] gap-2.5 p-3.5"
                        >
                          <div
                            className={
                              finishedStatuses.has(stop.status)
                                ? "flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
                                : "flex size-8 items-center justify-center rounded-full border border-border/60 bg-background/40 text-xs font-bold text-muted-foreground"
                            }
                          >
                            {stop.stop_order}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 truncate text-sm font-semibold">
                                {stop.office_name || "Route stop"}
                              </p>
                              {stop.metadata?.visit_type ? (
                                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                  {stop.metadata.visit_type === "lunch"
                                    ? "Lunch"
                                    : "Office Visit"}
                                </span>
                              ) : null}
                              <span className="shrink-0 rounded-full border border-border/45 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {statusLabel(stop.status)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                              {[stop.address, stop.city]
                                .filter(Boolean)
                                .join(", ") || "Address not saved"}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {stop.address ? (
                                <a
                                  href={`https://maps.google.com/?saddr=Current+Location&daddr=${encodeURIComponent(
                                    [stop.address, stop.city]
                                      .filter(Boolean)
                                      .join(", "),
                                  )}&dirflg=d`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => onRouteContextChange?.(route.id, stop.id)}
                                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
                                >
                                  <Navigation className="size-3.5" />
                                  Go
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  className="min-h-10 rounded-xl border border-border/45 px-3 text-[11px] text-muted-foreground opacity-40"
                                >
                                  Address needed
                                </button>
                              )}
                              {!finishedStatuses.has(stop.status) ? (
                                <button
                                  type="button"
                                  onClick={() => void removePlannerStop(route, stop)}
                                  disabled={removingStopId === stop.id}
                                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-500/25 bg-rose-500/[0.045] px-3 text-[11px] font-semibold text-rose-500 disabled:opacity-40"
                                >
                                  <Trash2 className="size-3.5" />
                                  {removingStopId === stop.id ? "Removing…" : "Remove Stop"}
                                </button>
                              ) : null}
                            </div>
                            {fieldNote && !editingFieldNote ? (
                              <div className="mt-2 rounded-xl border border-primary/20 bg-primary/[0.045] p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">
                                      Field note · {fieldNoteTime(stop, data.timezone)}
                                    </p>
                                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                                      {fieldNote}
                                    </p>
                                  </div>
                                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="mt-3 min-h-11 w-full gap-1.5 text-xs"
                                  onClick={() => {
                                    onRouteContextChange?.(route.id, stop.id);
                                    setStopNotes((current) => ({
                                      ...current,
                                      [stop.id]: fieldNote,
                                    }));
                                    setEditingNoteStopId(stop.id);
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                  Edit Note
                                </Button>
                              </div>
                            ) : (
                              <div className="mt-2 grid gap-2">
                                <textarea
                                  value={stopNotes[stop.id] ?? ""}
                                  onFocus={() => onRouteContextChange?.(route.id, stop.id)}
                                  onChange={(event) =>
                                    setStopNotes((current) => ({
                                      ...current,
                                      [stop.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Add account note…"
                                  rows={3}
                                  className="min-h-24 w-full resize-y rounded-xl border border-border/50 bg-background/45 px-3 py-2.5 text-[16px] leading-6 outline-none focus:border-primary/35"
                                />
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="min-h-11 text-xs"
                                    disabled={
                                      savingNoteStopId === stop.id ||
                                      !(stopNotes[stop.id] ?? "").trim()
                                    }
                                    onClick={() => void saveStopNote(stop)}
                                  >
                                    {savingNoteStopId === stop.id
                                      ? "Saving…"
                                      : fieldNote
                                        ? "Update Note"
                                        : "Save Note"}
                                  </Button>
                                  {fieldNote ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      className="min-h-11 px-3 text-xs"
                                      disabled={savingNoteStopId === stop.id}
                                      onClick={() => {
                                        setStopNotes((current) => ({
                                          ...current,
                                          [stop.id]: "",
                                        }));
                                        setEditingNoteStopId(null);
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            )}
                            {stop.drive_seconds_from_previous != null ? (
                              <p className="mt-1 text-[10px] font-medium text-primary">
                                {Math.round(
                                  stop.drive_seconds_from_previous / 60,
                                )}{" "}
                                min
                                {stop.distance_meters_from_previous != null
                                  ? ` · ${(stop.distance_meters_from_previous / 1609.344).toFixed(1)} mi`
                                  : ""}
                                {` from ${stop.stop_order === 1 ? "starting point" : "previous stop"}`}
                              </p>
                            ) : null}
                            {stop.metadata?.game_plan ? (
                              <div
                                className="mt-2 rounded-lg border border-primary/15 bg-primary/[0.04] p-2.5 text-xs leading-5"
                                aria-label={`Game plan for ${stop.office_name}`}
                              >
                                <p className="text-[10px] font-semibold uppercase text-primary">
                                  Emery Game Plan
                                </p>
                                <p className="mt-1 whitespace-pre-wrap">
                                  <strong>Prior note:</strong>{" "}
                                  {stop.metadata.game_plan.priorNote}
                                </p>
                                <p className="mt-1">
                                  <strong>Context:</strong>{" "}
                                  {stop.metadata.game_plan.relationshipContext}
                                </p>
                                <p className="mt-1">
                                  <strong>Purpose:</strong>{" "}
                                  {stop.metadata.game_plan.purpose}
                                </p>
                                <p className="mt-1">
                                  <strong>Approach:</strong>{" "}
                                  {stop.metadata.game_plan.approach}
                                </p>
                              </div>
                            ) : null}
                            {note ? (
                              <div className="mt-2 rounded-lg bg-background/45 px-2.5 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                                  Visit outcome
                                </p>
                                <p className="mt-1 text-xs leading-5 text-foreground/90">
                                  {note}
                                </p>
                              </div>
                            ) : null}
                            {stop.next_action ? (
                              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                                <span className="font-semibold text-foreground">
                                  Next:
                                </span>{" "}
                                {stop.next_action}
                                {stop.next_action_due_at
                                  ? ` · ${new Date(stop.next_action_due_at).toLocaleDateString()}`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {!orderedStops.length ? (
                      <p className="px-4 py-5 text-center text-sm text-muted-foreground">
                        No stops have been added to this route yet.
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </div>
      ) : null}
      {routePendingDelete ? (
        <div
          className="fixed inset-0 z-[500] flex items-end justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => !deletingRouteId && setRoutePendingDelete(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-route-title"
            aria-describedby="delete-route-description"
            className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="delete-route-title" className="text-base font-semibold">
                  Delete this route?
                </h3>
                <p
                  id="delete-route-description"
                  className="mt-1 text-sm leading-5 text-muted-foreground"
                >
                  This will remove the planned route for{" "}
                  {prettyDate(routePendingDelete.route_date, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}. Your account records and notes will stay intact.
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(deletingRouteId)}
                onClick={() => setRoutePendingDelete(null)}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
                aria-label="Cancel delete route"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={Boolean(deletingRouteId)}
                onClick={() => setRoutePendingDelete(null)}
              >
                Keep Route
              </Button>
              <Button
                type="button"
                className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={Boolean(deletingRouteId)}
                onClick={() => void confirmDeleteRoute()}
              >
                {deletingRouteId ? "Deleting…" : "Yes, Delete"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
