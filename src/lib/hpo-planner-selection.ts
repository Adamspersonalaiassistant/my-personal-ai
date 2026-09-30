export type PlannerTarget = {
  accountId?: string | null;
  prospectId?: string | null;
  visitType?: "lunch" | "office_visit";
};
export type PlannerGamePlan = {
  priorNote: string;
  relationshipContext: string;
  purpose: string;
  approach: string;
};
export const HPO_OFFICE_START_ADDRESS = "1320 Adams St, Hoboken, NJ 07030";
export type PlannerStartingPoint = {
  kind: "current_location" | "hpo_office" | "custom_address";
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};
export function validatePlannerStartingPoint(
  value: Partial<PlannerStartingPoint> | null | undefined,
): PlannerStartingPoint {
  const kind = String(value?.kind ?? "") as PlannerStartingPoint["kind"];
  if (!["current_location", "hpo_office", "custom_address"].includes(kind))
    throw new Error("Choose where you are starting this route.");
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    throw new Error("Validate the starting point before finalizing.");
  const address = String(value?.address ?? "")
    .trim()
    .slice(0, 300);
  const label = String(value?.label ?? "")
    .trim()
    .slice(0, 180);
  if (!address || !label)
    throw new Error("Validate the starting point before finalizing.");
  return { kind, label, address, latitude, longitude };
}
export function plannerTargetKey(target: PlannerTarget) {
  return target.accountId
    ? `account:${target.accountId}`
    : `prospect:${target.prospectId}`;
}
export function validatePlannerSelection(input: {
  routeDate: string;
  selected: PlannerTarget[];
  sessionId?: string | null;
}) {
  const date = String(input?.routeDate ?? "");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new Error("Choose a valid Planner date.");
  if (!Array.isArray(input.selected) || !input.selected.length)
    throw new Error("Select at least one office.");
  if (input.selected.length > 30)
    throw new Error("The road optimizer supports up to 30 offices per route.");
  const seen = new Set<string>();
  const selected = input.selected.map((target) => {
    const accountId = String(target?.accountId ?? "").trim() || null;
    const prospectId = String(target?.prospectId ?? "").trim() || null;
    if (Boolean(accountId) === Boolean(prospectId))
      throw new Error(
        "Each office needs exactly one saved account or prospect ID.",
      );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        accountId || prospectId!,
      )
    )
      throw new Error("Invalid saved office ID.");
    const key = plannerTargetKey({ accountId, prospectId });
    if (seen.has(key))
      throw new Error(
        "An office was selected more than once. Review your selection.",
      );
    seen.add(key);
    if (
      target.visitType &&
      !["lunch", "office_visit"].includes(target.visitType)
    )
      throw new Error("Choose Lunch or Office Visit.");
    return {
      accountId,
      prospectId,
      visitType: target.visitType ?? "office_visit",
    };
  });
  return {
    routeDate: date,
    selected,
    sessionId: String(input.sessionId ?? "")
      .trim()
      .slice(0, 120),
  };
}
export function eligiblePlannerAccount(row: any) {
  return (
    row.status === "active" &&
    Boolean(row.address?.trim()) &&
    !row.tags?.includes("exclude_from_adam_route") &&
    row.metadata?.exclude_from_adam_route !== true &&
    (!row.owner_name?.trim() ||
      ["adam", "adam ashraf"].includes(row.owner_name.trim().toLowerCase()))
  );
}
export function eligiblePlannerProspect(row: any) {
  return (
    Boolean(row.address?.trim()) &&
    !["not_fit", "closed", "duplicate"].includes(row.fit_status) &&
    row.metadata?.exclude_from_adam_route !== true &&
    (!row.promoted_account_id || row.metadata?.map_as_location === true)
  );
}
export function plannerGamePlan(
  row: any,
  history: any[] = [],
  contacts: any[] = [],
): PlannerGamePlan {
  const latest = history[0];
  const next = latest?.next_action || row.next_action;
  return {
    priorNote:
      [
        latest?.summary ? String(latest.summary).slice(0, 600) : null,
        row.notes ? String(row.notes).slice(-800) : null,
      ]
        .filter(Boolean)
        .join("\n") || "No prior note saved.",
    relationshipContext:
      [
        row.relationship_stage,
        row.relationship_health,
        latest?.outcome,
        latest?.relationship_signal,
        next ? `Follow-up: ${next}` : null,
        row.blockers ? `Blocker: ${row.blockers}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Relationship history has not been saved.",
    purpose:
      next ||
      row.opportunity ||
      "Introduce Hudson Pro's services and learn the office's referral needs.",
    approach: row.blockers
      ? "Review the recorded blocker before proceeding. Confirm whether a visit is appropriate."
      : contacts.length
        ? `Ask whether ${contacts.map((c) => [c.name, c.role_title].filter(Boolean).join(" · ")).join(" or ")} is available. Confirm their current role and follow through on the saved next step.`
        : "Ask the front desk who handles provider relationships or referrals. Confirm the next step without assuming interest.",
  };
}
