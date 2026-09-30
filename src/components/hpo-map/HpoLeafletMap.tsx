import { useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Building2,
  Check,
  List,
  LocateFixed,
  MapPinned,
  MessageCircle,
  Navigation,
  RefreshCw,
  Route as RouteIcon,
  Search,
  X,
} from "lucide-react";
import type { HpoMapOffice, HpoMapRoute } from "@/components/hpo-map/types";
import { openHpoEmery } from "@/components/HpoEmerySheet";

const TERMINAL = new Set([
  "completed",
  "visited",
  "skipped",
  "closed",
  "bad_address",
]);
type Filter = "all" | "account" | "prospect";
type PinCategory = "attorney" | "doctor" | "chiro" | "chiro_pt" | "other";

const PIN_CATEGORIES: Record<PinCategory, { label: string; color: string }> = {
  attorney: { label: "Attorney", color: "#8b5cf6" },
  doctor: { label: "Doctor", color: "#1769e8" },
  chiro: { label: "Chiro", color: "#10b981" },
  chiro_pt: { label: "Chiro/PT", color: "#f59e0b" },
  other: { label: "Other", color: "#64748b" },
};

const PIN_CATEGORY_ORDER: PinCategory[] = [
  "doctor",
  "chiro",
  "chiro_pt",
  "attorney",
  "other",
];

function officePinCategory(office: HpoMapOffice): PinCategory {
  const source = [
    office.accountType,
    office.prospectType,
    office.specialty,
    office.detail,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(attorney|law firm|law office|legal)\b/.test(source))
    return "attorney";

  const isChiro = /\b(chiro|chiropractor|chiropractic)\b/.test(source);
  const isPt = /\b(pt|physical therapy|physical therapist)\b/.test(source);
  if (isChiro && isPt) return "chiro_pt";
  if (isChiro) return "chiro";

  if (
    /\b(primary care|pcp|family medicine|family practice|internal medicine|doctor|physician|medical doctor)\b/.test(
      source,
    )
  )
    return "doctor";

  return "other";
}

type Props = {
  routeOnly?: boolean;
  offices: HpoMapOffice[];
  selectedKeys: string[];
  selectedOfficeKey: string | null;
  route?: HpoMapRoute | null;
  onSelectOffice: (key: string) => void;
  onOpenAccount?: (accountId: string) => void;
  onToggleRouteStop: (office: HpoMapOffice) => void;
  onBuildRoute: () => void;
  onOptimizeRoute?: (() => void) | undefined;
  optimizing?: boolean;
  preparing: boolean;
  onRefreshPins: () => void;
  onNavigateHpo?:
    | ((view: "today" | "planner" | "map" | "accounts" | "activity") => void)
    | undefined;
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validOffice(office: HpoMapOffice) {
  return (
    office.mapped &&
    Number.isFinite(Number(office.latitude)) &&
    Number.isFinite(Number(office.longitude))
  );
}

function pinIcon(office: HpoMapOffice, selected: boolean, focused: boolean) {
  const category = officePinCategory(office);
  const fill = PIN_CATEGORIES[category].color;
  const size = focused ? 38 : 34;
  return L.divIcon({
    className: "hpo-leaflet-pin-wrap",
    html:
      '<div style="width:' +
      size +
      "px;height:" +
      size +
      "px;filter:drop-shadow(0 4px 5px rgba(15,23,42,.34));transform:" +
      (focused ? "scale(1.08)" : "scale(1)") +
      ';transform-origin:50% 100%">' +
      '<svg viewBox="0 0 32 40" width="' +
      size +
      '" height="' +
      Math.round(size * 1.25) +
      '" aria-hidden="true">' +
      '<path d="M16 1C7.7 1 1 7.7 1 16c0 10.6 15 23 15 23s15-12.4 15-23C31 7.7 24.3 1 16 1Z" fill="' +
      fill +
      '" stroke="#fff" stroke-width="2"/>' +
      '<circle cx="16" cy="16" r="6" fill="#fff"/>' +
      (selected
        ? '<path d="m12.8 16 2.1 2.1 4.4-4.6" fill="none" stroke="' +
          fill +
          '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<circle cx="16" cy="16" r="2.2" fill="' + fill + '"/>') +
      "</svg></div>",
    iconSize: [size, Math.round(size * 1.25)],
    iconAnchor: [size / 2, Math.round(size * 1.25)],
  });
}

function clusterIcon(offices: HpoMapOffice[]) {
  const count = offices.length;
  const size = count >= 50 ? 48 : count >= 20 ? 44 : 40;
  const counts = new Map<PinCategory, number>();
  for (const office of offices) {
    const category = officePinCategory(office);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let cursor = 0;
  const segments: string[] = [];
  for (const category of PIN_CATEGORY_ORDER) {
    const categoryCount = counts.get(category) ?? 0;
    if (!categoryCount) continue;
    const next = cursor + (categoryCount / count) * 100;
    segments.push(
      `${PIN_CATEGORIES[category].color} ${cursor.toFixed(1)}% ${next.toFixed(1)}%`,
    );
    cursor = next;
  }
  const background =
    segments.length > 1
      ? `conic-gradient(${segments.join(",")})`
      : PIN_CATEGORIES[officePinCategory(offices[0]!)].color;
  const inner = size - 10;

  return L.divIcon({
    className: "hpo-leaflet-cluster-wrap",
    html:
      '<div style="width:' +
      size +
      "px;height:" +
      size +
      "px;border-radius:9999px;border:3px solid white;background:" +
      background +
      ';display:grid;place-items:center;box-shadow:0 5px 16px rgba(15,23,42,.32)">' +
      '<div style="width:' +
      inner +
      "px;height:" +
      inner +
      'px;border-radius:9999px;background:white;color:#0f172a;display:grid;place-items:center;font:800 11px system-ui,-apple-system,sans-serif">' +
      count +
      "</div></div>",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function routeCoordinates(route?: HpoMapRoute | null): L.LatLngExpression[] {
  if (!route) return [];
  const remaining = Array.isArray(route.metadata?.["route_geometry_remaining"])
    ? (route.metadata?.["route_geometry_remaining"] as unknown[])
    : null;
  const full = Array.isArray(route.metadata?.["route_geometry"])
    ? (route.metadata?.["route_geometry"] as unknown[])
    : null;
  const raw = remaining && remaining.length >= 2 ? remaining : (full ?? []);
  const fromMetadata = raw
    .map((entry) =>
      Array.isArray(entry) && entry.length >= 2
        ? ([Number(entry[1]), Number(entry[0])] as L.LatLngTuple)
        : null,
    )
    .filter(
      (entry): entry is L.LatLngTuple =>
        Boolean(entry) &&
        Number.isFinite(entry![0]) &&
        Number.isFinite(entry![1]),
    );
  if (fromMetadata.length >= 2) return fromMetadata;

  const points: L.LatLngExpression[] = [];
  if (
    Number.isFinite(route.start_latitude) &&
    Number.isFinite(route.start_longitude)
  ) {
    points.push([Number(route.start_latitude), Number(route.start_longitude)]);
  }
  for (const stop of [...route.stops].sort(
    (a, b) => a.stop_order - b.stop_order,
  )) {
    if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) {
      points.push([Number(stop.latitude), Number(stop.longitude)]);
    }
  }
  if (
    Number.isFinite(route.end_latitude) &&
    Number.isFinite(route.end_longitude)
  ) {
    points.push([Number(route.end_latitude), Number(route.end_longitude)]);
  }
  return points;
}

function escapeMapText(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function startMarkerIcon() {
  return L.divIcon({
    className: "hpo-route-start-marker",
    html: '<div style="display:flex;align-items:center;gap:5px;border:2px solid white;border-radius:999px;background:#0f172a;color:white;padding:5px 8px 5px 6px;box-shadow:0 5px 14px rgba(15,23,42,.38);font:800 9px/1 system-ui,-apple-system,sans-serif;letter-spacing:.08em"><span style="display:grid;place-items:center;width:17px;height:17px;border-radius:999px;background:#22c55e;color:#052e16;font-size:10px">S</span>START</div>',
    iconSize: [65, 31],
    iconAnchor: [16, 16],
    popupAnchor: [16, -13],
  });
}

function numberedStopIcon(order: number, completed: boolean, current: boolean) {
  const fill = current ? "#075be8" : completed ? "#75a9ef" : "#0b6bff";
  const size = current ? 34 : 31;
  return L.divIcon({
    className: "hpo-route-number-tooltip",
    html: `<div style="display:grid;place-items:center;width:${size}px;height:${size}px;border:3px solid white;border-radius:999px;background:${fill};color:white;box-shadow:0 4px 12px rgba(15,23,42,.42);font:800 12px/1 system-ui,-apple-system,sans-serif">${order}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export function HpoLeafletMap({
  routeOnly = false,
  offices,
  selectedKeys,
  selectedOfficeKey,
  route,
  onSelectOffice,
  onOpenAccount,
  onToggleRouteStop,
  onBuildRoute,
  onOptimizeRoute,
  optimizing = false,
  preparing,
  onRefreshPins,
  onNavigateHpo,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const officeLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const fitDoneRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [listMode, setListMode] = useState(false);
  const [routeListMode, setRouteListMode] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return offices.filter((office) => {
      if (!validOffice(office)) return false;
      if (filter !== "all" && office.kind !== filter) return false;
      if (!needle) return true;
      return [
        office.officeName,
        office.address,
        office.city,
        office.specialty,
        office.detail,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, offices, query]);

  const selectedOffice =
    offices.find((office) => office.key === selectedOfficeKey) ??
    offices.find((office) => selectedSet.has(office.key)) ??
    null;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: true,
      inertia: true,
      inertiaDeceleration: 3000,
      worldCopyJump: true,
    }).setView([40.5, -74.3], 8);

    mapRef.current = map;
    officeLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    const tiles = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 20,
        minZoom: 5,
        subdomains: "abcd",
        attribution: "© OpenStreetMap contributors © CARTO",
        crossOrigin: true,
        updateWhenIdle: false,
        keepBuffer: 3,
      },
    );
    tiles.on("tileload", () => setTileError(false));
    tiles.on("tileerror", () => setTileError(true));
    tiles.addTo(map);

    const resize = () => map.invalidateSize({ pan: false, animate: false });
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(containerRef.current);
    window.setTimeout(resize, 80);
    window.setTimeout(resize, 400);
    setReady(true);

    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      officeLayerRef.current = null;
      routeLayerRef.current = null;
      fitDoneRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (listMode || routeListMode) return;
    const frame = requestAnimationFrame(() =>
      mapRef.current?.invalidateSize({ pan: false, animate: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [listMode, routeListMode]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = officeLayerRef.current;
    if (!map || !layer || !ready) return;

    const render = () => {
      layer.clearLayers();
      const valid = filtered.filter(validOffice);
      const zoom = map.getZoom();
      const shouldCluster = valid.length > 70 && zoom < 11.25;

      const addOffice = (office: HpoMapOffice) => {
        const marker = L.marker(
          [Number(office.latitude), Number(office.longitude)],
          {
            icon: pinIcon(
              office,
              selectedSet.has(office.key),
              office.key === selectedOfficeKey,
            ),
            keyboard: true,
            riseOnHover: true,
          },
        );
        marker.bindTooltip(
          `${office.officeName} · ${PIN_CATEGORIES[officePinCategory(office)].label}`,
          {
            direction: "top",
            offset: [0, -34],
            opacity: 0.92,
          },
        );
        marker.on("click", () => onSelectOffice(office.key));
        marker.addTo(layer);
      };

      if (!shouldCluster) {
        valid.forEach(addOffice);
        return;
      }

      const pinned: HpoMapOffice[] = [];
      const ordinary: HpoMapOffice[] = [];
      for (const office of valid) {
        if (selectedSet.has(office.key) || office.key === selectedOfficeKey)
          pinned.push(office);
        else ordinary.push(office);
      }

      const cell = zoom < 8 ? 78 : zoom < 9.5 ? 64 : 52;
      const buckets = new Map<string, HpoMapOffice[]>();
      for (const office of ordinary) {
        const point = map.latLngToContainerPoint([
          Number(office.latitude),
          Number(office.longitude),
        ]);
        const key =
          Math.floor(point.x / cell) + ":" + Math.floor(point.y / cell);
        const bucket = buckets.get(key) ?? [];
        bucket.push(office);
        buckets.set(key, bucket);
      }

      for (const bucket of buckets.values()) {
        if (bucket.length === 1) {
          addOffice(bucket[0]!);
          continue;
        }
        const lat =
          bucket.reduce((sum, office) => sum + Number(office.latitude), 0) /
          bucket.length;
        const lon =
          bucket.reduce((sum, office) => sum + Number(office.longitude), 0) /
          bucket.length;
        const marker = L.marker([lat, lon], {
          icon: clusterIcon(bucket),
          keyboard: true,
        });
        marker.on("click", () => {
          map.setView([lat, lon], Math.min(15, map.getZoom() + 2), {
            animate: true,
          });
        });
        marker.addTo(layer);
      }
      pinned.forEach(addOffice);
    };

    render();
    map.on("zoomend moveend", render);
    return () => {
      map.off("zoomend moveend", render);
      layer.clearLayers();
    };
  }, [filtered, onSelectOffice, ready, selectedOfficeKey, selectedSet]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitDoneRef.current) return;
    const valid = offices.filter(validOffice);
    if (!valid.length) return;
    const bounds = L.latLngBounds(
      valid.map(
        (office) =>
          [Number(office.latitude), Number(office.longitude)] as L.LatLngTuple,
      ),
    );
    map.fitBounds(bounds.pad(0.06), { maxZoom: 10, animate: false });
    fitDoneRef.current = true;
  }, [offices, ready]);

  useEffect(() => {
    const layer = routeLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map || !ready) return;
    layer.clearLayers();
    const coords = routeCoordinates(route);
    if (coords.length >= 2) {
      L.polyline(coords, {
        color: "#0f172a",
        weight: 12,
        opacity: 0.3,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 1.15,
        interactive: false,
      }).addTo(layer);
      L.polyline(coords, {
        color: "#ffffff",
        weight: 9,
        opacity: 0.94,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 1.15,
        interactive: false,
      }).addTo(layer);
      L.polyline(coords, {
        color: "#0877ff",
        weight: 6,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 1.15,
      }).addTo(layer);
      const bounds = L.latLngBounds(coords as L.LatLngExpression[]);
      map.fitBounds(bounds.pad(0.12), {
        maxZoom: 13,
        animate: false,
        paddingTopLeft: [18, 18],
        paddingBottomRight: [18, routeOnly ? 18 : 190],
      });
    }
    const ordered = [...(route?.stops ?? [])].sort(
      (a, b) => a.stop_order - b.stop_order,
    );
    if (routeOnly && coords.length === 1)
      map.setView(coords[0] as L.LatLngTuple, 14, { animate: false });
    if (
      Number.isFinite(route?.start_latitude) &&
      Number.isFinite(route?.start_longitude)
    ) {
      const startLabel = route?.metadata?.["starting_point"] as
        { label?: string; address?: string } | undefined;
      const startMarker = L.marker(
        [Number(route!.start_latitude), Number(route!.start_longitude)],
        {
          icon: startMarkerIcon(),
          keyboard: true,
          zIndexOffset: 1100,
        },
      );
      startMarker.bindPopup(
        `<div style="min-width:170px;font:500 12px/1.45 system-ui,-apple-system,sans-serif"><strong style="display:block;color:#0f172a;font-size:13px">Starting Point</strong><span style="color:#475569">${escapeMapText(startLabel?.label || route?.start_address || "Route start")}</span>${startLabel?.address && startLabel.address !== startLabel.label ? `<br/><span style="color:#64748b">${escapeMapText(startLabel.address)}</span>` : ""}</div>`,
      );
      startMarker.addTo(layer);
    }
    const currentId =
      ordered.find((stop) => !TERMINAL.has(stop.status))?.id ?? null;
    for (const stop of ordered) {
      if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude))
        continue;
      const completed = TERMINAL.has(stop.status);
      const current = stop.id === currentId;
      const marker = L.marker([Number(stop.latitude), Number(stop.longitude)], {
        icon: numberedStopIcon(stop.stop_order, completed, current),
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: 1000 + stop.stop_order,
      });
      marker.bindPopup(
        `<div style="min-width:190px;font:500 12px/1.45 system-ui,-apple-system,sans-serif"><strong style="display:block;color:#0f172a;font-size:13px">${stop.stop_order}. ${escapeMapText(stop.office_name || "Route stop")}</strong>${stop.address ? `<span style="color:#475569">${escapeMapText(stop.address)}${stop.city ? `, ${escapeMapText(stop.city)}` : ""}</span>` : ""}${stop.drive_seconds_from_previous != null ? `<div style="margin-top:6px;color:#075be8;font-weight:700">${Math.round(stop.drive_seconds_from_previous / 60)} min${stop.distance_meters_from_previous != null ? ` · ${(stop.distance_meters_from_previous / 1609.344).toFixed(1)} mi` : ""} from ${stop.stop_order === 1 ? "start" : "previous stop"}</div>` : ""}</div>`,
      );
      marker.addTo(layer);
    }
  }, [ready, route, routeOnly]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedOffice || !validOffice(selectedOffice))
      return;
    map.flyTo(
      [Number(selectedOffice.latitude), Number(selectedOffice.longitude)],
      Math.max(13, map.getZoom()),
      { animate: true, duration: 0.35 },
    );
  }, [ready, selectedOffice?.key]);

  function fitOffices() {
    const map = mapRef.current;
    const valid = filtered.filter(validOffice);
    if (!map || !valid.length) return;
    map.fitBounds(
      L.latLngBounds(
        valid.map(
          (office) =>
            [
              Number(office.latitude),
              Number(office.longitude),
            ] as L.LatLngTuple,
        ),
      ).pad(0.08),
      { maxZoom: 12, animate: true },
    );
  }

  function locateMe() {
    const map = mapRef.current;
    if (!map) return;
    map.locate({ setView: true, maxZoom: 14, enableHighAccuracy: true });
  }

  const searchResults = query.trim() ? filtered.slice(0, 10) : [];
  const totalMapped = offices.filter(validOffice).length;
  const categoryCounts = useMemo(() => {
    const counts: Record<PinCategory, number> = {
      attorney: 0,
      doctor: 0,
      chiro: 0,
      chiro_pt: 0,
      other: 0,
    };
    for (const office of offices) {
      if (!validOffice(office)) continue;
      counts[officePinCategory(office)] += 1;
    }
    return counts;
  }, [offices]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      {!routeOnly ? (
        <div className="relative z-[1000] shrink-0 border-b border-border bg-background/95 px-3 pb-2 pt-3 shadow-[0_10px_28px_rgba(0,0,0,0.24)] backdrop-blur-xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search HPO accounts, offices or towns"
              className="h-12 w-full rounded-2xl border border-border bg-card pl-10 pr-10 text-base text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5">
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
                className={`min-h-10 shrink-0 rounded-full border px-4 text-xs font-semibold ${
                  filter === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setRouteListMode(false);
                setListMode((value) => !value);
              }}
              className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <List className="size-3.5" />
              {listMode ? "Map" : "Offices"}
            </button>
            {route ? (
              <button
                type="button"
                onClick={() => {
                  setListMode(false);
                  setRouteListMode((value) => !value);
                }}
                className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold ${
                  routeListMode
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary/35 bg-primary/10 text-primary"
                }`}
              >
                <RouteIcon className="size-3.5" />
                {routeListMode ? "Map" : "Route"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRefreshPins}
              disabled={preparing}
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label="Refresh HPO offices"
            >
              <RefreshCw
                className={`size-3.5 ${preparing ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{totalMapped} mapped offices</span>
            <span>{selectedKeys.length} selected</span>
          </div>

          <div
            className="mt-1.5 flex items-center gap-3 overflow-x-auto pb-0.5 text-[10px] font-semibold text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="HPO account pin legend"
          >
            {PIN_CATEGORY_ORDER.map((category) => (
              <span
                key={category}
                className="flex shrink-0 items-center gap-1.5"
              >
                <span
                  className="size-2.5 rounded-full ring-1 ring-white"
                  style={{ backgroundColor: PIN_CATEGORIES[category].color }}
                />
                {PIN_CATEGORIES[category].label} {categoryCounts[category]}
              </span>
            ))}
          </div>

          {searchResults.length ? (
            <div className="absolute left-3 right-3 top-full max-h-[min(14rem,40dvh)] overflow-y-auto rounded-2xl border border-border bg-card shadow-lg">
              {searchResults.map((office) => (
                <button
                  key={office.key}
                  type="button"
                  onClick={() => {
                    onSelectOffice(office.key);
                    setQuery("");
                    setListMode(false);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 border-b border-border/70 px-3 py-2 text-left hover:bg-muted/60 last:border-0"
                >
                  <MapPinned className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {office.officeName}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[office.address, office.city].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  <span className="text-[9px] font-semibold uppercase text-muted-foreground">
                    {office.kind}
                  </span>
                </button>
              ))}
            </div>
          ) : query.trim() ? (
            <div className="absolute left-3 right-3 top-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-lg">
              No matching offices.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className={`absolute inset-0 z-0 bg-[#dbe5ee] ${listMode || routeListMode ? "invisible" : ""}`}
          aria-label="Interactive HPO office map"
        />

        {routeListMode && route ? (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-background px-3 py-3 pb-44">
            <div className="mb-3 rounded-2xl border border-primary/20 bg-primary/[0.05] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                Optimized route
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {route.area || "HPO Marketing Route"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {route.route_date
                  ? new Date(`${route.route_date}T12:00:00`).toLocaleDateString(
                      [],
                      { weekday: "short", month: "short", day: "numeric" },
                    )
                  : "Route"}{" "}
                · {route.stops.length} stops
                {route.optimized_duration_seconds
                  ? ` · ${Math.round(route.optimized_duration_seconds / 60)} min drive`
                  : ""}
                {route.optimized_distance_meters
                  ? ` · ${(route.optimized_distance_meters / 1609.344).toFixed(1)} mi`
                  : ""}
              </p>
            </div>
            <div className="space-y-2">
              {[...route.stops]
                .sort((a, b) => a.stop_order - b.stop_order)
                .map((stop) => (
                  <div
                    key={stop.id}
                    className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {stop.stop_order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {stop.office_name || "Route stop"}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        {[stop.address, stop.city].filter(Boolean).join(", ") ||
                          "Address saved on route"}
                      </p>
                      <p className="mt-1 text-[10px] text-primary">
                        {stop.drive_seconds_from_previous
                          ? `${Math.max(1, Math.round(stop.drive_seconds_from_previous / 60))} min from previous`
                          : stop.stop_order === 1
                            ? "First stop"
                            : ""}
                        {stop.distance_meters_from_previous
                          ? ` · ${(stop.distance_meters_from_previous / 1609.344).toFixed(1)} mi`
                          : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-1 text-[9px] font-semibold capitalize text-muted-foreground">
                      {String(stop.status).replaceAll("_", " ")}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {listMode ? (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-background px-3 py-3 pb-40">
            <div className="space-y-2">
              {filtered.map((office) => (
                <button
                  key={office.key}
                  type="button"
                  onClick={() => {
                    onSelectOffice(office.key);
                    setListMode(false);
                  }}
                  className="w-full rounded-2xl border border-border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      {office.kind === "account" ? (
                        <Building2 className="size-4" />
                      ) : (
                        <MapPinned className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {office.officeName}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        {[office.address, office.city]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      {office.nextAction ? (
                        <p className="mt-1 truncate text-[10px] font-medium text-primary">
                          Next: {office.nextAction}
                        </p>
                      ) : null}
                    </div>
                    {selectedSet.has(office.key) ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!listMode && !routeListMode ? (
          <div className="pointer-events-none absolute right-3 top-3 z-[500] flex flex-col gap-2">
            <button
              type="button"
              onClick={fitOffices}
              className="pointer-events-auto flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-foreground shadow-lg"
              aria-label="Fit offices"
            >
              <MapPinned className="size-4" />
            </button>
            <button
              type="button"
              onClick={locateMe}
              className="pointer-events-auto flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-lg"
              aria-label="Use my location"
            >
              <LocateFixed className="size-4" />
            </button>
          </div>
        ) : null}

        {tileError && !listMode ? (
          <div className="absolute left-4 right-4 top-4 z-[600] rounded-2xl border border-amber-400/40 bg-amber-950/95 p-3 text-center text-xs font-medium text-amber-100 shadow-xl">
            Street tiles are having trouble loading. Search and the office list
            still work while you retry.
          </div>
        ) : null}
      </div>

      {!routeOnly ? (
        <div className="shrink-0 border-t border-border bg-background/95 px-3 pb-2 pt-2 shadow-[0_-14px_34px_rgba(0,0,0,.3)] backdrop-blur-xl">
          {selectedOffice ? (
            <>
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  {selectedOffice.kind === "account" ? (
                    <Building2 className="size-4" />
                  ) : (
                    <MapPinned className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {selectedOffice.officeName}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {[selectedOffice.address, selectedOffice.city]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  {selectedOffice.nextAction ? (
                    <p className="mt-1 truncate text-[10px] font-medium text-primary">
                      Next: {selectedOffice.nextAction}
                    </p>
                  ) : null}
                </div>
              </div>

              <div
                className={`mt-2 grid gap-2 ${
                  selectedOffice.accountId ? "grid-cols-4" : "grid-cols-3"
                }`}
              >
                <a
                  href={`https://maps.apple.com/?daddr=${encodeURIComponent(
                    [selectedOffice.address, selectedOffice.city]
                      .filter(Boolean)
                      .join(", "),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border text-[10px] font-semibold text-foreground hover:bg-muted"
                >
                  <Navigation className="size-3.5" />
                  Go
                </a>
                {selectedOffice.accountId ? (
                  <button
                    type="button"
                    onClick={() => onOpenAccount?.(selectedOffice.accountId!)}
                    className="min-h-11 rounded-xl border border-border text-[10px] font-semibold text-foreground hover:bg-muted"
                  >
                    Account
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onToggleRouteStop(selectedOffice)}
                  className={`min-h-11 rounded-xl px-2 text-[10px] font-semibold ${
                    selectedSet.has(selectedOffice.key)
                      ? "border border-primary/35 bg-primary/15 text-primary"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {selectedSet.has(selectedOffice.key) ? "Remove" : "Route"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openHpoEmery(
                      `I'm looking at ${selectedOffice.officeName} at ${[
                        selectedOffice.address,
                        selectedOffice.city,
                      ]
                        .filter(Boolean)
                        .join(", ")}. Help me with this HPO account/office.`,
                      selectedOffice.officeName,
                    )
                  }
                  className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border text-[10px] font-semibold text-foreground hover:bg-muted"
                >
                  <MessageCircle className="size-3.5" />
                  Emery
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">
                  {route
                    ? `${route.optimized_at ? "Optimized" : "Saved"} route · ${route.stops.length} stops`
                    : "Build an HPO route"}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {route
                    ? [
                        route.area || "HPO",
                        route.route_date
                          ? new Date(
                              `${route.route_date}T12:00:00`,
                            ).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })
                          : null,
                        route.optimized_duration_seconds
                          ? `${Math.round(route.optimized_duration_seconds / 60)} min drive`
                          : null,
                        route.optimized_distance_meters
                          ? `${(route.optimized_distance_meters / 1609.344).toFixed(1)} mi`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Search or tap offices, choose your stops, then optimize the route."}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {route && onOptimizeRoute ? (
                  <button
                    type="button"
                    onClick={onOptimizeRoute}
                    disabled={optimizing}
                    className="min-h-11 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-45"
                  >
                    {optimizing ? "Optimizing…" : "Optimize"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    openHpoEmery(
                      route
                        ? `Help me with the HPO route for ${route.route_date || "this route"}. Review the optimized stop order and help me change it if needed.`
                        : "I want to build an HPO field route. Ask me for the date and towns/territory if I haven't given them. Review my saved relationship notes and target history, rank the best offices with why-now reasons, let me approve the shortlist, then build and optimize it.",
                      "HPO Route",
                    )
                  }
                  className="min-h-11 rounded-xl border border-primary/35 bg-primary/15 px-3 text-xs font-semibold text-primary"
                >
                  Emery
                </button>
              </div>
            </div>
          )}

          {selectedKeys.length ? (
            <button
              type="button"
              onClick={onBuildRoute}
              className="mt-2 min-h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm"
            >
              {route
                ? `Add ${selectedKeys.length} to Route`
                : `Build Route · ${selectedKeys.length}`}
            </button>
          ) : null}

          <div className="mt-1.5 flex justify-center">
            <button
              type="button"
              onClick={() =>
                onNavigateHpo?.(
                  route?.route_date && route.route_date !== localDateKey()
                    ? "planner"
                    : "today",
                )
              }
              className="min-h-8 px-3 text-[10px] font-semibold text-muted-foreground"
            >
              {route?.route_date && route.route_date !== localDateKey()
                ? "Open Planner"
                : "Open Today"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
