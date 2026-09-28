/* eslint-disable @typescript-eslint/no-explicit-any -- MapLibre events and persisted GeoJSON metadata are dynamically shaped. */
import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  MapGeoJSONFeature,
  StyleSpecification,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Building2,
  ChevronDown,
  List,
  LocateFixed,
  MapPinned,
  MessageCircle,
  Navigation,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { HpoMapOffice, HpoMapRoute } from "@/components/hpo-map/types";
import { openHpoEmery } from "@/components/HpoEmerySheet";
import "@/components/hpo-map/hpo-map-v2.css";

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);
const BLUE = "#1769e8";
const BLUE_DARK = "#0f4fb8";
const BLUE_LIGHT = "#dbeafe";

// Keep the production basemap self-contained. Loading a remote style document
// caused blank maps in privacy-restricted mobile browsers even when the tile
// provider itself was healthy. The standard OSM raster endpoint is no-key,
// renders the complete street/town context, and is requested directly here.
const PROFESSIONAL_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "hpo-map-background",
      type: "background",
      paint: { "background-color": "#e8edf3" },
    },
    {
      id: "hpo-street-basemap",
      type: "raster",
      source: "osm",
      paint: {
        "raster-opacity": 1,
        "raster-saturation": -0.04,
        "raster-contrast": 0.02,
      },
    },
  ],
};

type Props = {
  offices: HpoMapOffice[];
  selectedKeys: string[];
  selectedOfficeKey: string | null;
  route?: HpoMapRoute | null;
  onSelectOffice: (key: string) => void;
  onSelectMany?: (keys: string[]) => void;
  onOpenAccount?: (accountId: string) => void;
  onToggleRouteStop: (office: HpoMapOffice) => void;
  onBuildRoute: () => void;
  preparing: boolean;
  onRefreshPins: () => void;
  onNavigateHpo?: ((view: "today" | "map" | "accounts" | "activity") => void) | undefined;
  onFatalError?: (message: string) => void;
};

type Filter = "all" | "account" | "prospect";
type SignalFilter = "all" | "followup" | "stale" | "priority";

function officeCollection(
  offices: HpoMapOffice[],
  selected: Set<string>,
  focusedKey: string | null,
) {
  return {
    type: "FeatureCollection" as const,
    features: offices
      .filter(
        (office) =>
          office.mapped && Number.isFinite(office.latitude) && Number.isFinite(office.longitude),
      )
      .map((office) => ({
        type: "Feature" as const,
        id: office.key,
        geometry: {
          type: "Point" as const,
          coordinates: [Number(office.longitude), Number(office.latitude)],
        },
        properties: {
          key: office.key,
          kind: office.kind,
          officeName: office.officeName,
          selected: selected.has(office.key) ? 1 : 0,
          focused: office.key === focusedKey ? 1 : 0,
          priority: Number(office.priority ?? 0),
        },
      })),
  };
}

function routeCollection(route?: HpoMapRoute | null) {
  const remaining = Array.isArray(route?.metadata?.["route_geometry_remaining"])
    ? (route?.metadata?.["route_geometry_remaining"] as unknown[])
    : null;
  const full = Array.isArray(route?.metadata?.["route_geometry"])
    ? (route?.metadata?.["route_geometry"] as unknown[])
    : null;
  const raw = remaining && remaining.length >= 2 ? remaining : (full ?? []);
  let coordinates = raw
    .map((entry) =>
      Array.isArray(entry) && entry.length >= 2 ? [Number(entry[0]), Number(entry[1])] : null,
    )
    .filter(
      (entry): entry is [number, number] =>
        Boolean(entry) && Number.isFinite(entry![0]) && Number.isFinite(entry![1]),
    );

  if (coordinates.length < 2 && route) {
    coordinates = [
      ...(Number.isFinite(route.start_longitude) && Number.isFinite(route.start_latitude)
        ? [[Number(route.start_longitude), Number(route.start_latitude)] as [number, number]]
        : []),
      ...[...route.stops]
        .sort((a, b) => a.stop_order - b.stop_order)
        .filter((stop) => Number.isFinite(stop.longitude) && Number.isFinite(stop.latitude))
        .map((stop) => [Number(stop.longitude), Number(stop.latitude)] as [number, number]),
      ...(Number.isFinite(route.end_longitude) && Number.isFinite(route.end_latitude)
        ? [[Number(route.end_longitude), Number(route.end_latitude)] as [number, number]]
        : []),
    ];
  }

  return {
    type: "FeatureCollection" as const,
    features:
      coordinates.length >= 2
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates },
              properties: {},
            },
          ]
        : [],
  };
}

function routeStopsCollection(route?: HpoMapRoute | null) {
  const ordered = [...(route?.stops ?? [])].sort((a, b) => a.stop_order - b.stop_order);
  const current = ordered.find((stop) => !TERMINAL.has(stop.status))?.id ?? null;
  return {
    type: "FeatureCollection" as const,
    features: ordered
      .filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
      .map((stop) => ({
        type: "Feature" as const,
        id: stop.id,
        geometry: {
          type: "Point" as const,
          coordinates: [Number(stop.longitude), Number(stop.latitude)],
        },
        properties: {
          stopId: stop.id,
          order: stop.stop_order,
          status: stop.status,
          officeName: stop.office_name ?? "Route stop",
          completed: TERMINAL.has(stop.status) ? 1 : 0,
          current: stop.id === current ? 1 : 0,
        },
      })),
  };
}

function selectionCollection(points: Array<[number, number]>) {
  const geometry =
    points.length >= 3
      ? {
          type: "Polygon" as const,
          coordinates: [[...points, points[0]!]],
        }
      : points.length >= 2
        ? { type: "LineString" as const, coordinates: points }
        : null;
  return {
    type: "FeatureCollection" as const,
    features: geometry
      ? [
          {
            type: "Feature" as const,
            geometry,
            properties: {},
          },
        ]
      : [],
  };
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>) {
  if (polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isDue(office: HpoMapOffice, now: number) {
  return Boolean(
    office.kind === "account" &&
    office.nextActionDueAt &&
    !Number.isNaN(Date.parse(office.nextActionDueAt)) &&
    Date.parse(office.nextActionDueAt) <= now,
  );
}

function isStale(office: HpoMapOffice, now: number) {
  if (office.kind !== "account") return false;
  if (!office.lastTouchAt) return true;
  const parsed = Date.parse(office.lastTouchAt);
  return !Number.isNaN(parsed) && now - parsed >= 60 * 24 * 60 * 60 * 1000;
}

function createOfficePinElement({
  officeName,
  selected,
  focused,
  onSelect,
}: {
  officeName: string;
  selected: boolean;
  focused: boolean;
  onSelect: () => void;
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", officeName);
  button.title = officeName;
  button.style.width = selected || focused ? "36px" : "31px";
  button.style.height = selected || focused ? "44px" : "38px";
  button.style.border = "0";
  button.style.background = "transparent";
  button.style.padding = "0";
  button.style.cursor = "pointer";
  button.style.filter =
    selected || focused
      ? "drop-shadow(0 5px 8px rgba(15,23,42,.36))"
      : "drop-shadow(0 3px 6px rgba(15,23,42,.28))";
  button.style.transformOrigin = "50% 100%";
  button.style.transition = "transform 120ms ease, filter 120ms ease";
  button.innerHTML = `
    <svg viewBox="0 0 32 42" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path
        d="M16 1.5C8.1 1.5 2.25 7.48 2.25 15.23c0 10.22 10.54 20.48 12.93 22.7.46.43 1.18.43 1.64 0 2.39-2.22 12.93-12.48 12.93-22.7C29.75 7.48 23.9 1.5 16 1.5Z"
        fill="${focused ? BLUE_DARK : BLUE}"
        stroke="#ffffff"
        stroke-width="${selected || focused ? 2.6 : 2.2}"
      />
      <circle cx="16" cy="15.2" r="5.1" fill="#ffffff" />
      <circle cx="16" cy="15.2" r="2.15" fill="${focused ? BLUE_DARK : BLUE}" opacity=".22" />
    </svg>
  `;
  button.addEventListener("mouseenter", () => {
    button.style.transform = "translateY(-2px) scale(1.06)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.transform = "";
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onSelect();
  });
  return button;
}

function boundsForOffices(offices: HpoMapOffice[]) {
  const points = offices.filter(
    (office) =>
      office.mapped && Number.isFinite(office.latitude) && Number.isFinite(office.longitude),
  );
  if (!points.length) return null;
  const bounds = new maplibregl.LngLatBounds();
  for (const office of points) {
    bounds.extend([Number(office.longitude), Number(office.latitude)]);
  }
  return bounds;
}

function setupSourcesAndLayers(map: MapLibreMap) {
  if (!map.getSource("hpo-offices")) {
    map.addSource("hpo-offices", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("hpo-route-line")) {
    map.addSource("hpo-route-line", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("hpo-route-stops")) {
    map.addSource("hpo-route-stops", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource("hpo-selection-area")) {
    map.addSource("hpo-selection-area", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer("hpo-route-casing")) {
    map.addLayer({
      id: "hpo-route-casing",
      type: "line",
      source: "hpo-route-line",
      paint: {
        "line-color": "#ffffff",
        "line-width": 7,
        "line-opacity": 0.98,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }
  if (!map.getLayer("hpo-route-line-layer")) {
    map.addLayer({
      id: "hpo-route-line-layer",
      type: "line",
      source: "hpo-route-line",
      paint: {
        "line-color": BLUE,
        "line-width": 4,
        "line-opacity": 0.95,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }

  if (!map.getLayer("hpo-selection-fill")) {
    map.addLayer({
      id: "hpo-selection-fill",
      type: "fill",
      source: "hpo-selection-area",
      paint: {
        "fill-color": BLUE,
        "fill-opacity": 0.08,
      },
    });
  }
  if (!map.getLayer("hpo-selection-line")) {
    map.addLayer({
      id: "hpo-selection-line",
      type: "line",
      source: "hpo-selection-area",
      paint: {
        "line-color": BLUE,
        "line-width": 2.5,
        "line-dasharray": [2, 1.5],
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }

  if (!map.getLayer("hpo-office-points")) {
    map.addLayer({
      id: "hpo-office-points",
      type: "circle",
      source: "hpo-offices",
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "selected"], 1],
          10,
          ["==", ["get", "focused"], 1],
          9,
          7,
        ],
        "circle-color": BLUE,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
        "circle-opacity": 0,
      },
    });
  }
  if (!map.getLayer("hpo-office-selected-ring")) {
    map.addLayer({
      id: "hpo-office-selected-ring",
      type: "circle",
      source: "hpo-offices",
      filter: ["==", ["get", "selected"], 1],
      paint: {
        "circle-radius": 14,
        "circle-color": "rgba(23,105,232,0.10)",
        "circle-stroke-color": BLUE_DARK,
        "circle-stroke-width": 0,
      },
    });
  }
  if (!map.getLayer("hpo-office-focused-ring")) {
    map.addLayer({
      id: "hpo-office-focused-ring",
      type: "circle",
      source: "hpo-offices",
      filter: ["==", ["get", "focused"], 1],
      paint: {
        "circle-radius": 17,
        "circle-color": "rgba(23,105,232,0.05)",
        "circle-stroke-color": BLUE_DARK,
        "circle-stroke-width": 3,
        "circle-stroke-opacity": 0.6,
      },
    });
  }

  if (!map.getLayer("hpo-current-stop-halo")) {
    map.addLayer({
      id: "hpo-current-stop-halo",
      type: "circle",
      source: "hpo-route-stops",
      filter: ["==", ["get", "current"], 1],
      paint: {
        "circle-radius": 17,
        "circle-color": BLUE_LIGHT,
        "circle-opacity": 0.65,
        "circle-stroke-color": BLUE_DARK,
        "circle-stroke-width": 2,
      },
    });
  }
  if (!map.getLayer("hpo-route-stop-points")) {
    map.addLayer({
      id: "hpo-route-stop-points",
      type: "circle",
      source: "hpo-route-stops",
      paint: {
        "circle-radius": ["case", ["==", ["get", "current"], 1], 11, 9],
        "circle-color": [
          "case",
          ["==", ["get", "current"], 1],
          BLUE_DARK,
          ["==", ["get", "completed"], 1],
          "#8ab8f5",
          BLUE,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
        "circle-opacity": ["case", ["==", ["get", "status"], "skipped"], 0.5, 1],
      },
    });
  }
}

function featureKey(feature: MapGeoJSONFeature | undefined) {
  return String(feature?.properties?.["key"] ?? "");
}

export function HpoMapV2MapLibre({
  offices,
  selectedKeys,
  selectedOfficeKey,
  route,
  onSelectOffice,
  onSelectMany,
  onOpenAccount,
  onToggleRouteStop,
  onBuildRoute,
  preparing,
  onRefreshPins,
  onNavigateHpo,
  onFatalError,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const officeMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all");
  const [query, setQuery] = useState("");
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState<Array<[number, number]>>([]);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [showTools, setShowTools] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const now = Date.now();
    return offices.filter((office) => {
      if (!office.mapped || !Number.isFinite(office.latitude) || !Number.isFinite(office.longitude))
        return false;
      if (filter !== "all" && office.kind !== filter) return false;
      if (signalFilter === "followup" && !isDue(office, now)) return false;
      if (signalFilter === "stale" && !isStale(office, now)) return false;
      if (signalFilter === "priority" && Number(office.priority ?? 0) < 4) return false;
      if (!needle) return true;
      return [office.officeName, office.address, office.city, office.specialty, office.detail]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, offices, query, signalFilter]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedOffice =
    offices.find((office) => office.key === selectedOfficeKey) ??
    offices.find((office) => selectedSet.has(office.key)) ??
    null;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    try {
      maplibregl.setWorkerUrl(maplibreWorkerUrl);
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: PROFESSIONAL_MAP_STYLE,
        center: [-74.3, 40.5],
        zoom: 8,
        minZoom: 5,
        maxZoom: 18,
        attributionControl: {},
        cooperativeGestures: false,
      });
      mapRef.current = map;

      map.on("style.load", () => {
        setupSourcesAndLayers(map);
        setReady(true);
        requestAnimationFrame(() => map.resize());
      });
      map.on("error", (event: any) => {
        const message = String(event?.error?.message ?? "");
        if (/webgl|context|initial/i.test(message)) {
          onFatalError?.(message || "MapLibre could not initialize.");
        }
      });

      const resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);
      return () => {
        resizeObserver.disconnect();
        for (const marker of officeMarkersRef.current.values()) marker.remove();
        officeMarkersRef.current.clear();
        map.remove();
        mapRef.current = null;
      };
    } catch (error) {
      onFatalError?.(error instanceof Error ? error.message : "MapLibre could not initialize.");
      return undefined;
    }
  }, [onFatalError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || viewMode !== "map") return;
    requestAnimationFrame(() => map.resize());
  }, [ready, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("hpo-offices") as GeoJSONSource | undefined;
    source?.setData(officeCollection(filtered, selectedSet, selectedOfficeKey) as any);
  }, [filtered, ready, selectedOfficeKey, selectedSet]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const marker of officeMarkersRef.current.values()) marker.remove();
    officeMarkersRef.current.clear();

    for (const office of filtered) {
      if (!Number.isFinite(office.longitude) || !Number.isFinite(office.latitude)) continue;

      const selected = selectedSet.has(office.key);
      const focused = office.key === selectedOfficeKey;
      const element = createOfficePinElement({
        officeName: office.officeName,
        selected,
        focused,
        onSelect: () => onSelectOffice(office.key),
      });

      const marker = new maplibregl.Marker({
        element,
        anchor: "bottom",
        offset: [0, 1],
      })
        .setLngLat([Number(office.longitude), Number(office.latitude)])
        .addTo(map);

      officeMarkersRef.current.set(office.key, marker);
    }

    return () => {
      for (const marker of officeMarkersRef.current.values()) marker.remove();
      officeMarkersRef.current.clear();
    };
  }, [filtered, onSelectOffice, ready, selectedOfficeKey, selectedSet]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("hpo-route-line") as GeoJSONSource | undefined)?.setData(
      routeCollection(route) as any,
    );
    (map.getSource("hpo-route-stops") as GeoJSONSource | undefined)?.setData(
      routeStopsCollection(route) as any,
    );
  }, [ready, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("hpo-selection-area") as GeoJSONSource | undefined)?.setData(
      selectionCollection(drawPoints) as any,
    );
    if (drawMode) {
      map.dragPan.disable();
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = "crosshair";
    } else {
      map.dragPan.enable();
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = "";
    }
  }, [drawMode, drawPoints, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const officeClick = (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      if (drawMode) return;
      const key = featureKey(event.features?.[0]);
      if (!key) return;
      onSelectOffice(key);
    };
    const drawClick = (event: MapMouseEvent) => {
      if (!drawMode) return;
      setDrawPoints((current) => [...current, [event.lngLat.lng, event.lngLat.lat]]);
    };

    for (const layer of [
      "hpo-office-points",
      "hpo-office-selected-ring",
      "hpo-office-focused-ring",
    ]) {
      map.on("click", layer, officeClick);
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    map.on("click", drawClick);

    return () => {
      for (const layer of [
        "hpo-office-points",
        "hpo-office-selected-ring",
        "hpo-office-focused-ring",
      ]) {
        map.off("click", layer, officeClick);
      }
      map.off("click", drawClick);
    };
  }, [drawMode, onSelectOffice, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedOffice) return;
    if (!Number.isFinite(selectedOffice.longitude) || !Number.isFinite(selectedOffice.latitude))
      return;
    map.easeTo({
      center: [Number(selectedOffice.longitude), Number(selectedOffice.latitude)],
      zoom: Math.max(map.getZoom(), 13.5),
      duration: 420,
    });
  }, [ready, selectedOffice]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bounds = boundsForOffices(filtered);
    if (!bounds || bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 50, maxZoom: 13.2, duration: 350 });
  }, [filtered, ready]);

  function zoomBy(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: Math.max(5, Math.min(18, map.getZoom() + delta)), duration: 180 });
  }

  function locateMe() {
    const map = mapRef.current;
    if (!map || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.easeTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: Math.max(map.getZoom(), 12.8),
          duration: 420,
        });
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 5000 },
    );
  }

  function startDraw() {
    setDrawPoints([]);
    setDrawMode(true);
  }

  function cancelDraw() {
    setDrawMode(false);
    setDrawPoints([]);
  }

  function finishDraw() {
    if (drawPoints.length < 3) return;
    const keys = filtered
      .filter(
        (office) =>
          Number.isFinite(office.longitude) &&
          Number.isFinite(office.latitude) &&
          pointInPolygon([Number(office.longitude), Number(office.latitude)], drawPoints),
      )
      .map((office) => office.key);
    if (keys.length) onSelectMany?.(keys);
    setDrawMode(false);
    setDrawPoints([]);
  }

  function fitRoute() {
    const map = mapRef.current;
    if (!map || !route) return;
    const coords = route.stops
      .filter((stop) => Number.isFinite(stop.longitude) && Number.isFinite(stop.latitude))
      .map((stop) => [Number(stop.longitude), Number(stop.latitude)] as [number, number]);
    if (Number.isFinite(route.start_longitude) && Number.isFinite(route.start_latitude))
      coords.unshift([Number(route.start_longitude), Number(route.start_latitude)]);
    if (Number.isFinite(route.end_longitude) && Number.isFinite(route.end_latitude))
      coords.push([Number(route.end_longitude), Number(route.end_latitude)]);
    if (!coords.length) return;
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach((coord) => bounds.extend(coord));
    map.fitBounds(bounds, { padding: 58, maxZoom: 14, duration: 420 });
  }

  const totalMapped = offices.filter((office) => office.mapped).length;

  return (
    <section className="hpo-map-v2 relative h-full min-h-0 w-full overflow-hidden bg-[#eef2f7] text-slate-950">
      <div
        ref={containerRef}
        className={`absolute inset-0 bg-[#eef2f7] ${viewMode === "map" ? "block" : "hidden"}`}
      />

      {viewMode === "map" ? (
        <>
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 px-3 pt-3">
            <div className="pointer-events-auto mx-auto flex h-[52px] max-w-2xl items-center gap-2 rounded-[1.05rem] border border-white/80 bg-white/96 px-3 shadow-[0_8px_26px_rgba(15,23,42,0.2)] backdrop-blur-xl">
              <Search className="size-[19px] shrink-0 text-[#1769e8]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search HPO accounts, offices or towns"
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
                  aria-label="Clear map search"
                >
                  <X className="size-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShowTools((value) => !value)}
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                  showTools ? "bg-blue-50 text-[#1769e8]" : "text-slate-600 hover:bg-slate-100"
                }`}
                aria-label="Map filters"
              >
                <SlidersHorizontal className="size-[18px]" />
              </button>
            </div>

            <div className="pointer-events-auto mx-auto mt-2 flex max-w-2xl gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => onNavigateHpo?.("today")}
                className="min-h-10 shrink-0 rounded-full border border-white/80 bg-white/96 px-4 text-[12px] font-semibold text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.14)]"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  if (route?.stops?.length) {
                    fitRoute();
                    setSheetExpanded(true);
                  } else {
                    onBuildRoute();
                  }
                }}
                className="min-h-10 shrink-0 rounded-full border border-white/80 bg-white/96 px-4 text-[12px] font-semibold text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.14)]"
              >
                Route
              </button>
              <button
                type="button"
                onClick={() => onNavigateHpo?.("accounts")}
                className="min-h-10 shrink-0 rounded-full border border-white/80 bg-white/96 px-4 text-[12px] font-semibold text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.14)]"
              >
                Accounts
              </button>
              <button
                type="button"
                onClick={locateMe}
                className="min-h-10 shrink-0 rounded-full border border-white/80 bg-white/96 px-4 text-[12px] font-semibold text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.14)]"
              >
                Nearby
              </button>
              <button
                type="button"
                onClick={() =>
                  setSignalFilter((current) => (current === "followup" ? "all" : "followup"))
                }
                className={`min-h-10 shrink-0 rounded-full border px-4 text-[12px] font-semibold shadow-[0_4px_14px_rgba(15,23,42,0.14)] ${
                  signalFilter === "followup"
                    ? "border-[#1769e8] bg-[#1769e8] text-white"
                    : "border-white/80 bg-white/96 text-slate-700"
                }`}
              >
                Follow-up Due
              </button>
            </div>

            {showTools ? (
              <div className="pointer-events-auto mx-auto mt-2 max-w-2xl rounded-2xl border border-white/80 bg-white/97 p-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.2)] backdrop-blur-xl">
                <div className="grid grid-cols-3 gap-1.5">
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
                      className={`min-h-10 rounded-xl text-[11px] font-semibold ${
                        filter === value ? "bg-[#1769e8] text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ["all", "Any status"],
                      ["followup", "Follow-up due"],
                      ["stale", "Stale 60d+"],
                      ["priority", "High priority"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSignalFilter(value)}
                      className={`min-h-10 rounded-xl text-[11px] font-semibold ${
                        signalFilter === value
                          ? "bg-blue-50 text-[#1769e8]"
                          : "bg-slate-50 text-slate-500"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      startDraw();
                      setShowTools(false);
                    }}
                    className="min-h-10 rounded-xl border border-blue-200 bg-white text-[11px] font-semibold text-[#1769e8]"
                  >
                    Select Area
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRefreshPins()}
                    disabled={preparing}
                    className="min-h-10 rounded-xl border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 disabled:opacity-40"
                  >
                    {preparing ? "Updating…" : `${totalMapped} mapped`}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {drawMode ? (
            <div className="absolute left-3 top-[9.8rem] z-30 flex items-center gap-1 rounded-2xl border border-white/80 bg-white/96 p-1.5 shadow-xl backdrop-blur-xl">
              <span className="px-2 text-[10px] font-semibold text-slate-600">
                Tap around the offices
              </span>
              <button
                type="button"
                onClick={finishDraw}
                disabled={drawPoints.length < 3}
                className="min-h-10 rounded-xl bg-[#1769e8] px-3 text-[10px] font-semibold text-white disabled:opacity-40"
              >
                {drawPoints.length >= 3 ? "Select area" : `${3 - drawPoints.length} more`}
              </button>
              <button
                type="button"
                onClick={cancelDraw}
                className="flex size-10 items-center justify-center rounded-xl text-slate-500"
                aria-label="Cancel area selection"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}

          <div className="absolute right-3 top-[9.8rem] z-20 flex flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/96 shadow-[0_8px_24px_rgba(15,23,42,0.18)] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => zoomBy(1)}
              className="flex size-11 items-center justify-center border-b border-slate-200 text-xl font-medium text-slate-700"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoomBy(-1)}
              className="flex size-11 items-center justify-center text-2xl font-light text-slate-700"
              aria-label="Zoom out"
            >
              −
            </button>
          </div>

          <button
            type="button"
            onClick={locateMe}
            className="absolute right-3 top-[15.8rem] z-20 flex size-11 items-center justify-center rounded-2xl border border-white/80 bg-white/96 text-[#1769e8] shadow-[0_8px_24px_rgba(15,23,42,0.18)] backdrop-blur-xl"
            aria-label="Center on my location"
          >
            <LocateFixed className="size-5" />
          </button>

          <button
            type="button"
            onClick={() => setViewMode("list")}
            className="absolute right-3 top-[19.2rem] z-20 flex size-11 items-center justify-center rounded-2xl border border-white/80 bg-white/96 text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.18)] backdrop-blur-xl"
            aria-label="Open office list"
          >
            <List className="size-5" />
          </button>
        </>
      ) : null}

      {viewMode === "list" ? (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#f6f8fb]">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-3">
            <button
              type="button"
              onClick={() => setViewMode("map")}
              className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700"
              aria-label="Back to map"
            >
              <MapPinned className="size-5" />
            </button>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search HPO offices"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-base text-slate-900 outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 text-[11px] font-semibold text-slate-500">
              {filtered.length} matching offices
            </p>
            <div className="space-y-2">
              {filtered.map((office) => {
                const selected = selectedSet.has(office.key);
                return (
                  <div
                    key={office.key}
                    className={`flex min-h-[64px] w-full items-center gap-2 rounded-2xl border bg-white px-2 py-2 shadow-sm ${
                      selected ? "border-[#1769e8]" : "border-slate-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectOffice(office.key);
                        setViewMode("map");
                        setSheetExpanded(true);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 px-1 text-left"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#1769e8]">
                        <MapPinned className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">
                          {office.officeName}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                          {[office.address, office.city].filter(Boolean).join(", ")}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleRouteStop(office)}
                      className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${
                        selected ? "bg-[#1769e8] text-white" : "bg-blue-50 text-[#1769e8]"
                      }`}
                      aria-label={`${selected ? "Remove" : "Add"} ${office.officeName} ${selected ? "from" : "to"} today's route`}
                    >
                      {selected ? "✓" : "+"}
                    </button>
                  </div>
                );
              })}
            </div>
            {selectedKeys.length ? (
              <div className="sticky bottom-2 mt-3 rounded-2xl border border-blue-200 bg-white p-2 shadow-xl">
                <button
                  type="button"
                  onClick={onBuildRoute}
                  className="min-h-12 w-full rounded-xl bg-[#1769e8] px-4 text-sm font-semibold text-white"
                >
                  Review Route · {selectedKeys.length} selected
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {viewMode === "map" ? (
        <div
          className={`absolute bottom-0 left-0 right-0 z-30 rounded-t-[1.7rem] border-t border-white/80 bg-white/97 shadow-[0_-12px_34px_rgba(15,23,42,0.2)] backdrop-blur-xl transition-[height] duration-200 ${
            sheetExpanded || selectedOffice ? "h-[250px]" : "h-[108px]"
          }`}
        >
          <button
            type="button"
            onClick={() => setSheetExpanded((value) => !value)}
            className="absolute left-1/2 top-2 z-10 h-1.5 w-11 -translate-x-1/2 rounded-full bg-slate-300"
            aria-label={sheetExpanded ? "Collapse map sheet" : "Expand map sheet"}
          />
          {selectedOffice ? (
            <div className="h-full px-4 pb-4 pt-5">
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#1769e8]">
                  <MapPinned className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-[16px] font-bold text-slate-950">
                      {selectedOffice.officeName}
                    </h3>
                    <button
                      type="button"
                      onClick={() => onSelectOffice("")}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                      aria-label="Clear selected office"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-slate-500">
                    {[selectedOffice.address, selectedOffice.city].filter(Boolean).join(", ")}
                  </p>
                  {selectedOffice.nextAction ? (
                    <p className="mt-1 truncate text-[11px] text-slate-600">
                      Next: {selectedOffice.nextAction}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <a
                  href={`https://maps.apple.com/?q=${encodeURIComponent(
                    [selectedOffice.officeName, selectedOffice.address, selectedOffice.city]
                      .filter(Boolean)
                      .join(", "),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-slate-100 text-[10px] font-semibold text-slate-700"
                >
                  <Navigation className="size-4" /> Navigate
                </a>
                {selectedOffice.accountId ? (
                  <button
                    type="button"
                    onClick={() => onOpenAccount?.(selectedOffice.accountId!)}
                    className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-slate-100 text-[10px] font-semibold text-slate-700"
                  >
                    <Building2 className="size-4" /> Account
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      openHpoEmery(
                        `Add ${selectedOffice.officeName} as an HPO account.`,
                        selectedOffice.officeName,
                      )
                    }
                    className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-slate-100 text-[10px] font-semibold text-slate-700"
                  >
                    <Plus className="size-4" /> Account
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (route?.stops?.length) {
                      openHpoEmery(
                        `Add ${selectedOffice.officeName} at ${[
                          selectedOffice.address,
                          selectedOffice.city,
                        ]
                          .filter(Boolean)
                          .join(", ")} to today's HPO route.`,
                        selectedOffice.officeName,
                      );
                    } else {
                      onToggleRouteStop(selectedOffice);
                    }
                  }}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${
                    selectedSet.has(selectedOffice.key)
                      ? "bg-[#1769e8] text-white"
                      : "bg-blue-50 text-[#1769e8]"
                  }`}
                >
                  <MapPinned className="size-4" />
                  {route?.stops?.length
                    ? "Route"
                    : selectedSet.has(selectedOffice.key)
                      ? "Selected"
                      : "Select"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openHpoEmery(
                      `I'm looking at ${selectedOffice.officeName}. Help me with this HPO relationship, route stop, visit, notes, or follow-up.`,
                      selectedOffice.officeName,
                    )
                  }
                  className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-[#1769e8] text-[10px] font-semibold text-white"
                >
                  <MessageCircle className="size-4" /> Emery
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center px-4 pb-3 pt-5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-950">
                    {selectedKeys.length
                      ? `${selectedKeys.length} selected for today's route`
                      : route?.stops?.length
                        ? `${route.stops.length} stops on today's route`
                        : "No route yet today"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {selectedKeys.length
                      ? "Choose more offices or review and optimize the route."
                      : `Tap a blue pin or search ${totalMapped} mapped offices.`}
                  </p>
                </div>
                {!sheetExpanded ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedKeys.length) onBuildRoute();
                      else
                        openHpoEmery(
                          "Help me with the HPO map. I can add offices, build or change my route, review nearby accounts, or log a visit.",
                          "HPO Map",
                        );
                    }}
                    className="flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-[#1769e8] px-4 text-[12px] font-semibold text-white shadow-sm"
                  >
                    {selectedKeys.length ? (
                      <>
                        <MapPinned className="size-4" /> Review
                      </>
                    ) : (
                      <>
                        <MessageCircle className="size-4" /> Emery
                      </>
                    )}
                  </button>
                ) : null}
              </div>
              {sheetExpanded ? (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigateHpo?.("today")}
                    className="min-h-12 rounded-xl bg-slate-100 text-[11px] font-semibold text-slate-700"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={onBuildRoute}
                    className="min-h-12 rounded-xl bg-blue-50 text-[11px] font-semibold text-[#1769e8]"
                  >
                    New Route
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openHpoEmery(
                        "Help me with the HPO map. I can add offices, build or change my route, review nearby accounts, or log a visit.",
                        "HPO Map",
                      )
                    }
                    className="min-h-12 rounded-xl bg-[#1769e8] text-[11px] font-semibold text-white"
                  >
                    Emery
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
