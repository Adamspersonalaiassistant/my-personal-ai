import { aggregateReceipts, type AggregateOutcome } from "./receipt-aggregator.ts";
import type {
  ActionPlan,
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

function skippedReceipt(
  intent: PlannedIntent,
  context: RequestContext,
  reason: string,
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
    error: null,
    idempotencyKey: null,
    timestamp: new Date().toISOString(),
    reversible: false,
    undoData: null,
    sourceMessageId: context.sourceMessageId,
  };
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
            "The action plan contains an unresolved dependency.",
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
            `Dependency ${failedDependency} did not complete safely.`,
          );
        } else if (!handler) {
          receipt = skippedReceipt(
            intent,
            input.context,
            "No registered executor handled this action.",
          );
        } else {
          receipt = await handler(intent, {
            plan: input.plan,
            context: input.context,
            receipts: receiptsByIntent,
          });
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
