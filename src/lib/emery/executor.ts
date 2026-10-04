import { aggregateReceipts, type AggregateOutcome } from "./receipt-aggregator.ts";
import { getCapability, type CapabilityRequirement } from "./capability-registry.ts";
import { structuredFailure } from "./error-serializer.ts";
import type {
  ActionPlan,
  EmeryFailureCode,
  ExecutionReceipt,
  PlannedIntent,
  RequestContext,
} from "./orchestration.types.ts";

export type CapabilityExecutionState = {
  plan: ActionPlan;
  context: RequestContext;
  receipts: ReadonlyMap<string, ExecutionReceipt>;
};

export type CapabilityHandler = (
  intent: PlannedIntent,
  state: CapabilityExecutionState,
) => Promise<ExecutionReceipt>;

export type PlanExecution = AggregateOutcome & {
  completedIntentIds: string[];
};

function dependencyFailed(receipt: ExecutionReceipt | undefined) {
  return (
    !receipt || receipt.status === "hard_failure" || receipt.status === "clarification_required"
  );
}

function requirementSatisfied(requirement: CapabilityRequirement, context: RequestContext) {
  if (requirement === "current_route") return Boolean(context.currentRouteId);
  if (requirement === "current_stop") return Boolean(context.currentStopId);
  if (requirement === "selected_account") return Boolean(context.selectedAccountId);
  if (requirement === "selected_prospect") return Boolean(context.selectedProspectId);
  if (requirement === "field_session") return Boolean(context.fieldSessionId);
  if (requirement === "expected_note_target") return Boolean(context.expectedNoteTargetId);
  if (requirement === "recent_receipt") return context.recentReceiptIds.length > 0;
  if (requirement === "location") return Boolean(context.location);
  // resolved_entity is represented by dependency receipts rather than RequestContext.
  return true;
}

function skippedReceipt(
  intent: PlannedIntent,
  context: RequestContext,
  reason: string,
  failureCode: EmeryFailureCode,
): ExecutionReceipt {
  return {
    id: `skipped:${intent.id}`,
    capability: intent.capability,
    action: intent.action,
    target: null,
    status: "safe_noop",
    performed: false,
    before: null,
    after: null,
    reason,
    error: structuredFailure(failureCode, {
      message: reason,
      capability: intent.capability,
      operation: intent.action,
    }),
    idempotencyKey: null,
    timestamp: new Date().toISOString(),
    reversible: false,
    undoData: null,
    sourceMessageId: context.sourceMessageId,
  };
}

function preflightReceipt(intent: PlannedIntent, context: RequestContext) {
  const capability = getCapability(intent.action);
  if (!capability) return null;

  const health = context.capabilityHealth[capability.healthKey];
  if (health === "unavailable") {
    return skippedReceipt(
      intent,
      context,
      capability.degradedBehavior,
      "CAPABILITY_UNAVAILABLE",
    );
  }

  const missing = capability.requires.filter(
    (requirement) => !requirementSatisfied(requirement, context),
  );
  if (missing.length) {
    return skippedReceipt(
      intent,
      context,
      `Missing required current context: ${missing.join(", ")}. ${capability.degradedBehavior}`,
      "MISSING_CONTEXT",
    );
  }
  return null;
}

export async function executeActionPlan(input: {
  plan: ActionPlan;
  context: RequestContext;
  handlers: Partial<Record<string, CapabilityHandler>>;
}): Promise<PlanExecution> {
  const pending = new Map(input.plan.intents.map((intent) => [intent.id, intent]));
  const receiptsByIntent = new Map<string, ExecutionReceipt>();

  while (pending.size) {
    const ready = [...pending.values()].filter((intent) =>
      intent.dependsOn.every((dependency) => receiptsByIntent.has(dependency)),
    );
    if (!ready.length) {
      for (const intent of pending.values()) {
        receiptsByIntent.set(
          intent.id,
          skippedReceipt(
            intent,
            input.context,
            "A required action dependency could not be resolved, so the dependent action was not run.",
            "DEPENDENCY_FAILED",
          ),
        );
      }
      break;
    }

    await Promise.all(
      ready.map(async (intent) => {
        const failedDependency = intent.dependsOn.find((dependency) =>
          dependencyFailed(receiptsByIntent.get(dependency)),
        );
        const handler = input.handlers[intent.action];
        let receipt: ExecutionReceipt;
        if (failedDependency) {
          receipt = skippedReceipt(
            intent,
            input.context,
            `Dependency ${failedDependency} did not complete safely, so this action was not run.`,
            "DEPENDENCY_FAILED",
          );
        } else {
          const preflight = preflightReceipt(intent, input.context);
          if (preflight) {
            receipt = preflight;
          } else if (!handler) {
            receipt = skippedReceipt(
              intent,
              input.context,
              "No registered executor is available for this capability, so no action was performed.",
              "CAPABILITY_UNAVAILABLE",
            );
          } else {
            receipt = await handler(intent, {
              plan: input.plan,
              context: input.context,
              receipts: receiptsByIntent,
            });
          }
        }
        receiptsByIntent.set(intent.id, receipt);
        pending.delete(intent.id);
      }),
    );
  }

  const receipts = input.plan.intents.map((intent) => receiptsByIntent.get(intent.id)!);
  return {
    ...aggregateReceipts(receipts),
    completedIntentIds: input.plan.intents.map((intent) => intent.id),
  };
}
