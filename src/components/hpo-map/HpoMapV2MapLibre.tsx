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
import "maplibre-gl/dist/maplibre-gl.css";
import { Check, List, LocateFixed, Map as MapIcon, MapPinned, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import type { HpoMapOffice, HpoMapRoute } from "@/components/hpo-map/types";
import "@/components/hpo-map/hpo-map-v2.css";

const TERMINAL = new Set(["completed", "visited", "skipped", "closed", "bad_address"]);
const BLUE = "#1769e8";
const BLUE_DARK = "#0f4fb8";
const BLUE_LIGHT = "#dbeafe";

const LIGHT_EMERY_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "emery-light-basemap",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -1,
        "raster-contrast": -0.16,
        "raster-brightness-min": 0.62,
        "raster-brightness-max": 1,
        "raster-opacity": 0.92,
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

function createPinImage(fill: string, stroke = "#ffffff") {
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = 44 * scale;
  canvas.height = 54 * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(22, 52);
  ctx.bezierCurveTo(18, 44, 7, 34, 7, 22);
  ctx.bezierCurveTo(7, 10, 13, 3, 22, 3);
  ctx.bezierCurveTo(31, 3, 37, 10, 37, 22);
  ctx.bezierCurveTo(37, 34, 26, 44, 22, 52);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(22, 21, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function setupSourcesAndLayers(map: MapLibreMap) {
  if (!map.hasImage("hpo-blue-pin")) {
    const image = createPinImage(BLUE);
    if (image) map.addImage("hpo-blue-pin", image, { pixelRatio: 2 });
  }
  if (!map.hasImage("hpo-blue-active-pin")) {
    const image = createPinImage(BLUE_DARK);
    if (image) map.addImage("hpo-blue-active-pin", image, { pixelRatio: 2 });
  }
  if (!map.getSource("hpo-offices")) {
    map.addSource("hpo-offices", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 13,
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
        "line-opacity": 0.95,
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
        "line-opacity": 0.9,
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
        "fill-opacity": 0.1,
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

  if (!map.getLayer("hpo-office-clusters")) {
    map.addLayer({
      id: "hpo-office-clusters",
      type: "circle",
      source: "hpo-offices",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": BLUE,
        "circle-radius": ["step", ["get", "point_count"], 17, 10, 20, 30, 23, 75, 27],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
        "circle-opacity": 0.94,
      },
    });
  }
  if (!map.getLayer("hpo-office-cluster-count")) {
    map.addLayer({
      id: "hpo-office-cluster-count",
      type: "symbol",
      source: "hpo-offices",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
        "text-font": ["Noto Sans Regular"],
      },
      paint: {
        "text-color": [
          "case",
          ["in", ["get", "status"], ["literal", ["closed", "bad_address", "skipped"]]],
          "#334155",
          "#ffffff",
        ],
      },
    });
  }

  if (!map.getLayer("hpo-office-points")) {
    map.addLayer({
      id: "hpo-office-points",
      type: "circle",
      source: "hpo-offices",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "account"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 14, 11],
        "circle-color": BLUE,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
        "circle-opacity": 0.92,
      },
    });
  }
  if (!map.getLayer("hpo-prospect-points")) {
    map.addLayer({
      id: "hpo-prospect-points",
      type: "circle",
      source: "hpo-offices",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "prospect"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 14, 11],
        "circle-color": BLUE,
        "circle-stroke-color": BLUE,
        "circle-stroke-width": 3,
        "circle-opacity": 0.92,
        "circle-stroke-opacity": 1,
      },
    });
  }
  if (!map.getLayer("hpo-office-centers")) {
    map.addLayer({
      id: "hpo-office-centers",
      type: "circle",
      source: "hpo-offices",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 3.6,
        "circle-color": "#ffffff",
        "circle-opacity": 0.92,
      },
    });
  }

  if (!map.getLayer("hpo-office-pin-symbols")) {
    map.addLayer({
      id: "hpo-office-pin-symbols",
      type: "symbol",
      source: "hpo-offices",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": "hpo-blue-pin",
        "icon-size": ["case", ["==", ["get", "selected"], 1], 1.12, 0.96],
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
      },
    });
  }

  if (!map.getLayer("hpo-office-priority-ring")) {
    map.addLayer({
      id: "hpo-office-priority-ring",
      type: "circle",
      source: "hpo-offices",
      filter: [
        "all",
        ["!", ["has", "point_count"]],
        [">=", ["coalesce", ["get", "priority"], 0], 4],
      ],
      paint: {
        "circle-radius": 11,
        "circle-color": "rgba(23,105,232,0)",
        "circle-stroke-color": BLUE_DARK,
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0.45,
      },
    });
  }

  if (!map.getLayer("hpo-office-selected-ring")) {
    map.addLayer({
      id: "hpo-office-selected-ring",
      type: "circle",
      source: "hpo-offices",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "selected"], 1]],
      paint: {
        "circle-radius": 13,
        "circle-color": "rgba(23,105,232,0.08)",
        "circle-stroke-color": BLUE,
        "circle-stroke-width": 2,
      },
    });
  }
  if (!map.getLayer("hpo-office-focused-ring")) {
    map.addLayer({
      id: "hpo-office-focused-ring",
      type: "circle",
      source: "hpo-offices",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "focused"], 1]],
      paint: {
        "circle-radius": 16,
        "circle-color": "rgba(23,105,232,0.04)",
        "circle-stroke-color": BLUE_DARK,
        "circle-stroke-width": 3,
        "circle-stroke-opacity": 0.55,
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
        "circle-radius": 18,
        "circle-color": "#ffe1e4",
        "circle-opacity": 0.7,
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
        "circle-radius": ["case", ["==", ["get", "current"], 1], 12, 10],
        "circle-color": [
          "case",
          ["==", ["get", "current"], 1],
          BLUE_DARK,
          ["==", ["get", "status"], "closed"],
          "#ffffff",
          ["==", ["get", "status"], "bad_address"],
          "#fff7ed",
          ["==", ["get", "status"], "skipped"],
          "#e2e8f0",
          ["==", ["get", "completed"], 1],
          BLUE_LIGHT,
          BLUE,
        ],
        "circle-stroke-color": [
          "case",
          ["==", ["get", "status"], "bad_address"],
          "#f97316",
          ["==", ["get", "status"], "closed"],
          "#64748b",
          ["==", ["get", "status"], "skipped"],
          "#94a3b8",
          "#ffffff",
        ],
        "circle-stroke-width": 2.5,
        "circle-opacity": ["case", ["==", ["get", "status"], "skipped"], 0.65, 1],
      },
    });
  }
  if (!map.getLayer("hpo-route-stop-pin-symbols")) {
    map.addLayer({
      id: "hpo-route-stop-pin-symbols",
      type: "symbol",
      source: "hpo-route-stops",
      layout: {
        "icon-image": ["case", ["==", ["get", "current"], 1], "hpo-blue-active-pin", "hpo-blue-pin"],
        "icon-size": ["case", ["==", ["get", "current"], 1], 1.16, 1],
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-opacity": ["case", ["==", ["get", "status"], "skipped"], 0.55, 1],
      },
    });
  }

  if (!map.getLayer("hpo-route-stop-numbers")) {
    map.addLayer({
      id: "hpo-route-stop-numbers",
      type: "symbol",
      source: "hpo-route-stops",
      layout: {
        "text-field": ["to-string", ["get", "order"]],
        "text-size": 11,
        "text-font": ["Noto Sans Regular"],
      },
      paint: { "text-color": "#ffffff" },
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
  onFatalError,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all");
  const [query, setQuery] = useState("");
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState<Array<[number, number]>>([]);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [showTools, setShowTools] = useState(false);

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
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: LIGHT_EMERY_STYLE,
        center: [-74.3, 40.5],
        zoom: 8,
        minZoom: 5,
        maxZoom: 18,
        attributionControl: {},
        cooperativeGestures: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserLocation: true,
      });
      geolocateRef.current = geolocate;
      map.addControl(geolocate, "top-right");

      map.on("load", () => {
        setupSourcesAndLayers(map);
        setReady(true);
      });
      map.on("error", (event: any) => {
        const message = String(event?.error?.message ?? "");
        if (/webgl|context|initial/i.test(message))
          onFatalError?.(message || "MapLibre could not initialize.");
      });

      const resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);
      return () => {
        resizeObserver.disconnect();
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
    const clusterClick = async (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0];
      const clusterId = Number(feature?.properties?.["cluster_id"]);
      if (!Number.isFinite(clusterId)) return;
      const source = map.getSource("hpo-offices") as GeoJSONSource;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      const coordinates = (feature?.geometry as any)?.coordinates;
      if (Array.isArray(coordinates)) {
        map.easeTo({ center: [Number(coordinates[0]), Number(coordinates[1])], zoom });
      }
    };

    for (const layer of [
      "hpo-office-points",
      "hpo-prospect-points",
      "hpo-office-selected-ring",
      "hpo-office-pin-symbols",
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
    map.on("click", "hpo-office-clusters", clusterClick);
    map.on("mouseenter", "hpo-office-clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "hpo-office-clusters", () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      for (const layer of [
        "hpo-office-points",
        "hpo-prospect-points",
        "hpo-office-selected-ring",
        "hpo-office-pin-symbols",
      ]) {
        map.off("click", layer, officeClick);
      }
      map.off("click", drawClick);
      map.off("click", "hpo-office-clusters", clusterClick);
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

  const totalWithAddress = offices.filter((office) => office.address).length;
  const totalMapped = offices.filter((office) => office.mapped).length;
  const routeMiles =
    Number.isFinite(route?.optimized_distance_meters) && Number(route?.optimized_distance_meters) > 0
      ? (Number(route?.optimized_distance_meters) / 1609.344).toFixed(1)
      : null;

  return (
    <section className="hpo-map-v2 overflow-hidden rounded-2xl border border-primary/15 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
      <div className="border-b border-slate-200 bg-white px-3 pb-3 pt-3 text-slate-950">
        <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
          <div />
          <div className="text-center">
            <p className="text-[11px] font-semibold text-[#1769e8]">
              {routeMiles ? `Today · ${routeMiles} Miles` : "HPO Territory"}
            </p>
            <h3 className="mt-0.5 text-[15px] font-bold tracking-tight text-[#1f3354]">
              {viewMode === "map" ? "Field Map" : "Office List"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onRefreshPins}
            disabled={preparing}
            className="flex size-11 items-center justify-center rounded-xl bg-slate-50 text-[#1769e8] shadow-sm disabled:opacity-40"
            aria-label="Refresh office map pins"
          >
            <RefreshCw className={`size-4 ${preparing ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setViewMode("map")}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
              viewMode === "map" ? "bg-[#31486f] text-white shadow-sm" : "text-[#1769e8]"
            }`}
          >
            <MapIcon className="size-4" /> Map
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
              viewMode === "list" ? "bg-[#31486f] text-white shadow-sm" : "text-[#1769e8]"
            }`}
          >
            <List className="size-4" /> List
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium text-slate-500">
            {totalMapped}/{totalWithAddress} offices mapped
            {preparing ? " · preparing…" : ""}
          </p>
          <button
            type="button"
            onClick={() => setShowTools((value) => !value)}
            className="flex min-h-10 items-center gap-1.5 rounded-xl bg-slate-50 px-3 text-[10px] font-semibold text-[#1769e8]"
          >
            <SlidersHorizontal className="size-3.5" />
            {showTools ? "Hide tools" : "Search & filters"}
          </button>
        </div>

        {showTools ? (
          <div className="mt-2 rounded-xl bg-slate-50 p-2 shadow-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search offices, cities, specialties"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-base text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
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
                  className={`min-h-10 rounded-lg text-[10px] font-semibold ${
                    filter === value ? "bg-[#31486f] text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
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
                  className={`min-h-10 rounded-lg text-[10px] font-semibold ${
                    signalFilter === value ? "bg-blue-50 text-[#1769e8]" : "bg-white text-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                startDraw();
                setShowTools(false);
              }}
              className="mt-2 min-h-10 w-full rounded-lg border border-[#1769e8]/25 bg-white text-[10px] font-semibold text-[#1769e8]"
            >
              Select offices by area
            </button>
          </div>
        ) : null}
      </div>

      <div className={viewMode === "map" ? "relative" : "hidden"}>
        <div
          ref={containerRef}
          className="h-[min(64dvh,620px)] min-h-[500px] w-full bg-[#f1f5f4]"
        />
        {drawMode ? (
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-xl bg-white/95 p-1.5 shadow-lg">
            <span className="px-2 text-[10px] font-semibold text-slate-600">
              Tap 3+ points around offices
            </span>
            <button
              type="button"
              onClick={finishDraw}
              disabled={drawPoints.length < 3}
              className="min-h-10 rounded-lg bg-[#1769e8] px-3 text-[10px] font-semibold text-white disabled:opacity-40"
            >
              Select {drawPoints.length >= 3 ? "area" : `${3 - drawPoints.length} more`}
            </button>
            <button
              type="button"
              onClick={cancelDraw}
              className="flex size-10 items-center justify-center rounded-lg text-slate-500"
              aria-label="Cancel area selection"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
          {route?.stops?.length ? (
            <button
              type="button"
              onClick={fitRoute}
              className="min-h-11 rounded-xl border border-slate-200 bg-white/96 px-3 text-[11px] font-semibold text-[#1769e8] shadow-lg"
            >
              Fit route
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => geolocateRef.current?.trigger()}
            className="flex size-12 items-center justify-center rounded-full border border-slate-200 bg-white/96 text-[#1769e8] shadow-lg"
            aria-label="Show my current location"
          >
            <LocateFixed className="size-5" />
          </button>
        </div>
      </div>

      {viewMode === "list" ? (
      <div className="border-t border-slate-200 bg-white p-3">
        <div className="max-h-[56dvh] space-y-1 overflow-y-auto overscroll-contain">
          {filtered.slice(0, 40).map((office) => {
            const selected = selectedSet.has(office.key);
            const focused = office.key === selectedOfficeKey;
            return (
              <button
                key={office.key}
                type="button"
                onClick={() => onSelectOffice(office.key)}
                className={`min-h-12 w-full rounded-xl border p-2.5 text-left transition ${
                  focused ? "border-[#1769e8]/50 bg-blue-50 shadow-sm" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                      office.kind === "account"
                        ? "border-[#1769e8] bg-[#1769e8] text-white"
                        : "border-[#1769e8] bg-white text-[#1769e8]"
                    }`}
                  >
                    {office.kind === "account" ? "A" : "P"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[11px] font-semibold text-slate-900">
                      {office.officeName}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-slate-500">
                      {office.city || office.address}
                    </span>
                  </span>
                  {selected ? <Check className="size-3.5 shrink-0 text-[#1769e8]" /> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      ) : null}

      {selectedOffice ? (
        <div className={`${viewMode === "map" ? "relative z-20 mx-3 -mt-24 rounded-[1.6rem] border border-slate-200 shadow-[0_22px_48px_rgba(15,23,42,0.22)]" : "border-t border-slate-200"} bg-white p-4 text-slate-950`}>
          <div className="flex items-start gap-3">
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                selectedOffice.kind === "account"
                  ? "border-[#1769e8] bg-[#1769e8] text-white"
                  : "border-[#1769e8] bg-white text-[#1769e8]"
              }`}
            >
              {selectedOffice.kind === "account" ? "A" : "P"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="break-words text-sm font-semibold">{selectedOffice.officeName}</h4>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-semibold capitalize text-[#1769e8]">
                  {selectedOffice.kind}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                {[selectedOffice.address, selectedOffice.city].filter(Boolean).join(", ")}
              </p>
              {selectedOffice.nextAction ? (
                <p className="mt-2 text-[10px] text-slate-600">
                  <span className="font-semibold text-slate-800">Next:</span>{" "}
                  {selectedOffice.nextAction}
                </p>
              ) : null}
            </div>
          </div>
          <div
            className={`mt-3 grid gap-2 ${selectedOffice.accountId ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <a
              href={`https://maps.apple.com/?q=${encodeURIComponent(
                [selectedOffice.officeName, selectedOffice.address, selectedOffice.city]
                  .filter(Boolean)
                  .join(", "),
              )}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-2 text-[11px] font-semibold text-slate-600"
            >
              <MapPinned className="size-3.5" /> Maps
            </a>
            {selectedOffice.accountId ? (
              <button
                type="button"
                onClick={() => onOpenAccount?.(selectedOffice.accountId!)}
                className="min-h-11 rounded-xl border border-slate-200 px-2 text-[11px] font-semibold text-slate-700"
              >
                Account
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onToggleRouteStop(selectedOffice)}
              className={`min-h-11 rounded-xl px-2 text-[11px] font-semibold ${
                selectedSet.has(selectedOffice.key)
                  ? "border border-[#1769e8]/25 bg-blue-50 text-[#1769e8]"
                  : "bg-[#1769e8] text-white"
              }`}
            >
              {selectedSet.has(selectedOffice.key) ? "Remove" : "Add to route"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-3 text-slate-950">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {selectedKeys.length
              ? `${selectedKeys.length} offices selected`
              : "Tap a pin or list row"}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-slate-500">
            Selected offices become the route builder stop list.
          </p>
        </div>
        <button
          type="button"
          onClick={onBuildRoute}
          disabled={!selectedKeys.length}
          className="min-h-11 shrink-0 rounded-xl bg-[#1769e8] px-3 text-xs font-semibold text-white disabled:opacity-35"
        >
          Build Route
        </button>
      </div>
    </section>
  );
}
