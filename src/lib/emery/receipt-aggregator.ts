import type { ExecutionReceipt } from "./orchestration.types.ts";

export type AggregateOutcome = {
  status: ExecutionReceipt["status"];
  performed: number;
  failed: number;
  needsClarification: boolean;
  receipts: ExecutionReceipt[];
};

export function aggregateReceipts(receipts: ExecutionReceipt[]): AggregateOutcome {
  const performed = receipts.filter((receipt) => receipt.performed).length;
  const failed = receipts.filter((receipt) => receipt.status === "hard_failure").length;
  const needsClarification = receipts.some(
    (receipt) => receipt.status === "clarification_required",
  );
  let status: ExecutionReceipt["status"] = "safe_noop";

  if (needsClarification && performed === 0) status = "clarification_required";
  else if (performed > 0 && (failed > 0 || needsClarification)) status = "partial_success";
  else if (failed > 0) status = "hard_failure";
  else if (performed > 0) status = "success";

  return { status, performed, failed, needsClarification, receipts };
}

export function shouldSuppressCapability(receipt: ExecutionReceipt | null | undefined): boolean {
  return Boolean(receipt?.performed && receipt.status === "success");
}
