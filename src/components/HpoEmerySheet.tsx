import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronDown,
  Circle,
  LocateFixed,
  MapPin,
  Route as RouteIcon,
  Search,
  Stethoscope,
  X,
} from "lucide-react";
import brainImage from "@/assets/neural-brain.png";
import { EmeryVoiceControl } from "@/components/EmeryVoiceControl";
import { HpoLeafletMap } from "@/components/hpo-map/HpoLeafletMap";
import type { HpoMapOffice } from "@/components/hpo-map/types";
import { HPO_EMERY_EVENT_NAME } from "@/lib/hpo-emery-event";
export { openHpoEmery } from "@/lib/hpo-emery-event";
import { sendEmeryMessage } from "@/lib/emery.functions";
import {
  buildHpoRouteFromSelection,
  getHpoPlannerOffices,
  prepareHpoPlannerGamePlan,
  chatHpoPlannerGamePlan,
  validateHpoPlannerStartingPoint,
} from "@/lib/hpo-route-session.functions";
import {
  HPO_OFFICE_START_ADDRESS,
  type PlannerGamePlan,
  type PlannerStartingPoint,
} from "@/lib/hpo-planner-selection";

const EVENT_NAME = HPO_EMERY_EVENT_NAME;
const MAX_ROUTE_STOPS = 30;

type HpoEmeryDetail = {
  prompt?: string;
  title?: string;
  autoSend?: boolean;
  routeDate?: string | null;
  plannerBuild?: boolean;
};

type RouteRecommendationCandidate = {
  score?: number;
  accountId?: string | null;
  prospectId?: string | null;
  officeName: string;
  address?: string | null;
  city?: string | null;
  priorityLabel?: string | null;
  kind?: "account" | "prospect";
  accountType?: string | null;
  specialty?: string | null;
  relationshipStage?: string | null;
  relationshipHealth?: string | null;
  ownerName?: string | null;
  priority?: number | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
  lastTouchAt?: string | null;
  latestOutcome?: string | null;
  latestSignal?: string | null;
  latestNote?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  reasons?: string[];
  veinTarget?: boolean;
  veinFit?: string | null;
  veinPriorityScore?: number | null;
  veinVisitStatus?: string | null;
  lunchTarget?: boolean;
  tags?: string[];
  gamePlan?: PlannerGamePlan;
};

type RouteRecommendation = {
  area?: string | null;
  routeDate?: string | null;
  requestedCount?: number | null;
  eligibleCount?: number | null;
  candidates: RouteRecommendationCandidate[];
  allCandidates?: RouteRecommendationCandidate[];
};

type MiniMessage = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  recommendation?: RouteRecommendation | null;
};

type RecommendationGroup =
  "Doctors / Medical" | "Attorneys" | "PT / Chiro" | "Other";

function candidateKey(candidate: RouteRecommendationCandidate) {
  if (candidate.accountId) return `account:${candidate.accountId}`;
  if (candidate.prospectId) return `prospect:${candidate.prospectId}`;
  return `office:${candidate.officeName}:${candidate.city ?? ""}`;
}

function categoryFor(
  candidate: RouteRecommendationCandidate,
): RecommendationGroup {
  const type = [
    candidate.accountType,
    candidate.specialty,
    candidate.kind === "prospect" ? candidate.accountType : null,
    candidate.officeName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/attorney|law\b|law firm|legal/.test(type)) return "Attorneys";
  if (/chiropr|physical therapy|\bpt\b|physiotherap/.test(type))
    return "PT / Chiro";
  if (
    /primary care|\bpcp\b|provider|doctor|physician|medical|family medicine|internal medicine|urgent care|clinic|health/.test(
      type,
    )
  )
    return "Doctors / Medical";
  return "Other";
}

function categoryIcon(group: RecommendationGroup) {
  if (group === "Doctors / Medical") return Stethoscope;
  if (group === "Attorneys") return BriefcaseBusiness;
  if (group === "PT / Chiro") return Building2;
  return Building2;
}

function tagLabel(tag: string) {
  const labels: Record<string, string> = {
    vein_prospect: "VEIN PROSPECT",
    lunch_target: "LUNCH TARGET",
    need_to_visit: "NEED TO VISIT",
    warm_relationship: "WARM RELATIONSHIP",
    lunch_set: "LUNCH SET",
  };
  return (
    labels[tag] ??
    tag
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function tagClasses(tag: string) {
  if (tag === "vein_prospect")
    return "border-cyan-400/35 bg-cyan-400/10 text-cyan-300";
  if (tag === "lunch_target")
    return "border-amber-400/35 bg-amber-400/10 text-amber-300";
  if (tag === "need_to_visit")
    return "border-violet-400/35 bg-violet-400/10 text-violet-300";
  if (tag === "warm_relationship")
    return "border-emerald-400/35 bg-emerald-400/10 text-emerald-300";
  if (tag === "lunch_set")
    return "border-green-400/35 bg-green-400/10 text-green-300";
  return "border-border bg-accent/35 text-foreground/80";
}

function normalizeSelectionText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function applySelectionInstruction(
  message: string,
  candidates: RouteRecommendationCandidate[],
  currentKeys: string[],
) {
  if (!candidates.length) return { keys: currentKeys, changed: false };
  const text = normalizeSelectionText(message);
  const set = new Set(currentKeys);
  let changed = false;

  const categoryInstruction = (group: RecommendationGroup, aliases: RegExp) => {
    if (!aliases.test(text)) return false;
    const keys = candidates
      .filter((candidate) => categoryFor(candidate) === group)
      .map(candidateKey);
    if (!keys.length) return false;

    if (/\b(?:remove|clear|drop|exclude)\b/.test(text)) {
      for (const key of keys) set.delete(key);
      changed = true;
      return true;
    }
    if (/\b(?:only|use|select|include|keep)\b/.test(text)) {
      if (/\bonly\b/.test(text)) set.clear();
      for (const key of keys) {
        if (set.size >= MAX_ROUTE_STOPS) break;
        set.add(key);
      }
      changed = true;
      return true;
    }
    return false;
  };

  categoryInstruction("Attorneys", /\b(?:attorneys?|law firms?|lawyers?)\b/);
  categoryInstruction(
    "Doctors / Medical",
    /\b(?:doctors?|medical|pcps?|primary care|providers?|physicians?)\b/,
  );
  categoryInstruction(
    "PT / Chiro",
    /\b(?:pt|physical therapy|chiro|chiropractors?)\b/,
  );

  if (/\b(?:vein|veins|vascular|venous)\b/.test(text)) {
    const keys = candidates
      .filter((candidate) => candidate.veinTarget)
      .map(candidateKey);
    if (/\b(?:remove|clear|drop|exclude)\b/.test(text)) {
      for (const key of keys) set.delete(key);
      changed = true;
    } else if (/\b(?:only|use|select|include|keep)\b/.test(text)) {
      if (/\bonly\b/.test(text)) set.clear();
      for (const key of keys) {
        if (set.size >= MAX_ROUTE_STOPS) break;
        set.add(key);
      }
      changed = true;
    }
  }

  const availableTags = [
    ...new Set(candidates.flatMap((candidate) => candidate.tags ?? [])),
  ];
  for (const tag of availableTags) {
    const phrase = normalizeSelectionText(tag.replace(/[_-]+/g, " "));
    if (!phrase || !text.includes(phrase)) continue;
    const keys = candidates
      .filter((candidate) => candidate.tags?.includes(tag))
      .map(candidateKey);
    if (/\b(?:remove|clear|drop|exclude)\b/.test(text)) {
      for (const key of keys) set.delete(key);
      changed = true;
    } else if (/\b(?:only|use|select|include|keep)\b/.test(text)) {
      if (/\bonly\b/.test(text)) set.clear();
      for (const key of keys) {
        if (set.size >= MAX_ROUTE_STOPS) break;
        set.add(key);
      }
      changed = true;
    }
  }

  const removeMode = /\b(?:remove|drop|exclude|take out)\b/.test(text);
  const addMode = /\b(?:add|include|select|put back|keep)\b/.test(text);
  if (removeMode || addMode) {
    for (const candidate of candidates) {
      const name = normalizeSelectionText(candidate.officeName);
      if (!name || !text.includes(name)) continue;
      const key = candidateKey(candidate);
      if (removeMode) set.delete(key);
      else if (set.size < MAX_ROUTE_STOPS) set.add(key);
      changed = true;
    }
  }

  return { keys: [...set], changed };
}

function cleanMarkdown(text: string) {
  return text.replace(/\*\*/g, "").replace(/^[-•]\s*/gm, "• ");
}

function PlainMessage({ text }: { text: string }) {
  const cleaned = cleanMarkdown(text);
  const lines = cleaned.split(/\n+/).filter((line) => line.trim());
  if (lines.length <= 1) return <>{cleaned}</>;
  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => (
        <p key={`${index}-${line.slice(0, 20)}`} className="leading-6">
          {line}
        </p>
      ))}
    </div>
  );
}

export function HpoEmerySheet({
  onChanged,
  onRouteBuilt,
  routeId,
  stopId,
  selectedAccountId,
  surface = "hpo",
}: {
  onChanged?: () => void;
  onRouteBuilt?: (routeId: string, routeDate: string) => void;
  routeId?: string | null;
  stopId?: string | null;
  selectedAccountId?: string | null;
  surface?: string;
}) {
  const askEmery = useServerFn(sendEmeryMessage);
  const buildSelection = useServerFn(buildHpoRouteFromSelection);
  const loadPlannerOffices = useServerFn(getHpoPlannerOffices);
  const preparePlanner = useServerFn(prepareHpoPlannerGamePlan);
  const askPlanner = useServerFn(chatHpoPlannerGamePlan);
  const validateStart = useServerFn(validateHpoPlannerStartingPoint);
  const busyRef = useRef(false);
  const [plannerBuild, setPlannerBuild] = useState(false);
  const [plannerPhase, setPlannerPhase] = useState<"select" | "plan" | "start">(
    "select",
  );
  const [gamePlans, setGamePlans] = useState<RouteRecommendationCandidate[]>(
    [],
  );
  const [visitTypes, setVisitTypes] = useState<
    Record<string, "lunch" | "office_visit">
  >({});
  const [startChoice, setStartChoice] = useState<
    PlannerStartingPoint["kind"] | null
  >(null);
  const [startingPoint, setStartingPoint] =
    useState<PlannerStartingPoint | null>(null);
  const [customStartAddress, setCustomStartAddress] = useState("");
  const [validatingStart, setValidatingStart] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const jumpToTopRef = useRef(false);
  const sessionRef = useRef<string>("");

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("HPO");
  const [sessionRouteDate, setSessionRouteDate] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MiniMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [autoPrompt, setAutoPrompt] = useState("");
  const [recommendation, setRecommendation] =
    useState<RouteRecommendation | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(true);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [officeQuery, setOfficeQuery] = useState("");
  const [selectionView, setSelectionView] = useState<"list" | "map">("list");
  const [selectedMapOfficeKey, setSelectedMapOfficeKey] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<
    Record<RecommendationGroup, boolean>
  >({
    "Doctors / Medical": false,
    Attorneys: false,
    "PT / Chiro": false,
    Other: false,
  });

  busyRef.current = building;
  useEffect(() => {
    const handler = (event: Event) => {
      if (busyRef.current) return;
      const detail = (event as CustomEvent<HpoEmeryDetail>).detail ?? {};
      sessionRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `hpo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const session = sessionRef.current;
      setPlannerBuild(detail.plannerBuild === true);
      setPlannerPhase("select");
      setGamePlans([]);
      setVisitTypes({});
      setStartChoice(null);
      setStartingPoint(null);
      setCustomStartAddress("");
      setValidatingStart(false);
      setTitle(detail.title || "HPO");
      setSessionRouteDate(detail.routeDate ?? null);
      setDraft(detail.autoSend ? "" : detail.prompt || "");
      setAutoPrompt(
        !detail.plannerBuild && detail.autoSend ? detail.prompt || "" : "",
      );
      setMessages([]);
      setRecommendation(null);
      setSelectedKeys([]);
      setShowAll(true);
      setActiveTag(null);
      setOfficeQuery("");
      setSelectionView("list");
      setSelectedMapOfficeKey(null);
      setOpenGroups({
        "Doctors / Medical": false,
        Attorneys: false,
        "PT / Chiro": false,
        Other: false,
      });
      setError("");
      setPending(false);
      setBuilding(false);
      setOpen(true);
      if (detail.plannerBuild) {
        setPending(true);
        void loadPlannerOffices({})
          .then((pool) => {
            if (sessionRef.current !== session) return;
            setRecommendation({ ...pool, routeDate: detail.routeDate ?? null });
          })
          .catch((cause) => {
            if (sessionRef.current === session)
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Couldn't load saved offices.",
              );
          })
          .finally(() => {
            if (sessionRef.current === session) setPending(false);
          });
      } else window.setTimeout(() => inputRef.current?.focus(), 80);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const lastMessage = messages[messages.length - 1];
      if (
        recommendation &&
        (jumpToTopRef.current || Boolean(lastMessage?.recommendation))
      ) {
        jumpToTopRef.current = false;
        scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
        return;
      }
      endRef.current?.scrollIntoView({
        block: "end",
        behavior: pending || building ? "smooth" : "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, pending, building, error, open, recommendation]);

  useEffect(() => {
    if (!open || !autoPrompt || pending) return;
    const prompt = autoPrompt;
    setAutoPrompt("");
    const timer = window.setTimeout(() => {
      void sendText(prompt, false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [autoPrompt, open, pending]);

  const allCandidates = useMemo(() => {
    if (!recommendation) return [];
    const source = recommendation.allCandidates?.length
      ? recommendation.allCandidates
      : (recommendation.candidates ?? []);
    const seen = new Set<string>();
    return source.filter((candidate) => {
      const key = candidateKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [recommendation]);

  const recommendedKeys = useMemo(
    () => new Set((recommendation?.candidates ?? []).map(candidateKey)),
    [recommendation],
  );

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of allCandidates) {
      for (const tag of candidate.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const order = [
      "vein_prospect",
      "lunch_target",
      "need_to_visit",
      "warm_relationship",
      "lunch_set",
    ];
    return [...counts.entries()]
      .sort(([left], [right]) => {
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
          if (leftIndex === -1) return 1;
          if (rightIndex === -1) return -1;
          return leftIndex - rightIndex;
        }
        return tagLabel(left).localeCompare(tagLabel(right));
      })
      .map(([tag, count]) => ({ tag, count }));
  }, [allCandidates]);

  const visibleCandidates = (
    showAll
      ? allCandidates
      : allCandidates.filter((candidate) =>
          recommendedKeys.has(candidateKey(candidate)),
        )
  )
    .filter((candidate) =>
      activeTag ? candidate.tags?.includes(activeTag) : true,
    )
    .filter((candidate) => {
      const needle = officeQuery.trim().toLowerCase();
      if (!needle) return true;
      return [
        candidate.officeName,
        candidate.address,
        candidate.city,
        candidate.accountType,
        candidate.specialty,
        candidate.relationshipStage,
        candidate.latestNote,
        ...(candidate.tags ?? []).map(tagLabel),
        ...(candidate.reasons ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

  const grouped = useMemo(() => {
    const result: Record<RecommendationGroup, RouteRecommendationCandidate[]> =
      {
        "Doctors / Medical": [],
        Attorneys: [],
        "PT / Chiro": [],
        Other: [],
      };
    for (const candidate of visibleCandidates)
      result[categoryFor(candidate)].push(candidate);
    return result;
  }, [visibleCandidates]);

  const selectedCandidates = useMemo(() => {
    const selectedSet = new Set(selectedKeys);
    return allCandidates.filter((candidate) =>
      selectedSet.has(candidateKey(candidate)),
    );
  }, [allCandidates, selectedKeys]);

  const mapOffices = useMemo<HpoMapOffice[]>(
    () =>
      allCandidates
        .filter(
          (candidate) =>
            Boolean(candidate.address?.trim()) &&
            Number.isFinite(Number(candidate.latitude)) &&
            Number.isFinite(Number(candidate.longitude)),
        )
        .map((candidate) => ({
          key: candidateKey(candidate),
          accountId: candidate.accountId ?? undefined,
          prospectId: candidate.prospectId ?? undefined,
          officeName: candidate.officeName,
          address: candidate.address ?? "",
          city: candidate.city ?? null,
          latitude: candidate.latitude ?? null,
          longitude: candidate.longitude ?? null,
          detail:
            candidate.latestNote ||
            candidate.nextAction ||
            "No recent note saved for this office.",
          kind:
            candidate.kind ??
            (candidate.accountId ? ("account" as const) : ("prospect" as const)),
          accountType: candidate.accountType ?? null,
          specialty: candidate.specialty ?? null,
          relationshipStage: candidate.relationshipStage ?? null,
          relationshipHealth: candidate.relationshipHealth ?? null,
          lastTouchAt: candidate.lastTouchAt ?? null,
          nextAction: candidate.nextAction ?? null,
          nextActionDueAt: candidate.nextActionDueAt ?? null,
          mapped: true,
        })),
    [allCandidates],
  );

  function installRecommendation(next: RouteRecommendation) {
    const pool = next.allCandidates?.length
      ? next.allCandidates
      : next.candidates;
    jumpToTopRef.current = true;
    setRecommendation({ ...next, allCandidates: pool });
    const initial = (next.candidates ?? []).map(candidateKey);
    setSelectedKeys(initial);
    if (next.routeDate) setSessionRouteDate(next.routeDate);
    setShowAll(true);
    setActiveTag(null);
    setOfficeQuery("");
    setOpenGroups({
      "Doctors / Medical": false,
      Attorneys: false,
      "PT / Chiro": false,
      Other: false,
    });
  }

  async function sendText(text: string, showUser: boolean) {
    const clean = text.trim();
    if (!clean || pending || building) return;
    if (plannerBuild) {
      if (plannerPhase !== "plan") return;
      const session = sessionRef.current;
      const prior = messages;
      setPending(true);
      setError("");
      setMessages((current) => [...current, { role: "user", text: clean }]);
      setDraft("");
      try {
        const result = await askPlanner({
          data: {
            routeDate: sessionRouteDate!,
            selected: selectedCandidates.map((c) => ({
              accountId: c.accountId ?? null,
              prospectId: c.prospectId ?? null,
              visitType: visitTypes[candidateKey(c)] ?? "office_visit",
            })),
            message: clean,
            history: prior,
          },
        });
        if (sessionRef.current === session)
          setMessages((current) => [
            ...current,
            { role: "assistant", text: result.reply },
          ]);
      } catch (cause) {
        if (sessionRef.current === session)
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn't review that question.",
          );
      } finally {
        if (sessionRef.current === session) setPending(false);
      }
      return;
    }
    const selectionInstruction = applySelectionInstruction(
      clean,
      allCandidates,
      selectedKeys,
    );
    const selectionKeysForTurn = selectionInstruction.changed
      ? selectionInstruction.keys
      : selectedKeys;
    const selectionSetForTurn = new Set(selectionKeysForTurn);
    const selectedForTurn = allCandidates.filter((candidate) =>
      selectionSetForTurn.has(candidateKey(candidate)),
    );
    if (selectionInstruction.changed) setSelectedKeys(selectionKeysForTurn);
    if (showUser) {
      setMessages((current) => [...current, { role: "user", text: clean }]);
      setDraft("");
    }
    setPending(true);
    setError("");
    try {
      const result = await askEmery({
        data: {
          message: clean,
          attachments: [],
          source: {
            entryPoint: "chat",
            inputMode: "typed",
            surface,
            hpoRouteId: routeId ?? null,
            hpoRouteDate: sessionRouteDate,
            hpoStopId: stopId ?? null,
            selectedAccountId: selectedAccountId ?? null,
            hpoEphemeral: true,
            hpoEphemeralSession: sessionRef.current || null,
            hpoPlanningArea: recommendation?.area ?? null,
            hpoPlanningActiveTag: activeTag,
            hpoPlanningAccountIds: allCandidates
              .map((candidate) => candidate.accountId)
              .filter((id): id is string => Boolean(id)),
            hpoPlanningProspectIds: allCandidates
              .map((candidate) => candidate.prospectId)
              .filter((id): id is string => Boolean(id)),
            hpoPlanningSelectedAccountIds: selectedForTurn
              .map((candidate) => candidate.accountId)
              .filter((id): id is string => Boolean(id)),
            hpoPlanningSelectedProspectIds: selectedForTurn
              .map((candidate) => candidate.prospectId)
              .filter((id): id is string => Boolean(id)),
          },
        },
      });
      if (!("reply" in result) || !result.reply) {
        throw new Error(
          ("error" in result && result.error) ||
            "Emery couldn't complete that.",
        );
      }
      const routeCommand =
        "hpoRouteCommand" in result ? (result as any).hpoRouteCommand : null;
      const nextRecommendation =
        routeCommand?.action === "hpo.route.recommend" &&
        routeCommand?.receiptData?.recommendation
          ? (routeCommand.receiptData.recommendation as RouteRecommendation)
          : null;

      if (nextRecommendation) installRecommendation(nextRecommendation);

      setMessages((current) => [
        ...current,
        {
          id:
            "assistantMessage" in result
              ? result.assistantMessage?.id
              : undefined,
          role: "assistant",
          text: nextRecommendation
            ? `I reviewed the territory and ranked the offices below. Tap any office to include or remove it from your route.`
            : result.reply,
          recommendation: nextRecommendation,
        },
      ]);
      onChanged?.();

      if (
        routeCommand?.performed &&
        routeCommand?.action === "hpo.route.create" &&
        routeCommand?.routeId
      ) {
        const builtRouteId = String(routeCommand.routeId);
        const builtDate =
          routeCommand?.receiptData?.routeDate ??
          recommendation?.routeDate ??
          sessionRouteDate;
        if (builtDate) {
          window.setTimeout(() => {
            setOpen(false);
            onRouteBuilt?.(builtRouteId, String(builtDate));
          }, 500);
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Emery couldn't complete that.",
      );
    } finally {
      setPending(false);
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }

  async function send() {
    const clean = draft.trim();
    if (!clean || pending || building) return;
    await sendText(clean, true);
  }

  function toggleCandidate(candidate: RouteRecommendationCandidate) {
    if (pending || building) return;
    const key = candidateKey(candidate);
    setSelectedKeys((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (current.length >= MAX_ROUTE_STOPS) {
        setError(
          `Keep a single optimized route to ${MAX_ROUTE_STOPS} stops or fewer.`,
        );
        return current;
      }
      setError("");
      return [...current, key];
    });
  }

  function selectTop(count: number) {
    setSelectedKeys(allCandidates.slice(0, count).map(candidateKey));
  }

  function selectVeinTargets() {
    const keys = allCandidates
      .filter((candidate) => candidate.tags?.includes("vein_prospect"))
      .slice(0, MAX_ROUTE_STOPS)
      .map(candidateKey);
    setSelectedKeys(keys);
    setActiveTag("vein_prospect");
    setError("");
  }

  function selectGroup(group: RecommendationGroup) {
    if (pending || building) return;
    const keys = grouped[group].map(candidateKey);
    const allSelected =
      keys.length > 0 && keys.every((key) => selectedKeys.includes(key));
    setSelectedKeys((current) => {
      const set = new Set(current);
      if (allSelected) {
        for (const key of keys) set.delete(key);
        setError("");
        return [...set];
      }
      for (const key of keys) {
        if (set.size >= MAX_ROUTE_STOPS) break;
        set.add(key);
      }
      if (keys.some((key) => !set.has(key))) {
        setError(
          `I selected the first ${MAX_ROUTE_STOPS} offices only. Keep one optimized route to ${MAX_ROUTE_STOPS} stops or fewer.`,
        );
      } else {
        setError("");
      }
      return [...set];
    });
  }

  async function finishSelection() {
    if (!selectedCandidates.length || pending || building || !sessionRouteDate)
      return;
    const session = sessionRef.current;
    setPending(true);
    setError("");
    try {
      const plans = await preparePlanner({
        data: {
          routeDate: sessionRouteDate,
          selected: selectedCandidates,
          sessionId: session,
        },
      });
      if (sessionRef.current !== session) return;
      setGamePlans(plans);
      setPlannerPhase("plan");
      setMessages([
        {
          role: "assistant",
          text: "Which stops are lunches? Every stop starts as Office Visit. Mark any lunches below, review your saved-history game plan, then tap Finalize Route.",
        },
      ]);
      setOfficeQuery("");
      setActiveTag(null);
      scrollRef.current?.scrollTo({ top: 0 });
    } catch (cause) {
      if (sessionRef.current === session)
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't prepare your selected offices.",
        );
    } finally {
      if (sessionRef.current === session) setPending(false);
    }
  }

  async function buildRoute() {
    if (!recommendation || !selectedCandidates.length || building || pending)
      return;
    const routeDate = plannerBuild
      ? sessionRouteDate
      : recommendation.routeDate || sessionRouteDate;
    if (!routeDate) {
      setError(
        "Choose the route day from Planner first so I know where to save this route.",
      );
      return;
    }
    if (plannerBuild && !startingPoint) {
      setPlannerPhase("start");
      setError("Choose and validate where you are starting this route.");
      return;
    }

    setBuilding(true);
    setError("");
    try {
      const result = await buildSelection({
        data: {
          routeDate,
          area: recommendation.area ?? null,
          sessionId: sessionRef.current || null,
          selected: selectedCandidates.map((candidate) => ({
            accountId: candidate.accountId ?? null,
            prospectId: candidate.prospectId ?? null,
            visitType: visitTypes[candidateKey(candidate)] ?? "office_visit",
          })),
          planningMessages: plannerBuild ? messages : [],
          plannerBuild,
          startingPoint: plannerBuild ? startingPoint : null,
        },
      });
      onChanged?.();
      setOpen(false);
      onRouteBuilt?.(String(result.routeId), String(result.routeDate));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "I couldn't build that route safely.",
      );
    } finally {
      setBuilding(false);
    }
  }

  async function chooseStartingPoint(kind: PlannerStartingPoint["kind"]) {
    if (validatingStart || building) return;
    setStartChoice(kind);
    setStartingPoint(null);
    setError("");
    if (kind === "custom_address") return;
    setValidatingStart(true);
    try {
      let latitude: number | null = null;
      let longitude: number | null = null;
      if (kind === "current_location") {
        if (typeof navigator === "undefined" || !navigator.geolocation)
          throw new Error(
            "Current Location is unavailable. Choose HPO Office or Custom Address.",
          );
        const point = await new Promise<{
          latitude: number;
          longitude: number;
        }>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (position) =>
              resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }),
            () =>
              reject(
                new Error(
                  "Location access was not available. Choose HPO Office or Custom Address.",
                ),
              ),
            { enableHighAccuracy: true, maximumAge: 60_000, timeout: 8_000 },
          );
        });
        latitude = point.latitude;
        longitude = point.longitude;
      }
      const validated = await validateStart({
        data: {
          kind,
          address: kind === "hpo_office" ? HPO_OFFICE_START_ADDRESS : null,
          latitude,
          longitude,
        },
      });
      setStartingPoint(validated);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't validate that starting point.",
      );
    } finally {
      setValidatingStart(false);
    }
  }

  async function validateCustomStartingPoint() {
    if (validatingStart || building) return;
    setStartChoice("custom_address");
    setStartingPoint(null);
    setValidatingStart(true);
    setError("");
    try {
      const validated = await validateStart({
        data: {
          kind: "custom_address",
          address: customStartAddress,
        },
      });
      setStartingPoint(validated);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't validate that address.",
      );
    } finally {
      setValidatingStart(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end bg-black/55 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-4"
      onClick={() => !building && setOpen(false)}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Ask Emery"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[1.6rem] border border-border/60 bg-background shadow-[0_-24px_70px_rgba(0,0,0,0.45)] sm:rounded-[1.4rem]"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border/80 sm:hidden" />
        <div className="flex shrink-0 items-center gap-3 border-b border-border/45 px-4 py-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/15 bg-primary/[0.05]">
            <img
              src={brainImage}
              alt=""
              className="emery-blue-brain size-9 object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Emery</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {title} ·{" "}
              {plannerBuild && plannerPhase === "select"
                ? "Select offices"
                : plannerBuild && plannerPhase === "start"
                  ? "Starting point"
                  : "route game plan"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !building && setOpen(false)}
            className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            aria-label="Close Emery"
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        >
          {!messages.length && !pending ? (
            <p className="px-1 text-sm leading-6 text-muted-foreground">
              {plannerBuild
                ? "Choose the saved offices you want to visit, then tap Done."
                : "Emery is reviewing your HPO relationship history and target offices for this route."}
            </p>
          ) : null}

          {messages.map((message, index) => {
            if (message.recommendation) {
              return (
                <div
                  key={`recommendation-${index}`}
                  className="rounded-2xl bg-card px-3.5 py-3 text-sm text-foreground"
                >
                  {message.text}
                </div>
              );
            }
            return (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === "user"
                    ? "flex justify-end"
                    : "flex justify-start"
                }
              >
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-6 text-primary-foreground"
                      : "max-w-[94%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 text-sm leading-6 text-foreground"
                  }
                >
                  <PlainMessage text={message.text} />
                </div>
              </div>
            );
          })}

          {recommendation && (!plannerBuild || plannerPhase === "select") ? (
            <section className="space-y-3">
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.05] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {plannerBuild ? "Select Offices" : "Office game plan"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {plannerBuild && selectionView === "map"
                        ? "Use the map to find nearby offices and select stops."
                        : "Search or open a group to review and select offices."}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      {recommendation.area || "Selected territory"}
                      {recommendation.routeDate || sessionRouteDate
                        ? ` · ${new Date(
                            `${recommendation.routeDate || sessionRouteDate}T12:00:00`,
                          ).toLocaleDateString([], {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}`
                        : ""}
                      {" · "}
                      {recommendation.eligibleCount ??
                        allCandidates.length}{" "}
                      available offices
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">
                    {selectedKeys.length} selected · max {MAX_ROUTE_STOPS}
                  </span>
                </div>

                {plannerBuild ? (
                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-background/45 p-1">
                    <button
                      type="button"
                      aria-pressed={selectionView === "list"}
                      onClick={() => setSelectionView("list")}
                      className={
                        selectionView === "list"
                          ? "min-h-10 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                          : "min-h-10 rounded-lg px-3 text-xs font-semibold text-muted-foreground"
                      }
                    >
                      Search & List
                    </button>
                    <button
                      type="button"
                      aria-pressed={selectionView === "map"}
                      onClick={() => {
                        setSelectionView("map");
                        setOfficeQuery("");
                      }}
                      className={
                        selectionView === "map"
                          ? "min-h-10 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                          : "min-h-10 rounded-lg px-3 text-xs font-semibold text-muted-foreground"
                      }
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-3.5" />
                        Map
                      </span>
                    </button>
                  </div>
                ) : null}

                {plannerBuild && selectionView === "map" ? (
                  <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                    Find nearby offices visually. Tap a pin, review the latest note, then choose Select Office. Your selections stay synced with Search & List.
                  </p>
                ) : null}

                {!plannerBuild || selectionView === "list" ? (
                  <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAll(false)}
                    className={
                      !showAll
                        ? "min-h-9 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
                        : "min-h-9 rounded-xl border border-border px-3 text-[11px] font-semibold text-muted-foreground"
                    }
                  >
                    Recommended {recommendation.candidates.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className={
                      showAll
                        ? "min-h-9 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
                        : "min-h-9 rounded-xl border border-border px-3 text-[11px] font-semibold text-muted-foreground"
                    }
                  >
                    All offices {allCandidates.length}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveTag((current) =>
                        current === "vein_prospect" ? null : "vein_prospect",
                      )
                    }
                    className={
                      activeTag === "vein_prospect"
                        ? "min-h-9 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
                        : "min-h-9 rounded-xl border border-primary/25 bg-background/40 px-3 text-[11px] font-semibold text-primary"
                    }
                  >
                    Vein prospects{" "}
                    {
                      allCandidates.filter((candidate) =>
                        candidate.tags?.includes("vein_prospect"),
                      ).length
                    }
                  </button>
                  {!plannerBuild &&
                  allCandidates.some((candidate) => candidate.veinTarget) ? (
                    <button
                      type="button"
                      onClick={selectVeinTargets}
                      className="min-h-9 rounded-xl border border-primary/25 bg-background/40 px-3 text-[11px] font-semibold text-primary"
                    >
                      Select vein targets
                    </button>
                  ) : null}
                  {(!plannerBuild ? [5, 8, 10, 15] : [])
                    .filter((count) => count <= allCandidates.length)
                    .map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => selectTop(count)}
                        className="min-h-9 rounded-xl border border-primary/25 bg-background/40 px-3 text-[11px] font-semibold text-primary"
                      >
                        Select top {count}
                      </button>
                    ))}
                </div>

                {availableTags.length ? (
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Filter by tag
                      </p>
                      {activeTag ? (
                        <button
                          type="button"
                          onClick={() => setActiveTag(null)}
                          className="text-[9px] font-semibold text-primary"
                        >
                          Show all
                        </button>
                      ) : null}
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {availableTags.map(({ tag, count }) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            setActiveTag((current) =>
                              current === tag ? null : tag,
                            )
                          }
                          className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[9px] font-bold tracking-[0.04em] ${
                            activeTag === tag
                              ? `${tagClasses(tag)} ring-1 ring-current/30`
                              : tagClasses(tag)
                          }`}
                        >
                          {tagLabel(tag)} · {count}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background/45 px-3">
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    value={officeQuery}
                    onChange={(event) => setOfficeQuery(event.target.value)}
                    placeholder="Search offices, town, type or note"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                  />
                  {officeQuery ? (
                    <button
                      type="button"
                      onClick={() => setOfficeQuery("")}
                      className="text-[10px] font-semibold text-primary"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                {!plannerBuild ? (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {[
                      "Which vein tracker doctors in this territory should I prioritize for lunches, especially offices I have not visited?",
                      "Compare my selected offices and tell me which ones matter most.",
                      "Which of these offices have I visited before and what happened?",
                      "Which attorneys in this territory should I prioritize and why?",
                      "Which offices have overdue follow-ups or a clear next action?",
                    ].map((prompt, index) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={pending || building}
                        onClick={() => void sendText(prompt, true)}
                        className="min-h-9 shrink-0 rounded-xl border border-border bg-background/40 px-3 text-[10px] font-semibold text-foreground disabled:opacity-40"
                      >
                        {
                          [
                            "Vein lunches",
                            "Compare selected",
                            "Prior visits",
                            "Best attorneys",
                            "Follow-ups",
                          ][index]
                        }
                      </button>
                    ))}
                  </div>
                ) : null}
                  </>
                ) : null}
              </div>

              {plannerBuild && selectionView === "map" ? (
                mapOffices.length ? (
                  <div className="h-[58dvh] min-h-[440px] max-h-[640px] overflow-hidden rounded-2xl border border-border/60 bg-card/40 shadow-sm">
                    <HpoLeafletMap
                      embeddedSelection
                      offices={mapOffices}
                      selectedKeys={selectedKeys}
                      selectedOfficeKey={selectedMapOfficeKey}
                      onSelectOffice={setSelectedMapOfficeKey}
                      onToggleRouteStop={(office) => {
                        const candidate = allCandidates.find(
                          (item) => candidateKey(item) === office.key,
                        );
                        if (candidate) toggleCandidate(candidate);
                      }}
                      onBuildRoute={() => {}}
                      preparing={false}
                      onRefreshPins={() => {}}
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border/60 bg-card/50 p-5 text-center">
                    <MapPin className="mx-auto size-6 text-primary" />
                    <p className="mt-2 text-sm font-semibold">No mapped offices available</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Switch to Search & List to review saved offices.
                    </p>
                  </div>
                )
              ) : (
                <>
              {(
                [
                  "Doctors / Medical",
                  "Attorneys",
                  "PT / Chiro",
                  "Other",
                ] as RecommendationGroup[]
              ).map((group) => {
                const candidates = grouped[group];
                if (!candidates.length) return null;
                const Icon = categoryIcon(group);
                const allGroupSelected = candidates.every((candidate) =>
                  selectedKeys.includes(candidateKey(candidate)),
                );
                return (
                  <div
                    key={group}
                    className="overflow-hidden rounded-2xl border border-border/60 bg-card/50"
                  >
                    <div className="flex items-center gap-2 border-b border-border/45 px-3 py-2.5">
                      <button
                        type="button"
                        aria-expanded={openGroups[group]}
                        onClick={() =>
                          setOpenGroups((current) => ({
                            ...current,
                            [group]: !current[group],
                          }))
                        }
                        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Icon className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 text-sm font-semibold">
                          {group}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {candidates.length}
                          {candidates.some((candidate) =>
                            selectedKeys.includes(candidateKey(candidate)),
                          )
                            ? ` · ${candidates.filter((candidate) => selectedKeys.includes(candidateKey(candidate))).length} selected`
                            : ""}
                        </span>
                        <ChevronDown
                          className={`size-4 text-muted-foreground transition-transform ${
                            openGroups[group] ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => selectGroup(group)}
                        className="min-h-9 shrink-0 rounded-xl border border-border px-2.5 text-[10px] font-semibold text-primary"
                      >
                        {allGroupSelected ? "Clear" : "Select all"}
                      </button>
                    </div>

                    {openGroups[group] ? (
                      <div className="divide-y divide-border/40">
                        {candidates.map((candidate) => {
                          const key = candidateKey(candidate);
                          const selected = selectedKeys.includes(key);
                          const recommended = recommendedKeys.has(key);
                          return (
                            <div
                              key={key}
                              role="button"
                              tabIndex={0}
                              aria-pressed={selected}
                              onClick={() => toggleCandidate(candidate)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  toggleCandidate(candidate);
                                }
                              }}
                              className={
                                selected
                                  ? "w-full cursor-pointer bg-primary/[0.055] px-3 py-3 text-left"
                                  : "w-full cursor-pointer px-3 py-3 text-left hover:bg-accent/25"
                              }
                            >
                              <div className="flex items-start gap-2.5">
                                <div
                                  className={
                                    selected
                                      ? "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                                      : "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                                  }
                                >
                                  {selected ? (
                                    <Check className="size-3.5" />
                                  ) : (
                                    <Circle className="size-3" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold leading-5 text-foreground">
                                        {candidate.officeName}
                                      </p>
                                      {candidate.address ? (
                                        <p className="mt-1 flex items-start gap-1 text-[10px] leading-4 text-muted-foreground">
                                          <MapPin className="mt-0.5 size-3 shrink-0" />
                                          <span>{candidate.address}</span>
                                        </p>
                                      ) : null}
                                      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                                        {candidate.accountType || candidate.specialty ? (
                                          <span>
                                            {[candidate.accountType, candidate.specialty]
                                              .filter(Boolean)
                                              .join(" · ")}
                                          </span>
                                        ) : null}
                                        {candidate.relationshipStage ? (
                                          <span>{candidate.relationshipStage}</span>
                                        ) : null}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      <span
                                        className={
                                          candidate.priorityLabel === "GO NOW"
                                            ? "rounded-full bg-primary px-2 py-1 text-[9px] font-bold text-primary-foreground"
                                            : "rounded-full border border-border px-2 py-1 text-[9px] font-semibold text-foreground"
                                        }
                                      >
                                        {candidate.priorityLabel || "TARGET"}
                                      </span>
                                      {recommended ? (
                                        <span className="text-[9px] font-semibold text-primary">
                                          Recommended
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>

                                  {candidate.tags?.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {candidate.tags.map((tag) => (
                                        <span
                                          key={tag}
                                          className={`rounded-full border px-2 py-1 text-[8px] font-bold tracking-[0.05em] ${tagClasses(tag)}`}
                                        >
                                          {tagLabel(tag)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}

                                  {candidate.reasons?.length ? (
                                    <ul className="mt-2 space-y-1">
                                      {candidate.reasons
                                        .slice(0, 3)
                                        .map((reason) => (
                                          <li
                                            key={reason}
                                            className="flex items-start gap-1.5 text-[11px] leading-4 text-foreground/90"
                                          >
                                            <span className="mt-[6px] size-1 shrink-0 rounded-full bg-primary" />
                                            <span>{reason}</span>
                                          </li>
                                        ))}
                                    </ul>
                                  ) : null}

                                  <div className="mt-2 rounded-lg bg-background/45 px-2.5 py-2">
                                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                                      Visit objective
                                    </p>
                                    <p className="mt-1 text-[11px] leading-4 text-foreground/90">
                                      {candidate.nextAction ||
                                        (candidate.kind === "prospect"
                                          ? "Qualify the relationship and identify the right decision-maker."
                                          : "Advance the relationship and leave with a clear next step.")}
                                    </p>
                                  </div>

                                  <div
                                    className="mt-2 rounded-lg border border-border/45 bg-background/45 px-2.5 py-2"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-primary">
                                      Latest note
                                    </p>
                                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">
                                      {candidate.latestNote || "No visit note saved yet."}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
                </>
              )}
            </section>
          ) : null}

          {plannerBuild && plannerPhase === "plan" ? (
            <section className="space-y-3" aria-label="Emery Game Plan">
              <button
                type="button"
                disabled={pending || building}
                onClick={() => {
                  setPlannerPhase("select");
                  setGamePlans([]);
                  setMessages([]);
                }}
                className="min-h-11 text-sm font-semibold text-primary disabled:opacity-40"
              >
                Back to offices
              </button>
              {gamePlans.map((office) => {
                const key = candidateKey(office);
                return (
                  <article
                    key={key}
                    className="rounded-2xl border border-border/55 bg-card/50 p-3.5"
                  >
                    <h3 className="text-sm font-semibold">
                      {office.officeName}
                    </h3>
                    <div
                      className="mt-2 flex gap-2"
                      role="group"
                      aria-label={`Visit type for ${office.officeName}`}
                    >
                      {(
                        [
                          ["office_visit", "Office Visit"],
                          ["lunch", "Lunch"],
                        ] as const
                      ).map(([type, label]) => (
                        <button
                          key={type}
                          type="button"
                          disabled={building || pending}
                          aria-pressed={
                            (visitTypes[key] ?? "office_visit") === type
                          }
                          onClick={() =>
                            setVisitTypes((current) => ({
                              ...current,
                              [key]: type,
                            }))
                          }
                          className={
                            (visitTypes[key] ?? "office_visit") === type
                              ? "min-h-11 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground"
                              : "min-h-11 rounded-xl border border-border px-3 text-xs font-semibold"
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <dl className="mt-3 space-y-2 text-xs leading-5">
                      {[
                        ["Prior note", office.gamePlan?.priorNote],
                        [
                          "Relationship / follow-up",
                          office.gamePlan?.relationshipContext,
                        ],
                        ["Visit purpose", office.gamePlan?.purpose],
                        ["Recommended approach", office.gamePlan?.approach],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="font-semibold text-primary">
                            {label}
                          </dt>
                          <dd className="whitespace-pre-wrap text-foreground/90">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                );
              })}
            </section>
          ) : null}
          {plannerBuild && plannerPhase === "start" ? (
            <section className="space-y-3" aria-label="Starting Point">
              <button
                type="button"
                disabled={validatingStart || building}
                onClick={() => {
                  setPlannerPhase("plan");
                  setError("");
                }}
                className="min-h-11 text-sm font-semibold text-primary disabled:opacity-40"
              >
                Back to game plan
              </button>
              <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                  Starting Point
                </p>
                <h3 className="mt-1 text-base font-semibold">
                  Where are you starting this route?
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Your first office and every stop after it will be optimized
                  from this point.
                </p>
                <div className="mt-3 grid gap-2">
                  {(
                    [
                      ["current_location", "Current Location", LocateFixed],
                      ["hpo_office", "HPO Office", Building2],
                      ["custom_address", "Custom Address", MapPin],
                    ] as const
                  ).map(([kind, label, Icon]) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={validatingStart || building}
                      aria-pressed={startChoice === kind}
                      onClick={() => void chooseStartingPoint(kind)}
                      className={
                        startChoice === kind
                          ? "flex min-h-12 items-center gap-3 rounded-xl border border-primary bg-primary/10 px-3 text-left text-sm font-semibold text-primary"
                          : "flex min-h-12 items-center gap-3 rounded-xl border border-border bg-card/70 px-3 text-left text-sm font-semibold text-foreground"
                      }
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {startingPoint?.kind === kind ? (
                        <Check className="size-4" />
                      ) : null}
                    </button>
                  ))}
                </div>
                {startChoice === "hpo_office" ? (
                  <p className="mt-2 px-1 text-[11px] leading-4 text-muted-foreground">
                    {HPO_OFFICE_START_ADDRESS}
                  </p>
                ) : null}
                {startChoice === "custom_address" ? (
                  <div className="mt-3 space-y-2">
                    <label
                      className="block text-xs font-semibold"
                      htmlFor="planner-start-address"
                    >
                      Starting address
                    </label>
                    <input
                      id="planner-start-address"
                      value={customStartAddress}
                      onChange={(event) => {
                        setCustomStartAddress(event.target.value);
                        setStartingPoint(null);
                        setError("");
                      }}
                      placeholder="Enter street, city, state, ZIP"
                      autoComplete="street-address"
                      className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={
                        validatingStart || customStartAddress.trim().length < 5
                      }
                      onClick={() => void validateCustomStartingPoint()}
                      className="min-h-11 w-full rounded-xl border border-primary/35 bg-primary/10 px-3 text-sm font-semibold text-primary disabled:opacity-40"
                    >
                      {validatingStart ? "Validating…" : "Validate address"}
                    </button>
                  </div>
                ) : null}
                {startingPoint ? (
                  <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2.5 text-xs leading-5 text-foreground">
                    <p className="font-semibold text-emerald-600">
                      Starting point confirmed
                    </p>
                    <p className="text-muted-foreground">
                      {startingPoint.label}
                      {startingPoint.address !== startingPoint.label
                        ? ` · ${startingPoint.address}`
                        : ""}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
          {pending ? (
            <p className="px-1 text-xs text-muted-foreground">
              Emery is reviewing…
            </p>
          ) : null}
          {building ? (
            <p className="px-1 text-xs font-medium text-primary">
              Building and optimizing the approved route…
            </p>
          ) : null}
          {error ? (
            <div className="rounded-xl border border-destructive/35 bg-destructive/[0.04] px-3 py-2 text-xs leading-5 text-destructive">
              {error}
            </div>
          ) : null}
          <div ref={endRef} aria-hidden="true" className="h-px" />
        </div>

        {recommendation ? (
          <div className="shrink-0 border-t border-border/45 bg-background/98 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                if (plannerBuild && plannerPhase === "select")
                  return void finishSelection();
                if (plannerBuild && plannerPhase === "plan") {
                  setPlannerPhase("start");
                  setError("");
                  scrollRef.current?.scrollTo({ top: 0 });
                  return;
                }
                void buildRoute();
              }}
              disabled={
                !selectedCandidates.length ||
                pending ||
                building ||
                validatingStart ||
                (plannerBuild && plannerPhase === "start" && !startingPoint)
              }
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-35"
            >
              <RouteIcon className="size-4" />
              {plannerBuild
                ? building
                  ? "Finalizing & optimizing…"
                  : plannerPhase === "select"
                    ? "Done"
                    : plannerPhase === "plan"
                      ? "Choose Starting Point"
                      : "Finalize Route"
                : building
                  ? "Building & optimizing…"
                  : `Build this route · ${selectedCandidates.length} stop${
                      selectedCandidates.length === 1 ? "" : "s"
                    }`}
            </button>
            <p className="mt-1 text-center text-[9px] leading-4 text-muted-foreground">
              {plannerBuild && plannerPhase === "start"
                ? "Optimization begins at the confirmed starting point and preserves every selected office."
                : "Emery will optimize road order after your office choices are locked."}
            </p>
          </div>
        ) : null}

        {!plannerBuild || plannerPhase === "plan" ? (
          <div className="shrink-0 border-t border-border/45 bg-background/96 px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))] pt-2">
            <div className="flex items-end gap-1.5 rounded-xl border border-input bg-card p-1.5">
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  recommendation
                    ? "Ask Emery about an office or adjust the game plan…"
                    : "Tell Emery the towns or territory…"
                }
                className="max-h-28 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground/60"
              />
              {!plannerBuild ? (
                <EmeryVoiceControl
                  hpoRouteId={routeId ?? null}
                  hpoStopId={stopId ?? null}
                  hpoAccountId={selectedAccountId ?? null}
                  onConversationChanged={() => {
                    onChanged?.();
                    window.setTimeout(() => {
                      endRef.current?.scrollIntoView({
                        block: "end",
                        behavior: "smooth",
                      });
                    }, 80);
                  }}
                />
              ) : null}
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || pending || building}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-35"
                aria-label="Send to Emery"
              >
                <ArrowUp className="size-[18px]" />
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
