import { useEffect, useMemo, useRef, useState } from "react";
/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy planner payloads include dynamic map and metadata records. */
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Clipboard,
  CalendarDays,
  Clock3,
  ExternalLink,
  MapPinned,
  Maximize2,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  captureHpoRouteNote,
  createHpoRoute,
  getHpoRoutePlanner,
  getHpoRouteScheduleAdvice,
  optimizeHpoRoute,
  prepareHpoOfficeMap,
  syncHpoRouteToCalendar,
  updateHpoRouteStop,
} from "@/lib/hpo-route.functions";
import { HpoMapAdapter } from "@/components/hpo-map/HpoMapAdapter";
import { HpoAccountFieldDetail } from "@/components/HpoAccountFieldDetail";
import { loadHpoOfficeSnapshots, saveHpoOfficeSnapshots } from "@/lib/hpo-field-offline";
import {
  addHpoRouteStops,
  exportHpoRouteTracker,
  removeHpoRouteStop,
  reorderHpoRouteStopsCanonical,
  reoptimizeHpoRouteRemaining,
} from "@/lib/hpo-field.functions";

type Stop = {
  id: string;
  route_id: string;
  account_id: string | null;
  prospect_id: string | null;
  stop_order: number;
  visit_priority: string | null;
  status: string;
  visited_at: string | null;
  office_name: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_meters_from_previous: number | null;
  drive_seconds_from_previous: number | null;
  notes: string | null;
  visit_summary: string | null;
  visit_outcome: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  updated_at: string;
};

type RoutePlan = {
  id: string;
  route_date: string;
  area: string | null;
  status: string;
  start_window: string | null;
  end_window: string | null;
  start_address: string | null;
  end_address: string | null;
  start_latitude: number | null;
  start_longitude: number | null;
  end_latitude: number | null;
  end_longitude: number | null;
  optimized_distance_meters: number | null;
  optimized_duration_seconds: number | null;
  optimized_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  stops: Stop[];
};

type Candidate = {
  key: string;
  accountId?: string | undefined;
  prospectId?: string | undefined;
  officeName: string;
  address: string;
  city?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  detail: string;
};

type MapOffice = Candidate & {
  kind: "account" | "prospect";
  specialty?: string | null;
  priority?: number | null;
  relationshipStage?: string | null;
  relationshipHealth?: string | null;
  ownerName?: string | null;
  lastTouchAt?: string | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
  fitStatus?: string | null;
  verificationStatus?: string | null;
  mapped: boolean;
};

type CalendarItem = {
  kind: "event" | "task";
  id: string;
  title: string;
  at: string;
  end_at: string | null;
  local_date: string;
  local_time: string;
  local_end_time: string | null;
  priority?: number;
  metadata?: Record<string, unknown> | null;
};

type PlannerData = {
  routes: RoutePlan[];
  accounts: any[];
  prospects: any[];
  calendar: CalendarItem[];
  timezone: string;
  today: string;
  featureFlags?: {
    hpoMapV2?: boolean;
  };
};

const terminalStatuses = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);

function formatDate(value: string) {
  const parsed = new Date(value + "T12:00:00");
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatMiles(meters: number | null | undefined) {
  if (!meters) return "—";
  return `${(meters / 1609.344).toFixed(meters > 16093 ? 0 : 1)} mi`;
}

function routeTitle(route: RoutePlan) {
  const date = new Date(route.route_date + "T12:00:00").toLocaleDateString("en-US");
  return `${date}- (${route.area || "HPO"}) Marketing Route`;
}

function defaultRouteDate(today: string) {
  const date = new Date(today + "T12:00:00");
  const day = date.getDay();
  if (day === 6) date.setDate(date.getDate() + 2);
  if (day === 0) date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const localDay = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${localDay}`;
}

function locationText(stop: Stop) {
  return [stop.address, stop.city].filter(Boolean).join(", ");
}

function projectToWorld(lat: number, lon: number, zoom: number) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  const scale = 256 * 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function routeMapBaseZoom(points: Array<{ lat: number; lon: number }>) {
  if (points.length <= 1) return 14;
  for (let zoom = 16; zoom >= 6; zoom -= 1) {
    const projected = points.map((point) => projectToWorld(point.lat, point.lon, zoom));
    const width =
      Math.max(...projected.map((point) => point.x)) -
      Math.min(...projected.map((point) => point.x));
    const height =
      Math.max(...projected.map((point) => point.y)) -
      Math.min(...projected.map((point) => point.y));
    if (width <= 620 && height <= 245) return zoom;
  }
  return 6;
}

function worldToLatLon(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const mercatorY = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(mercatorY));
  return {
    lat: Math.max(-85.05112878, Math.min(85.05112878, lat)),
    lon: ((lon + 540) % 360) - 180,
  };
}

function centerForPoints(
  points: Array<{ lat: number; lon: number }>,
  fallback: { lat: number; lon: number },
) {
  if (!points.length) return fallback;
  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLon = Math.min(...points.map((point) => point.lon));
  const maxLon = Math.max(...points.map((point) => point.lon));
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

function useInteractiveMap({
  baseCenter,
  fitZoom,
  width,
  height,
  resetKey,
}: {
  baseCenter: { lat: number; lon: number };
  fitZoom: number;
  width: number;
  height: number;
  resetKey: string;
}) {
  const [zoomOffset, setZoomOffset] = useState(0);
  const [center, setCenter] = useState(baseCenter);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    worldX: number;
    worldY: number;
    zoom: number;
  } | null>(null);
  const pinchRef = useRef<{ distance: number } | null>(null);

  const zoom = Math.max(5, Math.min(18, fitZoom + zoomOffset));

  useEffect(() => {
    setZoomOffset(0);
    setCenter(baseCenter);
    pointersRef.current.clear();
    panStartRef.current = null;
    pinchRef.current = null;
  }, [baseCenter.lat, baseCenter.lon, resetKey]);

  function zoomBy(delta: number) {
    setZoomOffset((value) => Math.max(5 - fitZoom, Math.min(18 - fitZoom, value + delta)));
  }

  function reset() {
    setZoomOffset(0);
    setCenter(baseCenter);
  }

  function beginPan(pointerId: number, x: number, y: number) {
    const world = projectToWorld(center.lat, center.lon, zoom);
    panStartRef.current = {
      pointerId,
      x,
      y,
      worldX: world.x,
      worldY: world.y,
      zoom,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1) {
      beginPan(event.pointerId, event.clientX, event.clientY);
      pinchRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      if (a && b) pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      panStartRef.current = null;
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const previous = pinchRef.current?.distance ?? distance;
      if (distance > previous * 1.18) {
        zoomBy(1);
        pinchRef.current = { distance };
      } else if (distance < previous * 0.82) {
        zoomBy(-1);
        pinchRef.current = { distance };
      }
      return;
    }

    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId || start.zoom !== zoom) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const dx = (event.clientX - start.x) * (width / rect.width);
    const dy = (event.clientY - start.y) * (height / rect.height);
    setCenter(worldToLatLon(start.worldX - dx, start.worldY - dy, zoom));
  }

  function finishPointer(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    pinchRef.current = null;
    const remaining = [...pointersRef.current.entries()][0];
    if (remaining) {
      beginPan(remaining[0], remaining[1].x, remaining[1].y);
    } else {
      panStartRef.current = null;
    }
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1 : -1);
  }

  return {
    center,
    zoom,
    viewportRef,
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
      onWheel,
      onDoubleClick: () => zoomBy(1),
    },
  };
}

function RouteMap({ route }: { route: RoutePlan }) {
  const points = useMemo(() => {
    const result: Array<{
      lat: number;
      lon: number;
      label: string;
      kind: "start" | "stop" | "end";
      stopId?: string;
      status?: string;
      officeName?: string | null;
    }> = [];
    if (Number.isFinite(route.start_latitude) && Number.isFinite(route.start_longitude)) {
      result.push({
        lat: Number(route.start_latitude),
        lon: Number(route.start_longitude),
        label: "S",
        kind: "start",
      });
    }
    for (const stop of [...route.stops].sort((a, b) => a.stop_order - b.stop_order)) {
      if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) {
        result.push({
          lat: Number(stop.latitude),
          lon: Number(stop.longitude),
          label: String(stop.stop_order),
          kind: "stop",
          stopId: stop.id,
          status: stop.status,
          officeName: stop.office_name,
        });
      }
    }
    if (Number.isFinite(route.end_latitude) && Number.isFinite(route.end_longitude)) {
      result.push({
        lat: Number(route.end_latitude),
        lon: Number(route.end_longitude),
        label: "E",
        kind: "end",
      });
    }
    return result;
  }, [route]);

  const fitZoom = useMemo(() => routeMapBaseZoom(points), [points]);
  const width = 760;
  const height = 340;
  const baseCenter = useMemo(() => centerForPoints(points, { lat: 40.25, lon: -74.65 }), [points]);
  const map = useInteractiveMap({
    baseCenter,
    fitZoom,
    width,
    height,
    resetKey: `${route.id}:${route.optimized_at ?? ""}`,
  });

  if (!points.length) {
    return (
      <section className="overflow-hidden rounded-[1.55rem] border border-border/45 bg-card/30">
        <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <MapPinned className="size-7 text-primary" />
          <p className="mt-3 text-sm font-semibold">Map appears after route optimization</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Add your offices and tap Optimize Route. Emery will geocode the stops, choose the
            driving order and pin every office on the map.
          </p>
        </div>
      </section>
    );
  }

  const zoom = map.zoom;
  const projected = points.map((point) => ({
    ...point,
    ...projectToWorld(point.lat, point.lon, zoom),
  }));
  const centerWorld = projectToWorld(map.center.lat, map.center.lon, zoom);
  const left = centerWorld.x - width / 2;
  const top = centerWorld.y - height / 2;
  const tileSize = 256;
  const tileCount = 2 ** zoom;
  const tileMinX = Math.floor(left / tileSize) - 1;
  const tileMaxX = Math.floor((left + width) / tileSize) + 1;
  const tileMinY = Math.max(0, Math.floor(top / tileSize) - 1);
  const tileMaxY = Math.min(tileCount - 1, Math.floor((top + height) / tileSize) + 1);
  const tiles: Array<{ x: number; y: number; srcX: number }> = [];
  for (let y = tileMinY; y <= tileMaxY; y += 1) {
    for (let x = tileMinX; x <= tileMaxX; x += 1) {
      const srcX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({ x, y, srcX });
    }
  }

  const screenPoints = projected.map((point) => ({
    ...point,
    sx: point.x - left,
    sy: point.y - top,
  }));

  const rawGeometry = Array.isArray(route.metadata?.["route_geometry"])
    ? (route.metadata?.["route_geometry"] as unknown[])
    : [];
  const routeLinePoints = rawGeometry
    .map((value) => {
      if (!Array.isArray(value) || value.length < 2) return null;
      const lon = Number(value[0]);
      const lat = Number(value[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const world = projectToWorld(lat, lon, zoom);
      return { sx: world.x - left, sy: world.y - top };
    })
    .filter((value): value is { sx: number; sy: number } => Boolean(value));
  const visibleRouteLine = routeLinePoints.length >= 2 ? routeLinePoints : screenPoints;

  function jumpToStop(stopId?: string) {
    if (!stopId) return;
    const element = document.getElementById(`route-stop-${stopId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      if (element?.dataset["expanded"] !== "true") {
        element?.querySelector<HTMLButtonElement>("[data-route-note-toggle]")?.click();
      }
    }, 280);
  }

  return (
    <section className="overflow-hidden rounded-[1.55rem] border border-border/50 bg-card/25 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
      <div className="flex items-center justify-between gap-3 border-b border-border/35 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Route Map</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Drag to move · pinch/scroll to zoom · tap a pin to open that office
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={map.reset}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-border/45 bg-background/80"
            aria-label="Fit route on map"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={map.zoomOut}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-border/45 bg-background/80"
            aria-label="Zoom map out"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={map.zoomIn}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-border/45 bg-background/80"
            aria-label="Zoom map in"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={map.viewportRef}
        {...map.handlers}
        className="relative h-[340px] cursor-grab overflow-hidden bg-[#050b15] active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        {tiles.map((tile) => (
          <img
            key={`${zoom}-${tile.x}-${tile.y}`}
            src={`https://tile.openstreetmap.org/${zoom}/${tile.srcX}/${tile.y}.png`}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              filter:
                "invert(0.92) hue-rotate(178deg) brightness(0.68) saturate(0.78) contrast(1.12)",
              width: tileSize,
              height: tileSize,
              left: tile.x * tileSize - left,
              top: tile.y * tileSize - top,
            }}
          />
        ))}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,60,128,0.02),rgba(2,8,18,0.28))]" />
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded-xl border border-primary/15 bg-[#07111f]/88 px-2.5 py-1.5 text-[9px] font-medium text-foreground/80 shadow-sm backdrop-blur">
          Drag · pinch to zoom
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
        >
          <polyline
            points={visibleRouteLine.map((point) => `${point.sx},${point.sy}`).join(" ")}
            fill="none"
            stroke="rgba(32,105,255,0.86)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={visibleRouteLine.map((point) => `${point.sx},${point.sy}`).join(" ")}
            fill="none"
            stroke="rgba(255,255,255,0.82)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {screenPoints.map((point, index) => {
          const completed =
            point.kind === "stop" && point.status && terminalStatuses.has(point.status);
          return (
            <button
              key={`${point.kind}-${point.stopId ?? index}`}
              type="button"
              onClick={() => jumpToStop(point.stopId)}
              disabled={point.kind !== "stop"}
              title={point.officeName ?? (point.kind === "start" ? "Route start" : "Route end")}
              className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[11px] font-bold shadow-[0_5px_16px_rgba(0,0,0,0.35)] ${
                point.kind === "stop"
                  ? completed
                    ? "size-9 border-background bg-foreground text-background"
                    : "size-10 border-background bg-primary text-primary-foreground"
                  : "size-8 border-primary bg-background text-primary"
              }`}
              style={{
                left: `${(point.sx / width) * 100}%`,
                top: `${(point.sy / height) * 100}%`,
              }}
            >
              {point.label}
            </button>
          );
        })}

        <div className="absolute bottom-2 left-2 rounded-lg bg-background/82 px-2 py-1 text-[9px] text-muted-foreground backdrop-blur">
          © OpenStreetMap contributors
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto border-t border-border/35 px-3 py-3 [scrollbar-width:none]">
        {[...route.stops]
          .sort((a, b) => a.stop_order - b.stop_order)
          .map((stop) => (
            <button
              key={stop.id}
              type="button"
              onClick={() => jumpToStop(stop.id)}
              className="emery-press flex min-w-[150px] shrink-0 items-center gap-2 rounded-xl border border-border/40 bg-background/45 px-2.5 py-2 text-left"
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
                  terminalStatuses.has(stop.status)
                    ? "bg-foreground text-background"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {stop.stop_order}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold">
                  {stop.office_name || "Route stop"}
                </span>
                <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                  {stop.city || stop.address || "Address saved"}
                </span>
              </span>
            </button>
          ))}
      </div>
    </section>
  );
}

function OfficePlanningMap({
  offices,
  selectedKeys,
  selectedOfficeKey,
  onSelectOffice,
  onToggleRouteStop,
  onBuildRoute,
  preparing,
  onRefreshPins,
}: {
  offices: MapOffice[];
  selectedKeys: string[];
  selectedOfficeKey: string | null;
  onSelectOffice: (key: string) => void;
  onToggleRouteStop: (office: MapOffice) => void;
  onBuildRoute: () => void;
  preparing: boolean;
  onRefreshPins: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "account" | "prospect">("all");
  const [query, setQuery] = useState("");

  const mapped = useMemo(
    () =>
      offices.filter(
        (office) =>
          office.mapped &&
          Number.isFinite(office.latitude) &&
          Number.isFinite(office.longitude) &&
          (filter === "all" || office.kind === filter) &&
          (!query.trim() ||
            [office.officeName, office.address, office.city, office.specialty, office.detail]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ),
    [filter, offices, query],
  );

  const selectedOffice =
    offices.find((office) => office.key === selectedOfficeKey) ??
    offices.find((office) => selectedKeys.includes(office.key)) ??
    null;

  const points = mapped.map((office) => ({
    ...office,
    lat: Number(office.latitude),
    lon: Number(office.longitude),
  }));

  const fitZoom = points.length ? routeMapBaseZoom(points) : 8;
  const width = 760;
  const height = 390;
  const baseCenter = useMemo(() => centerForPoints(points, { lat: 40.25, lon: -74.65 }), [points]);
  const officeMap = useInteractiveMap({
    baseCenter,
    fitZoom,
    width,
    height,
    resetKey: `${filter}:${query.trim().toLowerCase()}:${points.map((point) => point.key).join("|")}`,
  });
  const zoom = officeMap.zoom;
  const projected = points.map((point) => ({
    ...point,
    ...projectToWorld(point.lat, point.lon, zoom),
  }));
  const centerWorld = projectToWorld(officeMap.center.lat, officeMap.center.lon, zoom);
  const left = centerWorld.x - width / 2;
  const top = centerWorld.y - height / 2;
  const tileSize = 256;
  const tileCount = 2 ** zoom;
  const tileMinX = Math.floor(left / tileSize) - 1;
  const tileMaxX = Math.floor((left + width) / tileSize) + 1;
  const tileMinY = Math.max(0, Math.floor(top / tileSize) - 1);
  const tileMaxY = Math.min(tileCount - 1, Math.floor((top + height) / tileSize) + 1);
  const tiles: Array<{ x: number; y: number; srcX: number }> = [];
  for (let y = tileMinY; y <= tileMaxY; y += 1) {
    for (let x = tileMinX; x <= tileMaxX; x += 1) {
      const srcX = ((x % tileCount) + tileCount) % tileCount;
      tiles.push({ x, y, srcX });
    }
  }

  const selectedCount = selectedKeys.length;
  const totalWithAddress = offices.filter((office) => office.address).length;
  const totalMapped = offices.filter((office) => office.mapped).length;

  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-primary/18 bg-card/25 shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
      <div className="border-b border-border/35 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="emery-kicker">Office Map · Account Tracker</p>
            <h3 className="mt-1 text-lg font-semibold">
              See the territory before you build the route.
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Drag the map like Google Maps, pinch or scroll to zoom, and tap any office pin to
              inspect the account or add it to a route.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshPins}
            disabled={preparing}
            className="emery-press flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/45 text-muted-foreground disabled:opacity-40"
            aria-label="Refresh office map pins"
          >
            <RefreshCw className={`size-3.5 ${preparing ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search offices, cities, specialties"
              className="h-11 w-full rounded-xl border border-border/45 bg-background/55 pl-9 pr-3 text-base outline-none focus:border-primary/30"
            />
          </div>
          <div className="flex shrink-0 gap-1 rounded-xl border border-border/40 bg-background/45 p-1">
            {(
              [
                ["all", "All"],
                ["account", "Accounts"],
                ["prospect", "Prospects"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`emery-press min-h-9 rounded-lg px-2.5 text-[10px] font-semibold ${
                  filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
          <span>
            {totalMapped}/{totalWithAddress} offices mapped
            {preparing ? " · preparing pins…" : ""}
          </span>
          <span>{selectedCount} selected for route</span>
        </div>
      </div>

      <div
        ref={officeMap.viewportRef}
        {...officeMap.handlers}
        className="relative h-[390px] cursor-grab overflow-hidden bg-[#050b15] active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        {tiles.map((tile) => (
          <img
            key={`${zoom}-${tile.x}-${tile.y}`}
            src={`https://tile.openstreetmap.org/${zoom}/${tile.srcX}/${tile.y}.png`}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width: tileSize,
              height: tileSize,
              left: tile.x * tileSize - left,
              top: tile.y * tileSize - top,
            }}
          />
        ))}

        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded-xl border border-primary/15 bg-[#07111f]/88 px-2.5 py-1.5 text-[9px] font-medium text-foreground/80 shadow-sm backdrop-blur">
          Drag · pinch to zoom
        </div>

        {projected.map((office) => {
          const selected = selectedKeys.includes(office.key);
          const focused = office.key === selectedOfficeKey;
          return (
            <button
              key={office.key}
              type="button"
              onClick={() => onSelectOffice(office.key)}
              title={office.officeName}
              aria-label={`Open ${office.officeName}`}
              className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[9px] font-bold shadow-[0_4px_14px_rgba(0,0,0,0.32)] transition ${
                selected
                  ? "size-10 border-background bg-primary text-primary-foreground"
                  : office.kind === "account"
                    ? "size-8 border-background bg-foreground text-background"
                    : "size-8 border-background bg-background text-foreground"
              } ${focused ? "ring-4 ring-primary/25" : ""}`}
              style={{
                left: `${((office.x - left) / width) * 100}%`,
                top: `${((office.y - top) / height) * 100}%`,
              }}
            >
              {selected ? <Check className="size-3.5" /> : office.kind === "account" ? "A" : "P"}
            </button>
          );
        })}

        <div className="absolute right-2 top-2 z-20 flex flex-col gap-1">
          <button
            type="button"
            onClick={officeMap.reset}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-primary/20 bg-[#081426]/90 text-primary shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur"
            aria-label="Fit all offices on map"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={officeMap.zoomIn}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-primary/20 bg-[#081426]/90 text-foreground shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur"
            aria-label="Zoom office map in"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={officeMap.zoomOut}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-primary/20 bg-[#081426]/90 text-foreground shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur"
            aria-label="Zoom office map out"
          >
            <Minus className="size-3.5" />
          </button>
        </div>

        {!points.length ? (
          <div className="absolute inset-x-4 top-1/2 z-20 -translate-y-1/2 rounded-2xl border border-border/45 bg-background/90 p-4 text-center backdrop-blur">
            <MapPinned className="mx-auto size-6 text-primary" />
            <p className="mt-2 text-sm font-semibold">Your office map is ready for pins.</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Emery is mapping saved office addresses. The map stays available even before you
              create a route.
            </p>
          </div>
        ) : null}

        <div className="absolute bottom-2 left-2 rounded-lg bg-background/84 px-2 py-1 text-[9px] text-muted-foreground backdrop-blur">
          A = account · P = prospect · © OpenStreetMap contributors
        </div>
      </div>

      {selectedOffice ? (
        <div className="border-t border-border/35 p-4">
          <div className="flex items-start gap-3">
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold ${
                selectedOffice.kind === "account"
                  ? "bg-foreground text-background"
                  : "bg-primary/[0.09] text-primary"
              }`}
            >
              {selectedOffice.kind === "account" ? "A" : "P"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="truncate text-sm font-semibold">{selectedOffice.officeName}</h4>
                <span className="shrink-0 rounded-full bg-muted/65 px-2 py-0.5 text-[9px] font-semibold capitalize text-muted-foreground">
                  {selectedOffice.kind}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {[selectedOffice.address, selectedOffice.city].filter(Boolean).join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[9px]">
                {selectedOffice.relationshipStage ? (
                  <span className="rounded-full border border-border/40 px-2 py-1">
                    {selectedOffice.relationshipStage}
                  </span>
                ) : null}
                {selectedOffice.priority ? (
                  <span className="rounded-full border border-border/40 px-2 py-1">
                    Priority {selectedOffice.priority}
                  </span>
                ) : null}
                {selectedOffice.fitStatus ? (
                  <span className="rounded-full border border-border/40 px-2 py-1 capitalize">
                    {selectedOffice.fitStatus}
                  </span>
                ) : null}
                {selectedOffice.specialty ? (
                  <span className="rounded-full border border-border/40 px-2 py-1">
                    {selectedOffice.specialty}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {selectedOffice.nextAction || selectedOffice.lastTouchAt ? (
            <div className="mt-3 rounded-xl border border-border/35 bg-background/35 px-3 py-2.5">
              {selectedOffice.nextAction ? (
                <p className="text-[11px]">
                  <span className="font-semibold text-foreground">Next:</span>{" "}
                  <span className="text-muted-foreground">{selectedOffice.nextAction}</span>
                </p>
              ) : null}
              {selectedOffice.lastTouchAt ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Last touch: {new Date(selectedOffice.lastTouchAt).toLocaleDateString()}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <a
              href={`https://maps.apple.com/?q=${encodeURIComponent([selectedOffice.officeName, selectedOffice.address, selectedOffice.city].filter(Boolean).join(", "))}`}
              target="_blank"
              rel="noreferrer"
              className="emery-press flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border/45 px-3 text-xs font-semibold text-muted-foreground"
            >
              <MapPinned className="size-3.5" /> Open location
            </a>
            <button
              type="button"
              onClick={() => onToggleRouteStop(selectedOffice)}
              className={`emery-press min-h-11 rounded-xl px-3 text-xs font-semibold ${
                selectedKeys.includes(selectedOffice.key)
                  ? "border border-primary/20 bg-primary/[0.06] text-primary"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {selectedKeys.includes(selectedOffice.key) ? "Remove from route" : "Add to route"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-border/35 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {selectedCount ? `${selectedCount} offices selected` : "Tap pins to build a route"}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            Your selections become the stop list in the route builder.
          </p>
        </div>
        <button
          type="button"
          onClick={onBuildRoute}
          disabled={!selectedCount}
          className="emery-press min-h-11 shrink-0 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-35"
        >
          Build Route
        </button>
      </div>
    </section>
  );
}

export function HpoRoutePlannerCompact({ onOpen }: { onOpen: () => void }) {
  const load = useServerFn(getHpoRoutePlanner);
  const [data, setData] = useState<PlannerData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load({})
      .then((result) => {
        if (!cancelled) setData(result as PlannerData);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const todayRoute = data?.routes.find((route) => route.route_date === data.today) ?? null;
  const nextRoute =
    todayRoute ??
    data?.routes
      .filter((route) => route.route_date >= (data?.today ?? ""))
      .sort((a, b) => a.route_date.localeCompare(b.route_date))[0] ??
    null;
  const completed =
    nextRoute?.stops.filter((stop) => terminalStatuses.has(stop.status)).length ?? 0;

  return (
    <section className="emery-fade-up rounded-[1.55rem] border border-primary/18 bg-primary/[0.045] p-4">
      <div className="flex items-center gap-3">
        <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-2xl text-primary">
          <RouteIcon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="emery-kicker">Route Planner · Daily Marketing Notes</p>
          <p className="mt-1 truncate text-sm font-semibold">
            {nextRoute ? routeTitle(nextRoute) : "Plan your next field route with Emery"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {nextRoute
              ? `${completed}/${nextRoute.stops.length} stops logged · route, Calendar block and notes stay together`
              : "Build the stop list, fit it around your Calendar, optimize the driving order, then log every office visit in one place."}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.07] text-primary"
          aria-label="Open HPO Route Planner"
        >
          <ArrowRight className="size-4" />
        </button>
      </div>
    </section>
  );
}

export function HpoRoutePlanner() {
  const load = useServerFn(getHpoRoutePlanner);
  const createRoute = useServerFn(createHpoRoute);
  const optimize = useServerFn(optimizeHpoRoute);
  const updateStop = useServerFn(updateHpoRouteStop);
  const reorderStops = useServerFn(reorderHpoRouteStopsCanonical);
  const addStopsToRoute = useServerFn(addHpoRouteStops);
  const exportTracker = useServerFn(exportHpoRouteTracker);
  const removeStopFromRoute = useServerFn(removeHpoRouteStop);
  const reoptimizeRemaining = useServerFn(reoptimizeHpoRouteRemaining);
  const captureNote = useServerFn(captureHpoRouteNote);
  const syncCalendar = useServerFn(syncHpoRouteToCalendar);
  const askSchedule = useServerFn(getHpoRouteScheduleAdvice);
  const prepareOfficeMap = useServerFn(prepareHpoOfficeMap);

  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [routeNote, setRouteNote] = useState("");
  const [routeNoteResult, setRouteNoteResult] = useState<string | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [scheduleAdvice, setScheduleAdvice] = useState<string | null>(null);
  const [scheduleWorking, setScheduleWorking] = useState(false);
  const [mapSelectedKeys, setMapSelectedKeys] = useState<string[]>([]);
  const [selectedMapOfficeKey, setSelectedMapOfficeKey] = useState<string | null>(null);
  const [mapSeedStops, setMapSeedStops] = useState<Candidate[]>([]);
  const [mapPreparing, setMapPreparing] = useState(false);
  const [mapPreparedOnce, setMapPreparedOnce] = useState(false);
  const [mapAccountDetailId, setMapAccountDetailId] = useState<string | null>(null);
  const [offlineMapOffices, setOfflineMapOffices] = useState<MapOffice[]>([]);

  async function refresh(preferredRouteId?: string | null) {
    const result = (await load({})) as PlannerData;
    setData(result);
    const nextId =
      preferredRouteId ||
      activeRouteId ||
      result.routes.find((route) => route.route_date === result.today)?.id ||
      result.routes[0]?.id ||
      null;
    setActiveRouteId(nextId);
    return result;
  }

  useEffect(() => {
    let cancelled = false;
    void load({})
      .then((result) => {
        if (cancelled) return;
        const next = result as PlannerData;
        setData(next);
        setActiveRouteId(
          next.routes.find((route) => route.route_date === next.today)?.id ??
            next.routes[0]?.id ??
            null,
        );
      })
      .catch(async (cause) => {
        if (cancelled) return;
        const cached = await loadHpoOfficeSnapshots<MapOffice[]>().catch(() => null);
        if (cached?.length) {
          setOfflineMapOffices(cached);
          setError(
            "Offline territory snapshot loaded. Saved offices remain available; live route changes need a connection.",
          );
        } else {
          setError(cause instanceof Error ? cause.message : "Couldn't load routes.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!data || mapPreparedOnce || mapPreparing) return;
    const needsPins = [...data.accounts, ...data.prospects].some(
      (office: any) =>
        office.address &&
        (!Number.isFinite(office.latitude) || !Number.isFinite(office.longitude)) &&
        !office.geocoded_at,
    );
    if (!needsPins) {
      setMapPreparedOnce(true);
      return;
    }
    setMapPreparing(true);
    setMapPreparedOnce(true);
    void prepareOfficeMap({ data: { limit: 100 } })
      .then(() => refresh(activeRouteId))
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Couldn't prepare all office map pins.");
      })
      .finally(() => setMapPreparing(false));
  }, [activeRouteId, data, mapPreparedOnce, mapPreparing, prepareOfficeMap]);

  const activeRoute =
    data?.routes.find((route) => route.id === activeRouteId) ?? data?.routes[0] ?? null;
  const activeCalendar = activeRoute
    ? (data?.calendar ?? []).filter((item) => item.local_date === activeRoute.route_date)
    : [];
  const nextStop = activeRoute
    ? ([...activeRoute.stops]
        .sort((a, b) => a.stop_order - b.stop_order)
        .find((stop) => !terminalStatuses.has(stop.status)) ?? null)
    : null;

  const mapOffices = useMemo<MapOffice[]>(() => {
    if (!data) return offlineMapOffices;
    const accounts = data.accounts.map((account: any) => ({
      key: `account:${account.id}`,
      accountId: account.id,
      officeName: account.name,
      address: account.address || "",
      city: account.city,
      latitude: account.latitude,
      longitude: account.longitude,
      detail:
        [account.account_type, account.specialty].filter(Boolean).join(" · ") || "HPO account",
      kind: "account" as const,
      specialty: account.specialty,
      priority: account.priority,
      relationshipStage: account.relationship_stage,
      relationshipHealth: account.relationship_health,
      ownerName: account.owner_name,
      lastTouchAt: account.last_touch_at,
      nextAction: account.next_action,
      nextActionDueAt: account.next_action_due_at,
      fitStatus: null,
      verificationStatus: null,
      mapped: Number.isFinite(account.latitude) && Number.isFinite(account.longitude),
    }));
    const prospects = data.prospects.map((prospect: any) => ({
      key: `prospect:${prospect.id}`,
      prospectId: prospect.id,
      officeName: prospect.name,
      address: prospect.address || "",
      city: prospect.city,
      latitude: prospect.latitude,
      longitude: prospect.longitude,
      detail:
        [prospect.prospect_type, prospect.specialty].filter(Boolean).join(" · ") || "Prospect",
      kind: "prospect" as const,
      specialty: prospect.specialty,
      priority:
        typeof prospect.metadata?.internal_priority === "number"
          ? prospect.metadata.internal_priority
          : null,
      relationshipStage: null,
      relationshipHealth: null,
      ownerName: null,
      lastTouchAt: null,
      nextAction: null,
      nextActionDueAt: null,
      fitStatus: prospect.fit_status,
      verificationStatus: prospect.verification_status,
      mapped: Number.isFinite(prospect.latitude) && Number.isFinite(prospect.longitude),
    }));
    return [...accounts, ...prospects];
  }, [data, offlineMapOffices]);

  const mapSelectedOffices = useMemo(
    () =>
      mapSelectedKeys
        .map((key) => mapOffices.find((office) => office.key === key))
        .filter(Boolean) as MapOffice[],
    [mapOffices, mapSelectedKeys],
  );

  useEffect(() => {
    if (!mapOffices.length) return;
    void saveHpoOfficeSnapshots(mapOffices).catch(() => undefined);
  }, [mapOffices]);

  function toggleMapRouteStop(office: MapOffice) {
    setSelectedMapOfficeKey(office.key);
    setMapSelectedKeys((current) =>
      current.includes(office.key)
        ? current.filter((key) => key !== office.key)
        : [...current, office.key].slice(0, 30),
    );
  }

  function selectManyMapOffices(keys: string[]) {
    if (!keys.length) return;
    setSelectedMapOfficeKey(keys[0] ?? null);
    setMapSelectedKeys((current) => [...new Set([...current, ...keys])].slice(0, 30));
  }

  function startRouteFromMap() {
    const stops = mapSelectedOffices.map((office) => ({
      key: office.key,
      accountId: office.accountId,
      prospectId: office.prospectId,
      officeName: office.officeName,
      address: office.address,
      city: office.city,
      latitude: office.latitude,
      longitude: office.longitude,
      detail: office.detail,
    }));
    setMapSeedStops(stops);
    setShowBuilder(true);
  }

  async function refreshOfficePins() {
    setMapPreparing(true);
    setError(null);
    try {
      await prepareOfficeMap({ data: { limit: 100 } });
      await refresh(activeRouteId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't refresh office map pins.");
    } finally {
      setMapPreparing(false);
    }
  }

  async function optimizeActive(routeId: string) {
    setOptimizing(true);
    setError(null);
    try {
      await optimize({ data: { routeId } });
      await refresh(routeId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't optimize this route.");
    } finally {
      setOptimizing(false);
    }
  }

  async function reoptimizeActiveRemaining(routeId: string) {
    setOptimizing(true);
    setError(null);
    try {
      let latitude: number | null = null;
      let longitude: number | null = null;
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        const point = await new Promise<{ latitude: number; longitude: number } | null>(
          (resolve) => {
            navigator.geolocation.getCurrentPosition(
              (position) =>
                resolve({
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                }),
              () => resolve(null),
              { enableHighAccuracy: true, maximumAge: 60000, timeout: 5000 },
            );
          },
        );
        latitude = point?.latitude ?? null;
        longitude = point?.longitude ?? null;
      }
      await reoptimizeRemaining({
        data: {
          routeId,
          latitude,
          longitude,
          idempotencyKey: `ui:${crypto.randomUUID()}:hpo.route.reoptimize`,
          sourceChannel: "ui",
        },
      });
      await refresh(routeId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't reoptimize the remaining route.");
    } finally {
      setOptimizing(false);
    }
  }

  async function addSelectedToActiveRoute() {
    if (!activeRoute || !mapSelectedOffices.length || working) return;
    setWorking(true);
    setError(null);
    try {
      await addStopsToRoute({
        data: {
          routeId: activeRoute.id,
          stops: mapSelectedOffices.map((office) => ({
            accountId: office.accountId ?? null,
            prospectId: office.prospectId ?? null,
            officeName: office.officeName,
            address: office.address,
            city: office.city ?? null,
            latitude: office.latitude ?? null,
            longitude: office.longitude ?? null,
          })),
          idempotencyKey: `ui:${crypto.randomUUID()}:hpo.route.add_stops`,
          sourceChannel: "ui",
        },
      });
      setMapSelectedKeys([]);
      setSelectedMapOfficeKey(null);
      await refresh(activeRoute.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't add those offices to the active route.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function removeOpenStop(route: RoutePlan, stopId: string) {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await removeStopFromRoute({
        data: {
          routeId: route.id,
          stopId,
          idempotencyKey: `ui:${crypto.randomUUID()}:hpo.route.remove_stop`,
          sourceChannel: "ui",
        },
      });
      await refresh(route.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove that stop.");
    } finally {
      setWorking(false);
    }
  }

  async function moveStop(route: RoutePlan, stopId: string, delta: number) {
    const ordered = [...route.stops].sort((a, b) => a.stop_order - b.stop_order);
    const index = ordered.findIndex((stop) => stop.id === stopId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    setWorking(true);
    try {
      await reorderStops({
        data: {
          routeId: route.id,
          stopIds: ordered.map((stop) => stop.id),
          idempotencyKey: `ui:${crypto.randomUUID()}:hpo.route.reorder`,
          sourceChannel: "ui",
        },
      });
      await refresh(route.id);
    } finally {
      setWorking(false);
    }
  }

  async function copyExcel(route: RoutePlan) {
    setError(null);
    try {
      const result = await exportTracker({ data: { routeId: route.id } });
      await navigator.clipboard.writeText(result.tsv);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't prepare the route tracker export.",
      );
    }
  }

  async function submitRouteNote(route: RoutePlan) {
    const message = routeNote.trim();
    if (!message || working) return;
    setWorking(true);
    setError(null);
    setRouteNoteResult(null);
    try {
      const result = await captureNote({ data: { routeId: route.id, message } });
      if ("needsClarification" in result && result.needsClarification) {
        setRouteNoteResult(result.question ?? "Which stop is this for?");
        return;
      }
      setRouteNote("");
      setRouteNoteResult(
        `Saved to stop ${"stopOrder" in result ? result.stopOrder : ""}: ${"officeName" in result ? result.officeName : "route stop"}`,
      );
      await refresh(route.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that route note.");
    } finally {
      setWorking(false);
    }
  }

  async function syncActiveRouteCalendar(route: RoutePlan) {
    setScheduleWorking(true);
    setError(null);
    setCalendarMessage(null);
    try {
      const result = await syncCalendar({
        data: {
          routeId: route.id,
          idempotencyKey: `ui:${crypto.randomUUID()}:hpo.route.sync_calendar`,
          sourceChannel: "ui",
        },
      });
      setCalendarMessage(
        result.calendarAction === "created"
          ? "Route block added to Emery Calendar."
          : "Route block updated in Emery Calendar.",
      );
      await refresh(route.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't update Calendar.");
    } finally {
      setScheduleWorking(false);
    }
  }

  async function askEmeryToFitRoute(route: RoutePlan) {
    setScheduleWorking(true);
    setError(null);
    setScheduleAdvice(null);
    try {
      const result = await askSchedule({ data: { routeId: route.id } });
      setScheduleAdvice(result.advice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Emery couldn't review the schedule.");
    } finally {
      setScheduleWorking(false);
    }
  }

  if (loading)
    return (
      <div className="emery-glass flex min-h-52 items-center justify-center rounded-[1.6rem] text-sm text-muted-foreground">
        Opening Route Planner…
      </div>
    );

  return (
    <div id="hpo-route-planner" className="space-y-4">
      <section className="border-b border-border/60 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Territory map</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Select offices to build or update a route.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="emery-press flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/55 text-muted-foreground"
            aria-label="Refresh routes"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setMapSeedStops([]);
              setShowBuilder(true);
            }}
            className="emery-press flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl bg-primary px-2 text-[10px] font-semibold text-primary-foreground"
          >
            <Plus className="size-4" /> New Route
          </button>
          <button
            type="button"
            onClick={() => activeRoute && void optimizeActive(activeRoute.id)}
            disabled={!activeRoute || optimizing}
            className="emery-press flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl border border-primary/20 bg-primary/[0.055] px-2 text-[10px] font-semibold text-primary disabled:opacity-45"
          >
            <Sparkles className="size-4" />
            {optimizing ? "Working…" : "Optimize All"}
          </button>
          <button
            type="button"
            onClick={() => activeRoute && void reoptimizeActiveRemaining(activeRoute.id)}
            disabled={!activeRoute || optimizing || !nextStop}
            className="emery-press flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl border border-primary/20 bg-primary/[0.055] px-2 text-[10px] font-semibold text-primary disabled:opacity-45"
          >
            <Navigation className="size-4" />
            Fix Remaining
          </button>
        </div>
      </section>

      {data || mapOffices.length ? (
        <HpoMapAdapter
          enabled={true}
          v1={
            <OfficePlanningMap
              offices={mapOffices}
              selectedKeys={mapSelectedKeys}
              selectedOfficeKey={selectedMapOfficeKey}
              onSelectOffice={setSelectedMapOfficeKey}
              onToggleRouteStop={toggleMapRouteStop}
              onBuildRoute={startRouteFromMap}
              preparing={mapPreparing}
              onRefreshPins={() => void refreshOfficePins()}
            />
          }
          offices={mapOffices}
          selectedKeys={mapSelectedKeys}
          selectedOfficeKey={selectedMapOfficeKey}
          route={activeRoute}
          onSelectOffice={setSelectedMapOfficeKey}
          onSelectMany={selectManyMapOffices}
          onOpenAccount={setMapAccountDetailId}
          onToggleRouteStop={toggleMapRouteStop}
          onBuildRoute={startRouteFromMap}
          preparing={mapPreparing}
          onRefreshPins={() => void refreshOfficePins()}
        />
      ) : null}

      {mapAccountDetailId ? (
        <HpoAccountFieldDetail
          accountId={mapAccountDetailId}
          onClose={() => setMapAccountDetailId(null)}
        />
      ) : null}

      {activeRoute && mapSelectedOffices.length ? (
        <section className="flex items-center gap-3 rounded-2xl border border-primary/16 bg-primary/[0.035] px-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">
              {mapSelectedOffices.length} selected for the active route
            </p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              Add them without rebuilding today's route.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void addSelectedToActiveRoute()}
            disabled={working}
            className="emery-press min-h-11 shrink-0 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            Add to Route
          </button>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {showBuilder && data ? (
        <div
          className="fixed inset-0 z-[75] flex items-end bg-background/60 backdrop-blur-[3px]"
          onClick={() => !working && setShowBuilder(false)}
          role="presentation"
        >
          <div
            className="emery-sheet-in max-h-[90dvh] w-full overflow-y-auto rounded-t-[1.7rem] border-t border-border/55 bg-background px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-24px_70px_rgba(0,0,0,0.42)] sm:mx-auto sm:max-w-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Build HPO daily route"
          >
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-border/80" />
            <RouteBuilder
              data={data}
              initialSelected={mapSeedStops}
              onClose={() => setShowBuilder(false)}
              onCreate={async (payload) => {
                setWorking(true);
                setError(null);
                try {
                  const result = await createRoute({ data: payload });
                  setShowBuilder(false);
                  setMapSelectedKeys([]);
                  setMapSeedStops([]);
                  try {
                    await optimize({ data: { routeId: result.routeId } });
                  } catch (optimizeCause) {
                    setError(
                      optimizeCause instanceof Error
                        ? `Route saved. ${optimizeCause.message}`
                        : "Route saved, but optimization needs attention.",
                    );
                  }
                  await refresh(result.routeId);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Couldn't create route.");
                } finally {
                  setWorking(false);
                }
              }}
              working={working}
            />
          </div>
        </div>
      ) : null}

      {data?.routes.length ? (
        <label className="block text-xs font-medium text-muted-foreground">
          Saved route
          <select
            value={activeRoute?.id ?? ""}
            onChange={(event) => setActiveRouteId(event.target.value)}
            className="mt-1 h-12 w-full rounded-xl border border-border/60 bg-card/55 px-3 text-base text-foreground outline-none focus:border-primary/35"
          >
            {data.routes.map((savedRoute) => {
              const completed = savedRoute.stops.filter((stop) =>
                terminalStatuses.has(stop.status),
              ).length;
              return (
                <option key={savedRoute.id} value={savedRoute.id}>
                  {formatDate(savedRoute.route_date)} · {savedRoute.area || "Marketing Route"} ·{" "}
                  {completed}/{savedRoute.stops.length}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}

      {activeRoute ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border/55 bg-card/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="emery-kicker">Daily Route Journal</p>
                <h3 className="mt-1.5 truncate text-lg font-semibold">{routeTitle(activeRoute)}</h3>
                <p className="mt-1 text-xs capitalize text-muted-foreground">
                  {activeRoute.status} · {activeRoute.stops.length} stops
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copyExcel(activeRoute)}
                className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.05] px-3 text-[11px] font-semibold text-primary"
              >
                {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
                {copied ? "Copied" : "Copy Tracker Rows"}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="Stops" value={String(activeRoute.stops.length)} />
              <Stat label="Drive" value={formatDuration(activeRoute.optimized_duration_seconds)} />
              <Stat label="Distance" value={formatMiles(activeRoute.optimized_distance_meters)} />
            </div>
            {activeRoute.start_window || activeRoute.end_window ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-xs">
                <Clock3 className="size-3.5 text-primary" />
                <span className="font-medium">
                  Route block: {activeRoute.start_window || "—"}–{activeRoute.end_window || "—"}
                </span>
              </div>
            ) : null}

            {activeRoute.start_address || activeRoute.end_address ? (
              <div className="mt-3 rounded-xl border border-border/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                {activeRoute.start_address ? <p>Start: {activeRoute.start_address}</p> : null}
                {activeRoute.end_address ? <p>End: {activeRoute.end_address}</p> : null}
              </div>
            ) : null}
          </div>

          <section className="overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.035] p-4">
            <p className="emery-kicker">Now</p>
            {nextStop ? (
              <>
                <div className="mt-2 flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
                    {nextStop.stop_order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">
                      {nextStop.office_name || "Next HPO stop"}
                    </h3>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {locationText(nextStop) || "Address not saved"}
                    </p>
                    {nextStop.drive_seconds_from_previous ? (
                      <p className="mt-1 text-[10px] font-medium text-primary">
                        {formatDuration(nextStop.drive_seconds_from_previous)} ·{" "}
                        {formatMiles(nextStop.distance_meters_from_previous)} from previous stop
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] font-medium text-primary">
                        Next unfinished stop on this route
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {nextStop.address ? (
                    <a
                      href={`https://maps.apple.com/?daddr=${encodeURIComponent([nextStop.address, nextStop.city].filter(Boolean).join(", "))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="emery-press flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.05] px-3 text-xs font-semibold text-primary"
                    >
                      <Navigation className="size-3.5" /> Navigate
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="min-h-11 rounded-xl border border-border/35 px-3 text-xs font-semibold text-muted-foreground opacity-40"
                    >
                      Address needed
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const element = document.getElementById(`route-stop-${nextStop.id}`);
                      element?.scrollIntoView({ behavior: "smooth", block: "center" });
                      window.setTimeout(() => {
                        element
                          ?.querySelector<HTMLButtonElement>("[data-route-note-toggle]")
                          ?.click();
                      }, 280);
                    }}
                    className="emery-press flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    <CheckCircle2 className="size-3.5" /> Log this visit
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Route complete</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Every stop on this route has a final status. Review notes or copy the tracker
                    rows.
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[1.55rem] border border-primary/15 bg-primary/[0.035] p-4">
            <div className="flex items-start gap-3">
              <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-2xl text-primary">
                <Sparkles className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Emery Route Notes</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Speak naturally: “Stop 2 — spoke with Jenni, she’ll pass the information to the
                  attorney. Follow up next week.” Emery attaches the raw note to the right stop.
                </p>
              </div>
            </div>
            <textarea
              value={routeNote}
              onChange={(event) => setRouteNote(event.target.value)}
              placeholder="What happened at the stop?"
              className="mt-3 min-h-24 w-full resize-none rounded-2xl border border-border/55 bg-card/55 px-3.5 py-3 text-[16px] leading-6 outline-none focus:border-primary/30"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 text-[11px] text-muted-foreground">
                {routeNoteResult ?? "Raw marketing note is preserved exactly as entered."}
              </p>
              <button
                type="button"
                disabled={!routeNote.trim() || working}
                onClick={() => void submitRouteNote(activeRoute)}
                className="emery-press flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              >
                <CheckCircle2 className="size-3.5" /> Save Note
              </button>
            </div>
          </section>

          <section className="rounded-[1.55rem] border border-border/45 bg-card/30 p-4">
            <div className="flex items-start gap-3">
              <div className="emery-icon-well flex size-10 shrink-0 items-center justify-center rounded-2xl text-primary">
                <CalendarDays className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Calendar fit</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Emery uses your saved Calendar for this date so the field route does not compete
                  with lunches, meetings or scheduled tasks.
                </p>
              </div>
            </div>

            {activeCalendar.length ? (
              <div className="mt-3 space-y-2">
                {activeCalendar.map((item) => (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className="emery-surface flex items-start gap-3 rounded-xl px-3 py-2.5"
                  >
                    <Clock3 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{item.title}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {item.local_time}
                        {item.local_end_time ? `–${item.local_end_time}` : ""} · {item.kind}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                No timed Emery Calendar items are saved for this date yet.
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void syncActiveRouteCalendar(activeRoute)}
                disabled={scheduleWorking || !activeRoute.start_window || !activeRoute.end_window}
                className="emery-press min-h-11 rounded-xl border border-primary/20 bg-primary/[0.055] px-3 text-[11px] font-semibold text-primary disabled:opacity-40"
              >
                Add / Update Calendar
              </button>
              <button
                type="button"
                onClick={() => void askEmeryToFitRoute(activeRoute)}
                disabled={scheduleWorking}
                className="emery-press min-h-11 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
              >
                {scheduleWorking ? "Working…" : "Ask Emery to Plan My Day"}
              </button>
            </div>

            {calendarMessage ? (
              <p className="mt-2 text-[11px] text-primary">{calendarMessage}</p>
            ) : null}
            {scheduleAdvice ? (
              <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-primary/15 bg-primary/[0.035] px-3.5 py-3 text-xs leading-5 text-foreground/88">
                {scheduleAdvice}
              </div>
            ) : null}
          </section>

          <div className="space-y-2">
            {[...activeRoute.stops]
              .sort((a, b) => a.stop_order - b.stop_order)
              .map((stop, index, ordered) => (
                <StopCard
                  key={`${stop.id}-${stop.updated_at}`}
                  stop={stop}
                  first={index === 0}
                  last={index === ordered.length - 1}
                  working={working}
                  onMove={(delta) => void moveStop(activeRoute, stop.id, delta)}
                  onRemove={() => void removeOpenStop(activeRoute, stop.id)}
                  onSave={async (input) => {
                    setWorking(true);
                    setError(null);
                    try {
                      await updateStop({
                        data: {
                          stopId: stop.id,
                          ...input,
                          idempotencyKey: `ui:${crypto.randomUUID()}:hpo.route_stop.log_visit`,
                          sourceChannel: "ui",
                        },
                      });
                      await refresh(activeRoute.id);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Couldn't save stop.");
                    } finally {
                      setWorking(false);
                    }
                  }}
                />
              ))}
          </div>
        </section>
      ) : (
        <section className="emery-glass rounded-[1.6rem] p-6 text-center">
          <MapPinned className="mx-auto size-7 text-primary" />
          <p className="mt-3 text-sm font-semibold">Your Route Journal starts here</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            Create today's stop list. Emery will preserve the daily route, optimized order and
            marketing notes so you can return to any field day later.
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="emery-surface rounded-xl px-2.5 py-2.5 text-center">
      <p className="text-sm font-semibold">{value}</p>
      <p className="mt-0.5 text-[9px] uppercase tracking-[0.09em] text-muted-foreground">{label}</p>
    </div>
  );
}

function RouteBuilder({
  data,
  initialSelected,
  onClose,
  onCreate,
  working,
}: {
  data: PlannerData;
  initialSelected: Candidate[];
  onClose: () => void;
  onCreate: (payload: {
    routeDate: string;
    area: string;
    startAddress: string;
    endAddress: string;
    startWindow: string;
    endWindow: string;
    syncToCalendar: boolean;
    notes: string;
    stops: Array<{
      accountId?: string | null;
      prospectId?: string | null;
      officeName: string;
      address: string;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      visitPriority?: string | null;
    }>;
  }) => Promise<void>;
  working: boolean;
}) {
  const [routeDate, setRouteDate] = useState(defaultRouteDate(data.today));
  const [area, setArea] = useState("");
  const [startAddress, setStartAddress] = useState("");
  const [endAddress, setEndAddress] = useState("");
  const [startWindow, setStartWindow] = useState("09:00");
  const [endWindow, setEndWindow] = useState("15:00");
  const [syncToCalendar, setSyncToCalendar] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Candidate[]>(initialSelected);
  const [customName, setCustomName] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [customCity, setCustomCity] = useState("");

  const dayCalendar = useMemo(
    () => data.calendar.filter((item) => item.local_date === routeDate),
    [data.calendar, routeDate],
  );

  const candidates = useMemo<Candidate[]>(() => {
    const accounts = data.accounts.map((account) => ({
      key: `account:${account.id}`,
      accountId: account.id,
      officeName: account.name,
      address: account.address,
      city: account.city,
      latitude: account.latitude,
      longitude: account.longitude,
      detail: [account.account_type, account.city, `P${account.priority}`]
        .filter(Boolean)
        .join(" · "),
    }));
    const prospects = data.prospects.map((prospect) => ({
      key: `prospect:${prospect.id}`,
      prospectId: prospect.id,
      officeName: prospect.name,
      address: prospect.address,
      city: prospect.city,
      latitude: prospect.latitude,
      longitude: prospect.longitude,
      detail: [prospect.prospect_type, prospect.city, prospect.verification_status]
        .filter(Boolean)
        .join(" · "),
    }));
    const query = search.trim().toLowerCase();
    return [...accounts, ...prospects]
      .filter((candidate) => !selected.some((item) => item.key === candidate.key))
      .filter((candidate) =>
        !query
          ? true
          : [candidate.officeName, candidate.address, candidate.city, candidate.detail]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(query),
      )
      .slice(0, 12);
  }, [data.accounts, data.prospects, search, selected]);

  function addCustom() {
    if (!customName.trim() || !customAddress.trim()) return;
    setSelected((current) => [
      ...current,
      {
        key: `custom:${Date.now()}:${current.length}`,
        officeName: customName.trim(),
        address: customAddress.trim(),
        city: customCity.trim() || null,
        detail: "Custom stop",
      },
    ]);
    setCustomName("");
    setCustomAddress("");
    setCustomCity("");
  }

  return (
    <section className="emery-glass rounded-[1.6rem] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="emery-kicker">New daily route</p>
          <h3 className="mt-1 text-lg font-semibold">Build the stop list first.</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Pick the date and time block around your Calendar, add offices in any order, then Emery
            will optimize the driving order.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="emery-press flex size-11 items-center justify-center rounded-xl text-muted-foreground"
          aria-label="Close route builder"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <input
          type="date"
          value={routeDate}
          onChange={(event) => setRouteDate(event.target.value)}
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-base outline-none focus:border-primary/30"
        />
        <input
          value={area}
          onChange={(event) => setArea(event.target.value)}
          placeholder="Area — e.g. Jersey City / Hoboken"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-base outline-none focus:border-primary/30"
        />
        <input
          type="time"
          value={startWindow}
          onChange={(event) => setStartWindow(event.target.value)}
          aria-label="Route start time"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-base outline-none focus:border-primary/30"
        />
        <input
          type="time"
          value={endWindow}
          onChange={(event) => setEndWindow(event.target.value)}
          aria-label="Route end time"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-base outline-none focus:border-primary/30"
        />
        <input
          value={startAddress}
          onChange={(event) => setStartAddress(event.target.value)}
          placeholder="Starting address (optional)"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-base outline-none focus:border-primary/30 sm:col-span-2"
        />
        <input
          value={endAddress}
          onChange={(event) => setEndAddress(event.target.value)}
          placeholder="Ending address (optional)"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-base outline-none focus:border-primary/30 sm:col-span-2"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.03] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold">Fit around Emery Calendar</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {dayCalendar.length
                ? `${dayCalendar.length} timed item${dayCalendar.length === 1 ? "" : "s"} on this date`
                : "No timed items saved for this date"}
            </p>
          </div>
          <label className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground">
            <input
              type="checkbox"
              checked={syncToCalendar}
              onChange={(event) => setSyncToCalendar(event.target.checked)}
              className="size-4 accent-current"
            />
            Add route block
          </label>
        </div>
        {dayCalendar.length ? (
          <div className="mt-2 space-y-1.5">
            {dayCalendar.slice(0, 6).map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="flex items-center gap-2 rounded-xl bg-card/45 px-2.5 py-2 text-[10px]"
              >
                <Clock3 className="size-3 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-muted-foreground">{item.local_time}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Add saved HPO offices
        </p>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search accounts, prospects, city or address"
            className="h-12 w-full rounded-xl border border-border/55 bg-card/55 pl-10 pr-3 text-base outline-none focus:border-primary/30"
          />
        </label>
        {search.trim() ? (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl border border-border/45 bg-card/35">
            {candidates.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                onClick={() => {
                  setSelected((current) => [...current, candidate]);
                  setSearch("");
                }}
                className="emery-press flex w-full items-start gap-3 border-b border-border/25 px-3.5 py-3 text-left last:border-b-0"
              >
                <Plus className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{candidate.officeName}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {candidate.address} · {candidate.detail}
                  </span>
                </span>
              </button>
            ))}
            {!candidates.length ? (
              <p className="px-4 py-5 text-center text-xs text-muted-foreground">
                No saved office matches.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-border/40 bg-card/25 p-3">
        <p className="text-xs font-semibold">Add an office that isn't saved yet</p>
        <div className="mt-2 grid gap-2">
          <input
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            placeholder="Office name"
            className="h-11 rounded-xl border border-border/50 bg-card/55 px-3 text-base outline-none focus:border-primary/30"
          />
          <input
            value={customAddress}
            onChange={(event) => setCustomAddress(event.target.value)}
            placeholder="Full street address"
            className="h-11 rounded-xl border border-border/50 bg-card/55 px-3 text-base outline-none focus:border-primary/30"
          />
          <div className="flex gap-2">
            <input
              value={customCity}
              onChange={(event) => setCustomCity(event.target.value)}
              placeholder="City"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border/50 bg-card/55 px-3 text-base outline-none focus:border-primary/30"
            />
            <button
              type="button"
              onClick={addCustom}
              disabled={!customName.trim() || !customAddress.trim()}
              className="emery-press min-h-11 rounded-xl border border-primary/20 bg-primary/[0.055] px-3 text-xs font-semibold text-primary disabled:opacity-40"
            >
              Add stop
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold">Planned stops · {selected.length}</p>
        {selected.length ? (
          <div className="mt-2 space-y-2">
            {selected.map((stop, index) => (
              <div
                key={stop.key}
                className="emery-surface flex items-center gap-3 rounded-xl px-3 py-2.5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-[10px] font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{stop.officeName}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {stop.address}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((current) => {
                        if (index <= 0) return current;
                        const next = [...current];
                        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                        return next;
                      })
                    }
                    disabled={index === 0}
                    className="emery-press flex size-11 items-center justify-center rounded-lg text-muted-foreground disabled:opacity-25"
                    aria-label={`Move ${stop.officeName} up`}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((current) => {
                        if (index >= current.length - 1) return current;
                        const next = [...current];
                        [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                        return next;
                      })
                    }
                    disabled={index === selected.length - 1}
                    className="emery-press flex size-11 items-center justify-center rounded-lg text-muted-foreground disabled:opacity-25"
                    aria-label={`Move ${stop.officeName} down`}
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((current) => current.filter((item) => item.key !== stop.key))
                    }
                    className="emery-press flex size-11 items-center justify-center rounded-lg text-muted-foreground"
                    aria-label={`Remove ${stop.officeName}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Add the offices you want to visit today.
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!routeDate || !selected.length || working}
        onClick={() =>
          void onCreate({
            routeDate,
            area,
            startAddress,
            endAddress,
            startWindow,
            endWindow,
            syncToCalendar,
            notes: "",
            stops: selected.map((stop) => ({
              accountId: stop.accountId ?? null,
              prospectId: stop.prospectId ?? null,
              officeName: stop.officeName,
              address: stop.address,
              city: stop.city ?? null,
              latitude: stop.latitude ?? null,
              longitude: stop.longitude ?? null,
            })),
          })
        }
        className="emery-press mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        <RouteIcon className="size-4" />
        {working ? "Creating route…" : "Create Daily Route"}
      </button>
    </section>
  );
}

function StopCard({
  stop,
  first,
  last,
  working,
  onMove,
  onRemove,
  onSave,
}: {
  stop: Stop;
  first: boolean;
  last: boolean;
  working: boolean;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onSave: (input: {
    status: string;
    notes: string;
    visitOutcome: string;
    nextAction: string;
    nextActionDueAt: string | null;
  }) => Promise<void>;
}) {
  const [status, setStatus] = useState(stop.status);
  const [notes, setNotes] = useState(stop.notes ?? "");
  const [visitOutcome, setVisitOutcome] = useState(stop.visit_outcome ?? "");
  const [nextAction, setNextAction] = useState(stop.next_action ?? "");
  const [expanded, setExpanded] = useState(false);

  const completed = terminalStatuses.has(status);
  const mapsHref = stop.address
    ? `https://maps.apple.com/?daddr=${encodeURIComponent([stop.address, stop.city].filter(Boolean).join(", "))}`
    : null;

  async function saveAndCollapse() {
    await onSave({
      status,
      notes,
      visitOutcome,
      nextAction,
      nextActionDueAt: null,
    });
    setExpanded(false);
  }

  return (
    <article
      id={`route-stop-${stop.id}`}
      data-expanded={expanded ? "true" : "false"}
      className={`scroll-mt-24 rounded-[1.45rem] border p-3.5 transition ${
        completed ? "border-primary/18 bg-primary/[0.03]" : "border-border/45 bg-card/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold ${
            completed ? "bg-primary text-primary-foreground" : "bg-primary/[0.075] text-primary"
          }`}
        >
          {stop.stop_order}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="break-words text-sm font-semibold">{stop.office_name || "Route stop"}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize ${
                completed ? "bg-primary/[0.1] text-primary" : "bg-muted/70 text-muted-foreground"
              }`}
            >
              {status.replaceAll("_", " ")}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {locationText(stop) || "Address not saved"}
          </p>
          {stop.drive_seconds_from_previous ? (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-primary/85">
              <Clock3 className="size-3" />
              {formatDuration(stop.drive_seconds_from_previous)} ·{" "}
              {formatMiles(stop.distance_meters_from_previous)} from previous
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={first || working}
            className="emery-press flex size-11 items-center justify-center rounded-xl border border-border/40 text-muted-foreground disabled:opacity-25"
            aria-label="Move stop up"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={last || working}
            className="emery-press flex size-11 items-center justify-center rounded-xl border border-border/40 text-muted-foreground disabled:opacity-25"
            aria-label="Move stop down"
          >
            <ArrowDown className="size-3.5" />
          </button>
          {!completed ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={working}
              className="emery-press flex size-11 items-center justify-center rounded-xl border border-destructive/20 text-destructive/80 disabled:opacity-25"
              aria-label="Remove stop from route"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {!expanded && (stop.notes || stop.visit_summary || stop.next_action) ? (
        <div className="mt-2 rounded-xl border border-border/30 bg-background/35 px-3 py-2">
          {stop.notes || stop.visit_summary ? (
            <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {stop.notes || stop.visit_summary}
            </p>
          ) : null}
          {stop.next_action ? (
            <p className="mt-1 truncate text-[10px] font-medium text-primary">
              Next: {stop.next_action}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="emery-press flex min-h-11 items-center gap-2 rounded-xl border border-border/45 px-3 text-[11px] font-semibold text-muted-foreground"
          >
            <Navigation className="size-3.5" /> Navigate
            <ExternalLink className="size-3" />
          </a>
        ) : null}
        <button
          type="button"
          data-route-note-toggle
          onClick={() => setExpanded((value) => !value)}
          className={`emery-press ml-auto min-h-11 rounded-xl px-3 text-[11px] font-semibold ${
            expanded
              ? "border border-border/45 text-muted-foreground"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {expanded ? "Close details" : stop.notes ? "Edit visit" : "Log visit"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 border-t border-border/30 pt-3">
          <div className="grid grid-cols-3 gap-1.5">
            {["planned", "completed", "closed", "bad_address", "skipped"].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`emery-press min-h-11 rounded-xl border px-2 text-[10px] font-semibold capitalize ${
                  status === value
                    ? "border-primary/25 bg-primary/[0.08] text-primary"
                    : "border-border/40 text-muted-foreground"
                }`}
              >
                {value.replaceAll("_", " ")}
              </button>
            ))}
          </div>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What happened at this office?"
            autoFocus
            className="mt-3 min-h-24 w-full resize-none rounded-xl border border-border/50 bg-card/50 px-3 py-2.5 text-[16px] leading-5 outline-none focus:border-primary/30"
          />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              value={visitOutcome}
              onChange={(event) => setVisitOutcome(event.target.value)}
              placeholder="Visit result"
              className="h-11 rounded-xl border border-border/50 bg-card/50 px-3 text-base outline-none focus:border-primary/30"
            />
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="Follow-up / next action"
              className="h-11 rounded-xl border border-border/50 bg-card/50 px-3 text-base outline-none focus:border-primary/30"
            />
          </div>

          <button
            type="button"
            disabled={working}
            onClick={() => void saveAndCollapse()}
            className="emery-press mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            <CheckCircle2 className="size-3.5" /> Save visit note
          </button>
        </div>
      ) : null}
    </article>
  );
}
