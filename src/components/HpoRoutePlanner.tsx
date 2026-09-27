import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  ExternalLink,
  MapPinned,
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
  optimizeHpoRoute,
  reorderHpoRouteStops,
  updateHpoRouteStop,
} from "@/lib/hpo-route.functions";

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
  stops: Stop[];
};

type Candidate = {
  key: string;
  accountId?: string;
  prospectId?: string;
  officeName: string;
  address: string;
  city?: string | null;
  detail: string;
};

type PlannerData = {
  routes: RoutePlan[];
  accounts: any[];
  prospects: any[];
  today: string;
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
  return `${new Date(route.route_date + "T12:00:00").toLocaleDateString("en-US")} - ${route.area || "Marketing Route"}`;
}

function locationText(stop: Stop) {
  return [stop.address, stop.city].filter(Boolean).join(", ");
}

function RouteMiniMap({ route }: { route: RoutePlan }) {
  const points: Array<{ lat: number; lon: number; label: string; kind: string }> = [];
  if (Number.isFinite(route.start_latitude) && Number.isFinite(route.start_longitude)) {
    points.push({
      lat: Number(route.start_latitude),
      lon: Number(route.start_longitude),
      label: "S",
      kind: "start",
    });
  }
  for (const stop of [...route.stops].sort((a, b) => a.stop_order - b.stop_order)) {
    if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) {
      points.push({
        lat: Number(stop.latitude),
        lon: Number(stop.longitude),
        label: String(stop.stop_order),
        kind: "stop",
      });
    }
  }
  if (Number.isFinite(route.end_latitude) && Number.isFinite(route.end_longitude)) {
    points.push({
      lat: Number(route.end_latitude),
      lon: Number(route.end_longitude),
      label: "E",
      kind: "end",
    });
  }
  if (points.length < 2) return null;

  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLon = Math.min(...points.map((point) => point.lon));
  const maxLon = Math.max(...points.map((point) => point.lon));
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lonSpan = Math.max(maxLon - minLon, 0.01);
  const xy = points.map((point) => ({
    ...point,
    x: 20 + ((point.lon - minLon) / lonSpan) * 280,
    y: 130 - ((point.lat - minLat) / latSpan) * 110,
  }));

  return (
    <div className="overflow-hidden rounded-2xl border border-border/45 bg-card/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold">Optimized route preview</p>
        <p className="text-[10px] text-muted-foreground">Numbered in driving order</p>
      </div>
      <svg viewBox="0 0 320 150" className="h-40 w-full">
        <polyline
          points={xy.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-primary/65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {xy.map((point, index) => (
          <g key={`${point.kind}-${index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r={point.kind === "stop" ? 10 : 9}
              className={point.kind === "stop" ? "fill-primary" : "fill-card stroke-primary"}
              strokeWidth="2"
            />
            <text
              x={point.x}
              y={point.y + 3.5}
              textAnchor="middle"
              className={point.kind === "stop" ? "fill-primary-foreground" : "fill-primary"}
              fontSize="9"
              fontWeight="700"
            >
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
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
  const completed = todayRoute?.stops.filter((stop) => terminalStatuses.has(stop.status)).length ?? 0;

  return (
    <section className="emery-fade-up rounded-[1.55rem] border border-primary/18 bg-primary/[0.045] p-4">
      <div className="flex items-center gap-3">
        <div className="emery-icon-well flex size-11 shrink-0 items-center justify-center rounded-2xl text-primary">
          <RouteIcon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="emery-kicker">Route Planner · Daily Marketing Notes</p>
          <p className="mt-1 truncate text-sm font-semibold">
            {todayRoute ? routeTitle(todayRoute) : "Plan today's field route with Emery"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {todayRoute
              ? `${completed}/${todayRoute.stops.length} stops logged · notes stay tied to today's route`
              : "Build the stop list, optimize the driving order, then log every office visit in one place."}
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
  const reorderStops = useServerFn(reorderHpoRouteStops);
  const captureNote = useServerFn(captureHpoRouteNote);

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
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Couldn't load routes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const activeRoute =
    data?.routes.find((route) => route.id === activeRouteId) ?? data?.routes[0] ?? null;

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

  async function moveStop(route: RoutePlan, stopId: string, delta: number) {
    const ordered = [...route.stops].sort((a, b) => a.stop_order - b.stop_order);
    const index = ordered.findIndex((stop) => stop.id === stopId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    setWorking(true);
    try {
      await reorderStops({ data: { routeId: route.id, stopIds: ordered.map((stop) => stop.id) } });
      await refresh(route.id);
    } finally {
      setWorking(false);
    }
  }

  async function copyExcel(route: RoutePlan) {
    const completed = [...route.stops]
      .sort((a, b) => a.stop_order - b.stop_order)
      .filter((stop) => terminalStatuses.has(stop.status));
    const rows = [
      ["Date", "Office/Account", "Location", "Visit Result", "Notes", "Follow-Up/Next Action"],
      ...completed.map((stop) => [
        route.route_date,
        stop.office_name ?? "",
        locationText(stop),
        stop.visit_outcome ?? stop.status.replaceAll("_", " "),
        stop.notes ?? stop.visit_summary ?? "",
        stop.next_action ?? "",
      ]),
    ];
    const tsv = rows
      .map((row) => row.map((cell) => String(cell).replace(/[\t\n\r]+/g, " ")).join("\t"))
      .join("\n");
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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

  if (loading)
    return (
      <div className="emery-glass flex min-h-52 items-center justify-center rounded-[1.6rem] text-sm text-muted-foreground">
        Opening Route Planner…
      </div>
    );

  return (
    <div id="hpo-route-planner" className="space-y-4">
      <section className="emery-glass rounded-[1.6rem] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="emery-kicker">Route Planner</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">
              Plan → optimize → visit → log.
            </h2>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
              Built into Emery with a familiar multi-stop route-planner workflow. It does not use
              MapQuest. Your route and daily marketing notes stay in HPO.
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

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setShowBuilder(true)}
            className="emery-press flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-3 text-xs font-semibold text-primary-foreground"
          >
            <Plus className="size-4" /> New Route
          </button>
          <button
            type="button"
            onClick={() => activeRoute && void optimizeActive(activeRoute.id)}
            disabled={!activeRoute || optimizing}
            className="emery-press flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/[0.055] px-3 text-xs font-semibold text-primary disabled:opacity-45"
          >
            <Sparkles className="size-4" />
            {optimizing ? "Optimizing…" : "Optimize Route"}
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {showBuilder && data ? (
        <RouteBuilder
          data={data}
          onClose={() => setShowBuilder(false)}
          onCreate={async (payload) => {
            setWorking(true);
            setError(null);
            try {
              const result = await createRoute({ data: payload });
              setShowBuilder(false);
              await refresh(result.routeId);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Couldn't create route.");
            } finally {
              setWorking(false);
            }
          }}
          working={working}
        />
      ) : null}

      {data?.routes.length ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {data.routes.map((route) => {
            const completed = route.stops.filter((stop) => terminalStatuses.has(stop.status)).length;
            return (
              <button
                key={route.id}
                type="button"
                onClick={() => setActiveRouteId(route.id)}
                className={`emery-press min-w-[180px] rounded-2xl border px-3.5 py-3 text-left ${
                  route.id === activeRoute?.id
                    ? "border-primary/25 bg-primary/[0.075]"
                    : "border-border/45 bg-card/35"
                }`}
              >
                <p className="text-xs font-semibold">{formatDate(route.route_date)}</p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {route.area || "Marketing Route"}
                </p>
                <p className="mt-2 text-[10px] text-primary">
                  {completed}/{route.stops.length} stops logged
                </p>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeRoute ? (
        <section className="space-y-4">
          <div className="emery-glass rounded-[1.6rem] p-4">
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
                {copied ? "Copied" : "Copy for Excel"}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="Stops" value={String(activeRoute.stops.length)} />
              <Stat label="Drive" value={formatDuration(activeRoute.optimized_duration_seconds)} />
              <Stat label="Distance" value={formatMiles(activeRoute.optimized_distance_meters)} />
            </div>

            {activeRoute.start_address || activeRoute.end_address ? (
              <div className="mt-3 rounded-xl border border-border/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                {activeRoute.start_address ? <p>Start: {activeRoute.start_address}</p> : null}
                {activeRoute.end_address ? <p>End: {activeRoute.end_address}</p> : null}
              </div>
            ) : null}
          </div>

          <RouteMiniMap route={activeRoute} />

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
                  onSave={async (input) => {
                    setWorking(true);
                    setError(null);
                    try {
                      await updateStop({ data: { stopId: stop.id, ...input } });
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
  onClose,
  onCreate,
  working,
}: {
  data: PlannerData;
  onClose: () => void;
  onCreate: (payload: {
    routeDate: string;
    area: string;
    startAddress: string;
    endAddress: string;
    notes: string;
    stops: Array<{
      accountId?: string | null;
      prospectId?: string | null;
      officeName: string;
      address: string;
      city?: string | null;
      visitPriority?: string | null;
    }>;
  }) => Promise<void>;
  working: boolean;
}) {
  const [routeDate, setRouteDate] = useState(data.today);
  const [area, setArea] = useState("");
  const [startAddress, setStartAddress] = useState("");
  const [endAddress, setEndAddress] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [customName, setCustomName] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [customCity, setCustomCity] = useState("");

  const candidates = useMemo<Candidate[]>(() => {
    const accounts = data.accounts.map((account) => ({
      key: `account:${account.id}`,
      accountId: account.id,
      officeName: account.name,
      address: account.address,
      city: account.city,
      detail: [account.account_type, account.city, `P${account.priority}`].filter(Boolean).join(" · "),
    }));
    const prospects = data.prospects.map((prospect) => ({
      key: `prospect:${prospect.id}`,
      prospectId: prospect.id,
      officeName: prospect.name,
      address: prospect.address,
      city: prospect.city,
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
            Add offices in any order. Optimize after saving and Emery will reorder them for driving.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="emery-press flex size-10 items-center justify-center rounded-xl text-muted-foreground"
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
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-sm outline-none focus:border-primary/30"
        />
        <input
          value={area}
          onChange={(event) => setArea(event.target.value)}
          placeholder="Area — e.g. Jersey City / Hoboken"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-sm outline-none focus:border-primary/30"
        />
        <input
          value={startAddress}
          onChange={(event) => setStartAddress(event.target.value)}
          placeholder="Starting address (optional)"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-sm outline-none focus:border-primary/30 sm:col-span-2"
        />
        <input
          value={endAddress}
          onChange={(event) => setEndAddress(event.target.value)}
          placeholder="Ending address (optional)"
          className="h-12 rounded-xl border border-border/55 bg-card/55 px-3 text-sm outline-none focus:border-primary/30 sm:col-span-2"
        />
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
            className="h-12 w-full rounded-xl border border-border/55 bg-card/55 pl-10 pr-3 text-sm outline-none focus:border-primary/30"
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
              <p className="px-4 py-5 text-center text-xs text-muted-foreground">No saved office matches.</p>
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
            className="h-11 rounded-xl border border-border/50 bg-card/55 px-3 text-sm outline-none focus:border-primary/30"
          />
          <input
            value={customAddress}
            onChange={(event) => setCustomAddress(event.target.value)}
            placeholder="Full street address"
            className="h-11 rounded-xl border border-border/50 bg-card/55 px-3 text-sm outline-none focus:border-primary/30"
          />
          <div className="flex gap-2">
            <input
              value={customCity}
              onChange={(event) => setCustomCity(event.target.value)}
              placeholder="City"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border/50 bg-card/55 px-3 text-sm outline-none focus:border-primary/30"
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
              <div key={stop.key} className="emery-surface flex items-center gap-3 rounded-xl px-3 py-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-[10px] font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{stop.officeName}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{stop.address}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected((current) => current.filter((item) => item.key !== stop.key))}
                  className="emery-press flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground"
                  aria-label={`Remove ${stop.officeName}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Add the offices you want to visit today.</p>
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
            notes: "",
            stops: selected.map((stop) => ({
              accountId: stop.accountId ?? null,
              prospectId: stop.prospectId ?? null,
              officeName: stop.officeName,
              address: stop.address,
              city: stop.city ?? null,
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
  onSave,
}: {
  stop: Stop;
  first: boolean;
  last: boolean;
  working: boolean;
  onMove: (delta: number) => void;
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

  const completed = terminalStatuses.has(status);
  const mapsHref = stop.address
    ? `https://maps.apple.com/?daddr=${encodeURIComponent([stop.address, stop.city].filter(Boolean).join(", "))}`
    : null;

  return (
    <article
      className={`rounded-[1.45rem] border p-4 ${
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
          <p className="truncate text-sm font-semibold">{stop.office_name || "Route stop"}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {locationText(stop) || "Address not saved"}
          </p>
          {stop.drive_seconds_from_previous ? (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-primary/85">
              <Clock3 className="size-3" />
              {formatDuration(stop.drive_seconds_from_previous)} · {formatMiles(stop.distance_meters_from_previous)} from previous
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={first || working}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-border/40 text-muted-foreground disabled:opacity-25"
            aria-label="Move stop up"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={last || working}
            className="emery-press flex size-9 items-center justify-center rounded-xl border border-border/40 text-muted-foreground disabled:opacity-25"
            aria-label="Move stop down"
          >
            <ArrowDown className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {["planned", "completed", "closed", "bad_address", "skipped"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`emery-press min-h-9 shrink-0 rounded-xl border px-2.5 text-[10px] font-semibold capitalize ${
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
        placeholder="Marketing note — saved exactly as typed"
        className="mt-3 min-h-24 w-full resize-none rounded-xl border border-border/50 bg-card/50 px-3 py-2.5 text-sm leading-5 outline-none focus:border-primary/30"
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={visitOutcome}
          onChange={(event) => setVisitOutcome(event.target.value)}
          placeholder="Visit result"
          className="h-11 rounded-xl border border-border/50 bg-card/50 px-3 text-sm outline-none focus:border-primary/30"
        />
        <input
          value={nextAction}
          onChange={(event) => setNextAction(event.target.value)}
          placeholder="Follow-up / next action"
          className="h-11 rounded-xl border border-border/50 bg-card/50 px-3 text-sm outline-none focus:border-primary/30"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="emery-press flex min-h-11 items-center gap-2 rounded-xl border border-border/50 px-3 text-xs font-semibold text-muted-foreground"
          >
            <Navigation className="size-3.5" /> Navigate
            <ExternalLink className="size-3" />
          </a>
        ) : null}
        <button
          type="button"
          disabled={working}
          onClick={() =>
            void onSave({
              status,
              notes,
              visitOutcome,
              nextAction,
              nextActionDueAt: null,
            })
          }
          className="emery-press ml-auto flex min-h-11 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40"
        >
          <CheckCircle2 className="size-3.5" /> Save stop
        </button>
      </div>
    </article>
  );
}