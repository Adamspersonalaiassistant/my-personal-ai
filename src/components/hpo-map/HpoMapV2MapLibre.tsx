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
import { Check, LocateFixed, MapPinned, Maximize2, RefreshCw, Search } from "lucide-react";
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
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "emery-light-basemap",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -0.75,
        "raster-contrast": -0.1,
        "raster-brightness-min": 0.68,
        "raster-brightness-max": 1,
        "raster-opacity": 0.94,
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
  onToggleRouteStop: (office: HpoMapOffice) => void;
  onBuildRoute: () => void;
  preparing: boolean;
  onRefreshPins: () => void;
  onFatalError?: (message: string) => void;
};

type Filter = "all" | "account" | "prospect";

function officeCollection(offices: HpoMapOffice[], selected: Set<string>, focusedKey: string | null) {
  return {
    type: "FeatureCollection" as const,
    features: offices
      .filter(
        (office) =>
          office.mapped &&
          Number.isFinite(office.latitude) &&
          Number.isFinite(office.longitude),
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
  const raw = Array.isArray(route?.metadata?.["route_geometry"])
    ? (route?.metadata?.["route_geometry"] as unknown[])
    : [];
  let coordinates = raw
    .map((entry) => (Array.isArray(entry) && entry.length >= 2 ? [Number(entry[0]), Number(entry[1])] : null))
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

function boundsForOffices(offices: HpoMapOffice[]) {
  const points = offices.filter(
    (office) =>
      office.mapped &&
      Number.isFinite(office.latitude) &&
      Number.isFinite(office.longitude),
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

  if (!map.getLayer("hpo-office-clusters")) {
    map.addLayer({
      id: "hpo-office-clusters",
      type: "circle",
      source: "hpo-offices",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": BLUE,
        "circle-radius": [
          "step",
          ["get", "point_count"],
          17,
          10,
          20,
          30,
          23,
          75,
          27,
        ],
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
        "text-font": ["Open Sans Bold"],
      },
      paint: { "text-color": "#ffffff" },
    });
  }

  if (!map.getLayer("hpo-office-points")) {
    map.addLayer({
      id: "hpo-office-points",
      type: "circle",
      source: "hpo-offices",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "account"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 9, 7],
        "circle-color": BLUE,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
        "circle-opacity": 0.96,
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
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 9, 7],
        "circle-color": "#ffffff",
        "circle-stroke-color": BLUE,
        "circle-stroke-width": 2.5,
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
        "circle-color": BLUE_LIGHT,
        "circle-opacity": 0.55,
        "circle-stroke-color": BLUE,
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
          ["==", ["get", "completed"], 1],
          "#9aa8ba",
          BLUE,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
        "circle-opacity": ["case", ["==", ["get", "completed"], 1], 0.6, 1],
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
        "text-font": ["Open Sans Bold"],
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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return offices.filter((office) => {
      if (!office.mapped || !Number.isFinite(office.latitude) || !Number.isFinite(office.longitude))
        return false;
      if (filter !== "all" && office.kind !== filter) return false;
      if (!needle) return true;
      return [office.officeName, office.address, office.city, office.specialty, office.detail]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, offices, query]);

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
        attributionControl: true,
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
        if (/webgl|context|initial/i.test(message)) onFatalError?.(message || "MapLibre could not initialize.");
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
    if (!map || !ready) return;
    const source = map.getSource("hpo-offices") as GeoJSONSource | undefined;
    source?.setData(officeCollection(filtered, selectedSet, selectedOfficeKey) as any);
  }, [filtered, ready, selectedOfficeKey, selectedSet]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("hpo-route-line") as GeoJSONSource | undefined)?.setData(routeCollection(route) as any);
    (map.getSource("hpo-route-stops") as GeoJSONSource | undefined)?.setData(
      routeStopsCollection(route) as any,
    );
  }, [ready, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const officeClick = (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const key = featureKey(event.features?.[0]);
      if (!key) return;
      onSelectOffice(key);
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

    for (const layer of ["hpo-office-points", "hpo-prospect-points", "hpo-office-selected-ring"]) {
      map.on("click", layer, officeClick);
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    map.on("click", "hpo-office-clusters", clusterClick);
    map.on("mouseenter", "hpo-office-clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "hpo-office-clusters", () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      for (const layer of ["hpo-office-points", "hpo-prospect-points", "hpo-office-selected-ring"]) {
        map.off("click", layer, officeClick);
      }
      map.off("click", "hpo-office-clusters", clusterClick);
    };
  }, [onSelectOffice, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedOffice) return;
    if (!Number.isFinite(selectedOffice.longitude) || !Number.isFinite(selectedOffice.latitude)) return;
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
  }, [filter, query, ready]);

  function fitOffices() {
    const map = mapRef.current;
    const bounds = boundsForOffices(filtered);
    if (!map || !bounds || bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 52, maxZoom: 13.2, duration: 420 });
  }

  function fitSelected() {
    const map = mapRef.current;
    const selected = offices.filter((office) => selectedSet.has(office.key));
    const bounds = boundsForOffices(selected);
    if (!map || !bounds || bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 58, maxZoom: 14, duration: 420 });
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

  return (
    <section className="hpo-map-v2 overflow-hidden rounded-[1.6rem] border border-primary/15 bg-white shadow-[0_18px_48px_rgba(0,0,0,0.18)]">
      <div className="border-b border-slate-200 bg-white p-4 text-slate-950">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1769e8]">
              Office Map · Account Tracker
            </p>
            <h3 className="mt-1 text-lg font-semibold">Build the day from your territory.</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Clean territory view · tap a pin or list row · clusters expand as you zoom.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshPins}
            disabled={preparing}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm disabled:opacity-40"
            aria-label="Refresh office map pins"
          >
            <RefreshCw className={`size-3.5 ${preparing ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search offices, cities, specialties"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1769e8]/40 focus:bg-white"
            />
          </div>
        </div>

        <div className="mt-2 flex gap-1 rounded-xl bg-slate-100 p-1">
          {([
            ["all", "All"],
            ["account", "Accounts"],
            ["prospect", "Prospects"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`min-h-9 flex-1 rounded-lg px-2.5 text-[10px] font-semibold transition ${
                filter === value
                  ? "bg-white text-[#1769e8] shadow-sm"
                  : "text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500">
          <span>
            {totalMapped}/{totalWithAddress} offices mapped
            {preparing ? " · preparing pins…" : ""}
          </span>
          <span>{selectedKeys.length} selected for route</span>
        </div>
      </div>

      <div className="relative">
        <div ref={containerRef} className="h-[410px] w-full bg-[#f8fafc]" />
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-lg border border-slate-200/80 bg-white/92 px-2 py-1 text-[9px] font-medium text-slate-500 shadow-sm backdrop-blur">
          Drag · pinch · tap clusters
        </div>
        <div className="absolute bottom-3 right-3 z-10 flex gap-1">
          <button
            type="button"
            onClick={fitOffices}
            className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#1769e8] shadow-md"
            aria-label="Fit offices"
          >
            <Maximize2 className="size-3.5" />
          </button>
          {selectedKeys.length ? (
            <button
              type="button"
              onClick={fitSelected}
              className="min-h-9 rounded-xl border border-[#1769e8]/20 bg-white px-2.5 text-[10px] font-semibold text-[#1769e8] shadow-md"
            >
              Fit selected
            </button>
          ) : null}
          {route?.stops?.length ? (
            <button
              type="button"
              onClick={fitRoute}
              className="min-h-9 rounded-xl border border-[#1769e8]/20 bg-white px-2.5 text-[10px] font-semibold text-[#1769e8] shadow-md"
            >
              Fit route
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => geolocateRef.current?.trigger()}
            className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#1769e8] shadow-md"
            aria-label="Show my current location"
          >
            <LocateFixed className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {filtered.slice(0, 80).map((office) => {
            const selected = selectedSet.has(office.key);
            const focused = office.key === selectedOfficeKey;
            return (
              <button
                key={office.key}
                type="button"
                onClick={() => onSelectOffice(office.key)}
                className={`min-w-[190px] max-w-[230px] shrink-0 rounded-xl border p-2.5 text-left transition ${
                  focused
                    ? "border-[#1769e8]/50 bg-blue-50 shadow-sm"
                    : "border-slate-200 bg-white"
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
                    <span className="block truncate text-[11px] font-semibold text-slate-900">
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

      {selectedOffice ? (
        <div className="border-t border-slate-200 bg-white p-4 text-slate-950">
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
                <h4 className="truncate text-sm font-semibold">{selectedOffice.officeName}</h4>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold capitalize text-slate-500">
                  {selectedOffice.kind}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                {[selectedOffice.address, selectedOffice.city].filter(Boolean).join(", ")}
              </p>
              {selectedOffice.nextAction ? (
                <p className="mt-2 text-[10px] text-slate-600">
                  <span className="font-semibold text-slate-800">Next:</span> {selectedOffice.nextAction}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a
              href={`https://maps.apple.com/?q=${encodeURIComponent(
                [selectedOffice.officeName, selectedOffice.address, selectedOffice.city]
                  .filter(Boolean)
                  .join(", "),
              )}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600"
            >
              <MapPinned className="size-3.5" /> Open location
            </a>
            <button
              type="button"
              onClick={() => onToggleRouteStop(selectedOffice)}
              className={`min-h-11 rounded-xl px-3 text-xs font-semibold ${
                selectedSet.has(selectedOffice.key)
                  ? "border border-[#1769e8]/25 bg-blue-50 text-[#1769e8]"
                  : "bg-[#1769e8] text-white"
              }`}
            >
              {selectedSet.has(selectedOffice.key) ? "Remove from route" : "Add to route"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-slate-200 bg-white p-3 text-slate-950">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">
            {selectedKeys.length ? `${selectedKeys.length} offices selected` : "Tap a pin or list row"}
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
