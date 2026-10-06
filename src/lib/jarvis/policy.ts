// JARVIS runtime policy: risk gating, free-first / paid-credit enforcement,
// protected GitHub operations and sensitive-content guards.
//
// These checks run in code before any tool executes. Prompt text repeats them,
// but the prompt is not the enforcement point.

import type { JarvisToolDefinition } from "./tool-registry.ts";

export type PolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "approval_required" | "protected" | "paid_credit_approval_required";
      message: string;
    };

export type TurnApprovals = {
  /** Adam explicitly approved paid-credit use in this very message. */
  paidCreditApproved: boolean;
  /** Adam explicitly approved a high-risk write in this very message. */
  highRiskApproved: boolean;
  /** Adam explicitly approved executing tasks in this very message ("execute these"). */
  tasksApproved?: boolean;
  /** Adam said this prompt replaces the previous task plan/batch. */
  batchReplacement?: boolean;
};

// ------------------------------------------------------------ task approval
// "Give me 20 ideas" PROPOSES. "Execute these 20" APPROVES + SCHEDULES. Only
// an explicit approval in Adam's own message turns proposals into tasks the
// worker may run; this is decided here in code, never by the model.

const NEGATED_APPROVAL =
  /\b(don'?t|do not|not yet|never|hold off|wait (for|until)|before i approve|until i approve|without approv\w*|need(s)? (my )?approval)\b[^.?!]{0,40}\b(execute|run|start|schedule|proceed|queue|approve)/i;
const TASK_APPROVAL =
  /\b(i approve|approved|i['’]?m approving|approve (these|those|them|it|the|this|all)|execute (these|those|them|it|the|this|all)|go ahead|proceed( with)?|schedule (these|those|them|it|the|this|all)|run (these|those|them|it|the|this|all)|start (on )?(these|those|them|working)|queue (these|those|them|it|up)|make it so|do (these|those|them) (now|all)|you have my (approval|go[- ]ahead))\b/i;

export function assessTaskApproval(message: string): { approved: boolean } {
  const text = String(message ?? "");
  if (NEGATED_APPROVAL.test(text)) return { approved: false };
  return { approved: TASK_APPROVAL.test(text) };
}

const BATCH_REPLACEMENT =
  /\b(instead of|replaces?|replacing|in place of|scrap|disregard|ignore|forget|never ?mind|supersede\w*|throw out|drop)\b[^.?!]{0,60}\b(plan|batch|list|tasks?|prompt)\b|\b(new|different|updated|revised)\s+(prompt|plan|batch|task list)\b[^.?!]{0,40}\b(instead|rather|replace)/i;

export function assessBatchReplacement(message: string): { replace: boolean } {
  return { replace: BATCH_REPLACEMENT.test(String(message ?? "")) };
}

export function evaluateToolPolicy(
  tool: JarvisToolDefinition,
  approvals: TurnApprovals,
): PolicyDecision {
  if (tool.paidCredit && !approvals.paidCreditApproved) {
    return {
      allowed: false,
      reason: "paid_credit_approval_required",
      message: `${tool.name} uses paid credits. Free-first policy: explain why the free path is insufficient, the expected benefit and cost, and wait for Adam's explicit approval.`,
    };
  }
  if (tool.risk === "PROTECTED") {
    return {
      allowed: false,
      reason: "protected",
      message: `${tool.name} is a protected operation (production/security/credential impact). JARVIS cannot run it autonomously; prepare the change for Adam instead.`,
    };
  }
  if (tool.risk === "HIGH_RISK_WRITE" && !approvals.highRiskApproved) {
    return {
      allowed: false,
      reason: "approval_required",
      message: `${tool.name} is a high-risk write and needs Adam's explicit approval first.`,
    };
  }
  return { allowed: true };
}

// ------------------------------------------------------------------ credits
// The paid-credit assessment lives in guards.ts so the app, the GitHub gateway
// and the background worker enforce the identical free-first rule.
import { assessPaidCreditRequest, type PaidCreditAssessment } from "./guards.ts";
export { assessPaidCreditRequest, type PaidCreditAssessment };

export function paidCreditApprovalMessage(assessment: PaidCreditAssessment, request: string) {
  const service = assessment.services.join(" + ") || "paid credits";
  return [
    `Stopping before spending anything. That request would use **${service}**, and my standing policy is free-first: paid credits need your explicit approval.`,
    "",
    `**What:** ${service} for: “${request.slice(0, 220)}${request.length > 220 ? "…" : ""}”`,
    "**Why I'd consider it:** only if the direct path (GitHub branch → edit → test → PR, Supabase, existing tests) cannot do the job well. I haven't established that yet.",
    "**Expected benefit:** faster generation of large UI scaffolding, at the cost of less control over the diff.",
    "**Expected cost:** Lovable/premium credits per request; exact usage isn't knowable in advance.",
    "**Free alternative (my default):** I inspect the source, create an isolated `jarvis/` branch, make the edit directly, run the checks and open a PR — no paid credits.",
    "",
    "Say “I approve using Lovable credits for this” if you want the paid route. Otherwise I'll proceed on the free path.",
  ].join("\n");
}

// ------------------------------------------------------------------- GitHub
// Repository guards live in guards.ts (shared verbatim with the edge function).
export {
  assertCandidateBranch,
  assertSafeContent,
  assertSafeRepoPath,
  PolicyError,
  redactSecrets,
} from "./guards.ts";
