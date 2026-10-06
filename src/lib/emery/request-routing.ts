import type { EmeryDomain } from "../emery-domain.ts";
import { routeEmeryCapabilities, type CapabilityRoute } from "./capability-router.ts";
import { widenCapabilityRoute } from "./capability-discovery.ts";
import { contextLoadPolicy, type EmeryContextLoadPolicy } from "./context-load-policy.ts";
import { planEmeryRequest } from "./planner.ts";
import type { ActionPlan, RequestContext } from "./orchestration.types.ts";

export type PreparedEmeryRequestRouting = {
  capabilityRoute: CapabilityRoute;
  loadPolicy: EmeryContextLoadPolicy;
  actionPlan: ActionPlan;
};

/**
 * Phase 2 adapter: deterministic capability routing happens before the existing
 * Emery planner. The planner remains unchanged and remains the source of the
 * executable ActionPlan.
 */
export function prepareEmeryRequestRouting(input: {
  message: string;
  context?: RequestContext | null;
  domainHint?: EmeryDomain | null;
}): PreparedEmeryRequestRouting {
  // A capability the router did not select is not a dead end: widen from the full catalog.
  const capabilityRoute = widenCapabilityRoute(
    routeEmeryCapabilities({
      message: input.message,
      context: input.context ?? null,
      domainHint: input.domainHint ?? null,
    }),
    input.message,
  );
  const loadPolicy = contextLoadPolicy(capabilityRoute);
  const actionPlan = planEmeryRequest(input.message);
  return { capabilityRoute, loadPolicy, actionPlan };
}
