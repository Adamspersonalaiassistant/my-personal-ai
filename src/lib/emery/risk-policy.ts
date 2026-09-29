export type ActionRisk = "low" | "medium" | "high";

const ACTION_RISK: Record<string, ActionRisk> = {
  "calendar.read": "low",
  "hpo.account.read": "low",
  "hpo.route.read": "low",
  "hpo.route.arrive": "low",
  "hpo.interaction.create": "low",
  "hpo.route.add_stop": "medium",
  "hpo.follow_up.create": "medium",
  "hpo.route.reorder": "medium",
  "hpo.route.set_stops": "high",
  "hpo.prospect.merge": "high",
  "hpo.prospect.promote": "high",
};

export function riskForAction(action: string): ActionRisk {
  return ACTION_RISK[action] ?? "medium";
}

export function requiresConfirmation(input: {
  action: string;
  ambiguous: boolean;
  hasReliableUndo: boolean;
  explicitlyRequested: boolean;
}): boolean {
  if (input.ambiguous) return true;
  const risk = riskForAction(input.action);
  if (risk === "low") return false;
  if (risk === "high" && !input.hasReliableUndo) return true;
  return !input.explicitlyRequested;
}
